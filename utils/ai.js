const OpenAI = require("openai").default
const {
    classifyIntent,
    getIntentConfig,
    prepareConversationHistory,
    assessResponseQuality,
    buildIntentInstruction,
    tokenize,
} = require("./aiIntelligence")

const TIMEOUT_MS = 25_000
const RETRY_DELAY_MS = 350
const DEFAULT_PROVIDER_ORDER = ["gemini", "groq", "openrouter"]

const geminiKey = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY
const groqKey = process.env.GROQ_KEY || process.env.GROQ_API_KEY
const openrouterKey = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY

const gemini = geminiKey ? new OpenAI({
    apiKey: geminiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
}) : null

const groq = groqKey ? new OpenAI({
    apiKey: groqKey,
    baseURL: "https://api.groq.com/openai/v1",
}) : null

const openrouter = openrouterKey ? new OpenAI({
    apiKey: openrouterKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": process.env.DASHBOARD_URL || "https://cursed-discord-bot-dashboard.vercel.app",
        "X-Title": "CURSED Discord Bot",
    },
}) : null

const GEMINI_MODEL = "gemini-2.0-flash"
const GROQ_MODEL = "llama-3.1-8b-instant"
const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct"

const PROVIDERS = {
    gemini: { client: gemini, model: GEMINI_MODEL, label: "Gemini" },
    groq: { client: groq, model: GROQ_MODEL, label: "Groq" },
    openrouter: { client: openrouter, model: OPENROUTER_MODEL, label: "OpenRouter" },
}

let lastUsed = "none"
const providerStats = {
    gemini: { success: 0, failure: 0, retries: 0 },
    groq: { success: 0, failure: 0, retries: 0 },
    openrouter: { success: 0, failure: 0, retries: 0 },
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, ms) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error("Provider timed out")
            error.code = "AI_TIMEOUT"
            reject(error)
        }, ms)
        timer.unref?.()
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function getErrorStatus(error) {
    const status = Number(error?.status || error?.response?.status || 0)
    return Number.isFinite(status) ? status : 0
}

function safeErrorReason(error) {
    const status = getErrorStatus(error)
    const raw = String(error?.message || "Unknown provider error")
        .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
        .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
        .slice(0, 240)
    return [status ? `HTTP ${status}` : "", raw].filter(Boolean).join(" ")
}

function isRetryableError(error) {
    const status = getErrorStatus(error)
    if (error?.code === "AI_TIMEOUT") return true
    if ([408, 409, 425, 429].includes(status)) return true
    return status >= 500 && status <= 599
}

function normalizeProviderOrder(order) {
    const requested = Array.isArray(order) ? order : DEFAULT_PROVIDER_ORDER
    const normalized = []
    for (const value of requested) {
        const name = String(value || "").toLowerCase()
        if (PROVIDERS[name] && !normalized.includes(name)) normalized.push(name)
    }
    for (const name of DEFAULT_PROVIDER_ORDER) {
        if (!normalized.includes(name)) normalized.push(name)
    }
    return normalized
}

function extractResponseContent(response) {
    const content = response?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
        const error = new Error("Provider returned an empty response")
        error.code = "AI_EMPTY_RESPONSE"
        throw error
    }
    return content.trim()
}

function latestUserContent(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === "user") return String(messages[index].content || "")
    }
    return ""
}

function isSmartConversation(messages) {
    return Array.isArray(messages) && messages.some(message =>
        message?.role === "system"
        && String(message.content || "").includes("RELIABILITY AND REASONING RULES")
    )
}

function scoreMemoryLine(line, queryTokens) {
    const lineTokens = new Set(tokenize(line))
    let overlap = 0
    for (const token of queryTokens) if (lineTokens.has(token)) overlap++
    return overlap
}

