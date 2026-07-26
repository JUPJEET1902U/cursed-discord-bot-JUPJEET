const OpenAI = require("openai").default

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

async function callProvider(providerName, messages, options = {}) {
    const provider = PROVIDERS[providerName]
    if (!provider?.client) {
        const error = new Error(`${provider?.label || providerName} not configured`)
        error.code = "AI_PROVIDER_NOT_CONFIGURED"
        throw error
    }

    const request = {
        model: provider.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
    }

    const startedAt = Date.now()
    const response = await withTimeout(
        provider.client.chat.completions.create(request),
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

async function callAI(messages, options = {}) {
    const maxTokens = Math.max(50, Math.min(2000, Number(options.maxTokens) || 500))
    const temperature = Math.max(0, Math.min(1.2, Number(options.temperature ?? 0.7)))
    const retries = Math.max(0, Math.min(1, Number(options.retries ?? 1)))
    const providerOrder = normalizeProviderOrder(options.providerOrder)
    const errors = []
    let configuredCount = 0

    for (const providerName of providerOrder) {
        const provider = PROVIDERS[providerName]
        if (!provider?.client) continue
        configuredCount++

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await callProvider(providerName, messages, {
                    maxTokens,
                    temperature,
                    timeoutMs: options.timeoutMs,
                })
                lastUsed = providerName
                providerStats[providerName].success++
                console.log(`[AI] ${provider.label} responded OK in ${result.latencyMs}ms${attempt ? ` after retry ${attempt}` : ""}`)
                return result
            } catch (error) {
                const reason = safeErrorReason(error)
                const retryable = isRetryableError(error)
                const willRetry = retryable && attempt < retries

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

    if (!configuredCount) {
        throw new Error("No AI providers are configured")
    }
    throw new Error(`All AI providers failed — ${errors.join(" | ")}`)
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
    getStatus,
}
