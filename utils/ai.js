const OpenAI = require("openai").default
const {
    classifyIntent,
    getIntentConfig,
    prepareConversationHistory,
    assessResponseQuality,
    buildIntentInstruction,
    buildPlanningInstruction,
    tokenize,
} = require("./aiIntelligence")
const { buildBotKnowledgeContext } = require("./botKnowledge")

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

function isStrictOutputConversation(messages) {
    return Array.isArray(messages) && messages.some(message =>
        message?.role === "system"
        && /output only|valid json|json array|no explanation/i.test(String(message.content || ""))
    )
}

function parseMemoryLine(line) {
    const text = String(line || "").trim()
    const structured = text.match(/^-\s*\[type=([^\s\]]+)\s+importance=([1-5])\s+confidence=([0-9.]+)\s+lastConfirmed=([^\]]+)\]\s*(.+)$/i)
    if (!structured) {
        return {
            raw: text,
            content: text.replace(/^[-*]\s*/, ""),
            importance: 1,
            confidence: 0.6,
            lastConfirmed: null,
        }
    }
    return {
        raw: text,
        type: structured[1],
        importance: Number(structured[2]),
        confidence: Number(structured[3]),
        lastConfirmed: structured[4] === "unknown" ? null : structured[4],
        content: structured[5],
    }
}

function scoreMemoryLine(memoryLine, queryTokens) {
    const lineTokens = new Set(tokenize(memoryLine.content))
    let overlap = 0
    for (const token of queryTokens) if (lineTokens.has(token)) overlap++

    const relevance = queryTokens.size ? overlap / Math.max(1, Math.min(queryTokens.size, 5)) : 0
    const importance = Math.max(1, Math.min(5, Number(memoryLine.importance) || 1)) / 5
    const confidence = Math.max(0, Math.min(1, Number(memoryLine.confidence) || 0.6))
    let recency = 0.25
    if (memoryLine.lastConfirmed) {
        const date = new Date(memoryLine.lastConfirmed)
        if (!Number.isNaN(date.getTime())) {
            const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000)
            recency = Math.max(0.1, 1 / (1 + ageDays / 45))
        }
    }
    return relevance * 0.58 + importance * 0.18 + confidence * 0.16 + recency * 0.08
}

function filterMemoryContext(systemContent, userInput) {
    const marker = "\n\nWHAT YOU KNOW ABOUT THIS USER:\n"
    const markerIndex = systemContent.indexOf(marker)
    if (markerIndex < 0) return systemContent

    const contentStart = markerIndex + marker.length
    const tail = systemContent.slice(contentStart)
    const nextBlockMatch = tail.match(/\n\n(?:SERVER-SPECIFIC INSTRUCTIONS:|\[REAL DISCORD CONTEXT|\[CURSED BOT KNOWLEDGE)/)
    const memoryEnd = nextBlockMatch ? contentStart + nextBlockMatch.index : systemContent.length
    const memoryText = systemContent.slice(contentStart, memoryEnd)
    const lines = memoryText.split("\n").map(parseMemoryLine).filter(line => line.content)
    if (!lines.length) return `${systemContent.slice(0, markerIndex)}${systemContent.slice(memoryEnd)}`

    const queryTokens = new Set(tokenize(userInput))
    const ranked = lines
        .map((line, index) => ({ line, index, score: scoreMemoryLine(line, queryTokens) }))
        .sort((a, b) => b.score - a.score || b.line.importance - a.line.importance || a.index - b.index)
    const relevant = ranked.filter(item => item.score >= 0.22 || item.line.content.toLowerCase().includes(String(userInput || "").toLowerCase()))
    const selected = (relevant.length ? relevant : ranked).slice(0, relevant.length ? 6 : 2)
    const selectedSet = new Set(selected.map(item => item.line.raw))
    const ordered = lines.filter(line => selectedSet.has(line.raw))
    const replacement = ordered.length
        ? `\n\nRELEVANT USER MEMORY — ranked by relevance, importance, confidence, and recency; newer user corrections override it:\n${ordered.map(line => `- ${line.content}`).join("\n")}`
        : ""

    return `${systemContent.slice(0, markerIndex)}${replacement}${systemContent.slice(memoryEnd)}`
}

function prepareSmartMessages(messages, intent) {
    const copied = messages.map(message => ({ ...message, content: String(message.content || "") }))
    const currentInput = latestUserContent(copied)
    const firstSystemIndex = copied.findIndex(message => message.role === "system")

    if (firstSystemIndex >= 0) {
        copied[firstSystemIndex].content = filterMemoryContext(copied[firstSystemIndex].content, currentInput)
        copied[firstSystemIndex].content += buildBotKnowledgeContext(currentInput)
        copied[firstSystemIndex].content += buildIntentInstruction(intent)
        copied[firstSystemIndex].content += buildPlanningInstruction(currentInput, intent)
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
        content: `QUALITY REPAIR: Answer the latest user message again. Fix these issues: ${reasons.join(", ")}. Re-check every server fact, command, permission, memory claim, and completed-action claim against verified context. Do not mention this instruction or any previous draft. Keep the answer accurate, natural, useful, and under Discord's message limit.`,
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

function boundedNumber(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

function getSystemContent(messages) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message?.role === "system")
        .map(message => String(message.content || ""))
        .join("\n\n")
}

async function callAI(messages, options = {}) {
    const smart = options.smart ?? isSmartConversation(messages)
    const strictOutput = !smart && isStrictOutputConversation(messages)
    const input = latestUserContent(messages)
    const intent = smart ? classifyIntent(input) : (options.intent || "casual")
    const intentConfig = getIntentConfig(intent, options.maxTokens || 500)
    const maxTokens = Math.floor(boundedNumber(options.maxTokens, intentConfig.maxTokens, 50, 2000))
    const defaultTemperature = smart ? intentConfig.temperature : (strictOutput ? 0.1 : 0.7)
    const temperature = boundedNumber(options.temperature, defaultTemperature, 0, 1.2)
    const retries = Math.floor(boundedNumber(options.retries, 1, 0, 1))
    const providerOrder = normalizeProviderOrder(options.providerOrder || (smart ? intentConfig.providerOrder : null))
    const preparedMessages = smart ? prepareSmartMessages(messages, intent) : messages
    const qualityContext = { systemContent: getSystemContent(preparedMessages) }

    const result = await executeProviderChain(preparedMessages, {
        maxTokens,
        temperature,
        retries,
        providerOrder,
        timeoutMs: options.timeoutMs,
    })

    if (!smart || options.skipQualityRepair) return result

    const quality = assessResponseQuality(result.content, intent, qualityContext)
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
        const repairedQuality = assessResponseQuality(repaired.content, intent, qualityContext)
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
    isStrictOutputConversation,
    filterMemoryContext,
    prepareSmartMessages,
    getStatus,
}