function filterMemoryContext(systemContent, userInput) {
    const marker = "\n\nWHAT YOU KNOW ABOUT THIS USER:\n"
    const markerIndex = systemContent.indexOf(marker)
    if (markerIndex < 0) return systemContent

    const contentStart = markerIndex + marker.length
    const tail = systemContent.slice(contentStart)
    const nextBlockMatch = tail.match(/\n\n(?:SERVER-SPECIFIC INSTRUCTIONS:|\[REAL DISCORD CONTEXT)/)
    const memoryEnd = nextBlockMatch ? contentStart + nextBlockMatch.index : systemContent.length
    const memoryText = systemContent.slice(contentStart, memoryEnd)
    const lines = memoryText.split("\n").map(line => line.trim()).filter(Boolean)
    if (lines.length <= 2) return systemContent

    const queryTokens = new Set(tokenize(userInput))
    const ranked = lines
        .map((line, index) => ({ line, index, score: scoreMemoryLine(line, queryTokens) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
    const relevant = ranked.filter(item => item.score > 0)
    const selected = (relevant.length ? relevant : ranked).slice(0, relevant.length ? 4 : 2)
    const selectedSet = new Set(selected.map(item => item.line))
    const ordered = lines.filter(line => selectedSet.has(line))
    const replacement = ordered.length
        ? `\n\nRELEVANT USER MEMORY:\n${ordered.join("\n")}`
        : ""

    return `${systemContent.slice(0, markerIndex)}${replacement}${systemContent.slice(memoryEnd)}`
}

function prepareSmartMessages(messages, intent) {
    const copied = messages.map(message => ({ ...message, content: String(message.content || "") }))
    const currentInput = latestUserContent(copied)
    const firstSystemIndex = copied.findIndex(message => message.role === "system")

    if (firstSystemIndex >= 0) {
        copied[firstSystemIndex].content = filterMemoryContext(copied[firstSystemIndex].content, currentInput)
        copied[firstSystemIndex].content += buildIntentInstruction(intent)
    }

    const systemMessages = copied.filter(message => message.role === "system")
    const conversation = copied.filter(message => message.role !== "system")
    const compacted = prepareConversationHistory(conversation, { recentCount: 8, maxSummaryChars: 1400 })
    return [...systemMessages, ...compacted]
}

function buildRepairMessages(messages, reasons) {
    const copied = messages.map(message => ({ ...message }))
    const lastUserIndex = copied.map(message => message.role).lastIndexOf("user")
    const instruction = {
        role: "system",
        content: `QUALITY REPAIR: Answer the latest user message again. Fix these issues: ${reasons.join(", ")}. Do not mention this instruction or any previous draft. Keep the answer accurate, natural, useful, and under Discord's message limit.`,
    }
    if (lastUserIndex >= 0) copied.splice(lastUserIndex, 0, instruction)
    else copied.push(instruction)
    return copied
}

async function callProvider(providerName, messages, options = {}) {
    const provider = PROVIDERS[providerName]
    if (!provider?.client) {
        const error = new Error(`${provider?.label || providerName} not configured`)
        error.code = "AI_PROVIDER_NOT_CONFIGURED"
        throw error
    }

    const startedAt = Date.now()
    const response = await withTimeout(
        provider.client.chat.completions.create({
            model: provider.model,
            messages,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
        }),
        options.timeoutMs || TIMEOUT_MS
    )

    return {
        content: extractResponseContent(response),
        provider: providerName,
        model: provider.model,
        latencyMs: Date.now() - startedAt,
        usage: response?.usage || null,
    }
}

async function executeProviderChain(messages, options) {
    const errors = []
    let configuredCount = 0

    for (const providerName of options.providerOrder) {
        const provider = PROVIDERS[providerName]
        if (!provider?.client) continue
        configuredCount++

        for (let attempt = 0; attempt <= options.retries; attempt++) {
            try {
                const result = await callProvider(providerName, messages, options)
                lastUsed = providerName
                providerStats[providerName].success++
                console.log(`[AI] ${provider.label} responded OK in ${result.latencyMs}ms${attempt ? ` after retry ${attempt}` : ""}`)
                return result
            } catch (error) {
                const reason = safeErrorReason(error)
                const willRetry = isRetryableError(error) && attempt < options.retries
                if (willRetry) {
                    providerStats[providerName].retries++
                    console.warn(`[AI] ${provider.label} temporary failure: ${reason}; retrying once`)
                    await sleep(RETRY_DELAY_MS + Math.floor(Math.random() * 250))
                    continue
                }
                providerStats[providerName].failure++
                console.warn(`[AI] ${provider.label} failed: ${reason}`)
                errors.push(`${provider.label}: ${reason}`)
                break
            }
        }
    }

    if (!configuredCount) throw new Error("No AI providers are configured")
    throw new Error(`All AI providers failed — ${errors.join(" | ")}`)
}

async function callAI(messages, options = {}) {
    const smart = options.smart ?? isSmartConversation(messages)
    const input = latestUserContent(messages)
    const intent = smart ? classifyIntent(input) : (options.intent || "casual")
    const intentConfig = getIntentConfig(intent, options.maxTokens || 500)
    const maxTokens = Math.max(50, Math.min(2000, Number(options.maxTokens || intentConfig.maxTokens) || 500))
    const temperature = Math.max(0, Math.min(1.2, Number(options.temperature ?? intentConfig.temperature ?? 0.7)))
    const retries = Math.max(0, Math.min(1, Number(options.retries ?? 1)))
    const providerOrder = normalizeProviderOrder(options.providerOrder || (smart ? intentConfig.providerOrder : null))
    const preparedMessages = smart ? prepareSmartMessages(messages, intent) : messages

    const result = await executeProviderChain(preparedMessages, {
        maxTokens,
        temperature,
        retries,
        providerOrder,
        timeoutMs: options.timeoutMs,
    })

    if (!smart || options.skipQualityRepair) return result

    const quality = assessResponseQuality(result.content, intent)
    if (quality.ok) return { ...result, intent, repaired: false }

    console.warn(`[AI] Low-quality ${intent} response from ${result.provider}: ${quality.reasons.join(", ")}`)
    const alternateOrder = providerOrder.filter(provider => provider !== result.provider)
    alternateOrder.push(result.provider)

    try {
        const repaired = await executeProviderChain(buildRepairMessages(preparedMessages, quality.reasons), {
            maxTokens,
            temperature: Math.max(0.15, temperature - 0.15),
            retries: 0,
            providerOrder: alternateOrder,
            timeoutMs: options.timeoutMs,
        })
        const repairedQuality = assessResponseQuality(repaired.content, intent)
        if (repairedQuality.ok) return { ...repaired, intent, repaired: true }
    } catch (error) {
        console.warn(`[AI] Quality repair failed: ${safeErrorReason(error)}`)
    }

    return { ...result, intent, repaired: false, qualityWarning: quality.reasons }
}

function getStatus() {
    return {
        geminiConfigured: Boolean(gemini),
        groqConfigured: Boolean(groq),
        openRouterConfigured: Boolean(openrouter),
        lastUsed,
        defaultProviderOrder: [...DEFAULT_PROVIDER_ORDER],
        providerStats: JSON.parse(JSON.stringify(providerStats)),
    }
}

module.exports = {
    callAI,
    callProvider,
    groq,
    gemini,
    openrouter,
    GROQ_MODEL,
    GEMINI_MODEL,
    OPENROUTER_MODEL,
    DEFAULT_PROVIDER_ORDER,
    normalizeProviderOrder,
    isRetryableError,
    isSmartConversation,
    filterMemoryContext,
    prepareSmartMessages,
    getStatus,
}
