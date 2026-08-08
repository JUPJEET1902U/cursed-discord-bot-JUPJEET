const {
    PROVIDERS,
    GEMINI_MODEL,
    GROQ_MODEL,
    OPENROUTER_MODEL,
} = require("./aiClients")
const { recordTiming } = require("./runtimeMetrics")

function readNumberEnv(name, fallback, min, max) {
    const parsed = Number(process.env[name])
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

const DEFAULT_PROVIDER_TIMEOUT_MS = readNumberEnv("AI_PROVIDER_TIMEOUT_MS", 25_000, 1_000, 60_000)
const DEFAULT_TOTAL_TIMEOUT_MS = readNumberEnv("AI_TOTAL_TIMEOUT_MS", 45_000, 5_000, 120_000)
const RETRY_BASE_DELAY_MS = readNumberEnv("AI_RETRY_BASE_DELAY_MS", 500, 50, 5_000)
const RETRY_MAX_DELAY_MS = readNumberEnv("AI_RETRY_MAX_DELAY_MS", 8_000, 250, 30_000)
const COOLDOWN_BASE_MS = readNumberEnv("AI_PROVIDER_COOLDOWN_MS", 30_000, 1_000, 600_000)
const COOLDOWN_MAX_MS = readNumberEnv("AI_PROVIDER_COOLDOWN_MAX_MS", 300_000, COOLDOWN_BASE_MS, 1_800_000)
const TRANSIENT_FAILURE_THRESHOLD = Math.floor(readNumberEnv("AI_PROVIDER_FAILURE_THRESHOLD", 2, 1, 10))
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000
const DEFAULT_PROVIDER_ORDER = ["gemini", "groq", "openrouter"]

function createProviderStats() {
    return {
        success: 0,
        failure: 0,
        attemptFailures: 0,
        retries: 0,
        fallbackAttempts: 0,
        fallbackSuccess: 0,
        skippedCooldown: 0,
        rateLimits: 0,
        timeouts: 0,
        emptyResponses: 0,
        serverErrors: 0,
        otherErrors: 0,
        cooldowns: 0,
        totalLatencyMs: 0,
        averageLatencyMs: 0,
        lastLatencyMs: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
    }
}

function createProviderHealth() {
    return { consecutiveTransientFailures: 0, cooldownUntil: 0 }
}

let lastUsed = "none"
const providerStats = Object.fromEntries(DEFAULT_PROVIDER_ORDER.map(name => [name, createProviderStats()]))
const providerHealth = Object.fromEntries(DEFAULT_PROVIDER_ORDER.map(name => [name, createProviderHealth()]))

function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

function withTimeout(promise, ms, controller = null) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller?.abort?.()
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

function getHeader(headers, name) {
    if (!headers) return null
    if (typeof headers.get === "function") return headers.get(name)
    const target = String(name).toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === target) return value
    }
    return null
}

function parseRetryAfterMs(error, nowMs = Date.now()) {
    const sources = [error?.headers, error?.response?.headers]
    for (const headers of sources) {
        const retryAfterMsValue = getHeader(headers, "retry-after-ms")
        if (retryAfterMsValue !== null && retryAfterMsValue !== undefined && retryAfterMsValue !== "") {
            const retryAfterMs = Number(retryAfterMsValue)
            if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.floor(retryAfterMs))
        }

        const resetAfterValue = getHeader(headers, "x-ratelimit-reset-after")
        if (resetAfterValue !== null && resetAfterValue !== undefined && resetAfterValue !== "") {
            const resetAfter = Number(resetAfterValue)
            if (Number.isFinite(resetAfter) && resetAfter >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.floor(resetAfter * 1000))
        }

        const retryAfter = getHeader(headers, "retry-after")
        if (retryAfter !== null && retryAfter !== undefined && retryAfter !== "") {
            const seconds = Number(retryAfter)
            if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.floor(seconds * 1000))
            const dateMs = Date.parse(String(retryAfter))
            if (!Number.isNaN(dateMs)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowMs))
        }

        const resetEpochValue = getHeader(headers, "x-ratelimit-reset")
        if (resetEpochValue !== null && resetEpochValue !== undefined && resetEpochValue !== "") {
            const resetEpoch = Number(resetEpochValue)
            if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
                return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor(resetEpoch * 1000 - nowMs)))
            }
        }
    }
    return 0
}

function calculateRetryDelayMs(error, attempt, options = {}) {
    const baseDelayMs = Number(options.baseDelayMs) || RETRY_BASE_DELAY_MS
    const maxDelayMs = Number(options.maxDelayMs) || RETRY_MAX_DELAY_MS
    const randomFn = typeof options.randomFn === "function" ? options.randomFn : Math.random
    const nowMs = typeof options.nowFn === "function" ? options.nowFn() : Date.now()
    const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, Number(attempt) || 0)))
    const jitter = Math.floor(Math.max(0, Math.min(1, Number(randomFn()) || 0)) * Math.min(500, baseDelayMs))
    return Math.max(exponential + jitter, parseRetryAfterMs(error, nowMs))
}

function safeErrorReason(error) {
    const status = getErrorStatus(error)
    const raw = String(error?.message || "Unknown provider error")
        .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
        .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
        .slice(0, 240)
    return [status ? `HTTP ${status}` : "", raw].filter(Boolean).join(" ")
}

function classifyProviderError(error) {
    const status = getErrorStatus(error)
    if (error?.code === "AI_TIMEOUT" || error?.name === "AbortError") return "timeout"
    if (error?.code === "AI_EMPTY_RESPONSE") return "empty"
    if (status === 429) return "rateLimit"
    if (status >= 500 && status <= 599) return "serverError"
    return "other"
}

function isRetryableError(error) {
    const status = getErrorStatus(error)
    if (error?.code === "AI_TIMEOUT" || error?.name === "AbortError") return true
    if ([408, 409, 425, 429].includes(status)) return true
    return status >= 500 && status <= 599
}

function isCooldownFailure(error) {
    return ["timeout", "rateLimit", "serverError"].includes(classifyProviderError(error))
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

function remainingDeadlineMs(deadlineAt, nowFn = Date.now) {
    if (!Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY
    return Math.max(0, deadlineAt - nowFn())
}

function createTotalTimeoutError() {
    const error = new Error("AI request exceeded the total response deadline")
    error.code = "AI_TOTAL_TIMEOUT"
    return error
}

function recordLatency(providerName, latencyMs) {
    const stats = providerStats[providerName]
    const latency = Math.max(0, Math.floor(Number(latencyMs) || 0))
    stats.lastLatencyMs = latency
    stats.totalLatencyMs += latency
    const attempts = stats.success + stats.attemptFailures
    stats.averageLatencyMs = attempts ? Math.round(stats.totalLatencyMs / attempts) : 0
    recordTiming(`ai.provider.${providerName}`, latency)
}

function recordAttemptFailure(providerName, error, nowMs) {
    const stats = providerStats[providerName]
    const category = classifyProviderError(error)
    stats.attemptFailures++
    stats.lastFailureAt = nowMs
    stats.lastError = safeErrorReason(error)
    recordLatency(providerName, error?.aiLatencyMs)
    if (category === "rateLimit") stats.rateLimits++
    else if (category === "timeout") stats.timeouts++
    else if (category === "empty") stats.emptyResponses++
    else if (category === "serverError") stats.serverErrors++
    else stats.otherErrors++
    if (isCooldownFailure(error)) providerHealth[providerName].consecutiveTransientFailures++
    return category
}

function openProviderCooldown(providerName, error, nowMs) {
    const health = providerHealth[providerName]
    const retryAfterMs = parseRetryAfterMs(error, nowMs)
    if (health.consecutiveTransientFailures < TRANSIENT_FAILURE_THRESHOLD && retryAfterMs <= 0) return 0
    const exponent = Math.max(0, health.consecutiveTransientFailures - TRANSIENT_FAILURE_THRESHOLD)
    const cooldownMs = Math.min(COOLDOWN_MAX_MS, Math.max(retryAfterMs, COOLDOWN_BASE_MS * (2 ** exponent)))
    health.cooldownUntil = Math.max(health.cooldownUntil, nowMs + cooldownMs)
    providerStats[providerName].cooldowns++
    return cooldownMs
}

function getCooldownRemainingMs(providerName, nowMs = Date.now()) {
    const health = providerHealth[providerName]
    if (!health?.cooldownUntil) return 0
    const remaining = health.cooldownUntil - nowMs
    if (remaining > 0) return remaining
    health.cooldownUntil = 0
    // A provider leaving cooldown is treated as a probe candidate, not fully healthy.
    health.consecutiveTransientFailures = Math.max(0, TRANSIENT_FAILURE_THRESHOLD - 1)
    return 0
}

function recordProviderSuccess(providerName, latencyMs, nowMs, fallback) {
    const stats = providerStats[providerName]
    stats.success++
    stats.lastSuccessAt = nowMs
    stats.lastError = null
    if (fallback) stats.fallbackSuccess++
    recordLatency(providerName, latencyMs)
    providerHealth[providerName].consecutiveTransientFailures = 0
    providerHealth[providerName].cooldownUntil = 0
}

async function callProvider(providerName, messages, options = {}) {
    const provider = PROVIDERS[providerName]
    if (!provider?.client) {
        const error = new Error(`${provider?.label || providerName} not configured`)
        error.code = "AI_PROVIDER_NOT_CONFIGURED"
        throw error
    }

    const nowFn = typeof options.nowFn === "function" ? options.nowFn : Date.now
    const startedAt = nowFn()
    const controller = typeof AbortController === "function" ? new AbortController() : null
    try {
        const response = await withTimeout(
            provider.client.chat.completions.create({
                model: provider.model,
                messages,
                max_tokens: options.maxTokens,
                temperature: options.temperature,
            }, controller ? { signal: controller.signal } : undefined),
            options.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS,
            controller
        )
        return {
            content: extractResponseContent(response),
            provider: providerName,
            model: provider.model,
            latencyMs: Math.max(0, nowFn() - startedAt),
            usage: response?.usage || null,
        }
    } catch (error) {
        error.aiLatencyMs = Math.max(0, nowFn() - startedAt)
        throw error
    }
}

async function executeProviderChain(messages, options = {}) {
    const errors = []
    let configuredCount = 0
    let attemptedCount = 0
    let cooldownSkipped = 0
    const nowFn = typeof options.nowFn === "function" ? options.nowFn : Date.now
    const sleepFn = typeof options.sleepFn === "function" ? options.sleepFn : sleep
    const randomFn = typeof options.randomFn === "function" ? options.randomFn : Math.random
    const providerOrder = normalizeProviderOrder(options.providerOrder)

    for (const providerName of providerOrder) {
        const provider = PROVIDERS[providerName]
        if (!provider?.client) continue
        configuredCount++

        const cooldownRemaining = getCooldownRemainingMs(providerName, nowFn())
        if (cooldownRemaining > 0) {
            cooldownSkipped++
            providerStats[providerName].skippedCooldown++
            console.warn(`[AI] ${provider.label} cooling down; using fallback`)
            continue
        }

        const fallback = attemptedCount > 0 || cooldownSkipped > 0
        if (fallback) providerStats[providerName].fallbackAttempts++
        attemptedCount++

        for (let attempt = 0; attempt <= (options.retries || 0); attempt++) {
            const remainingMs = remainingDeadlineMs(options.deadlineAt, nowFn)
            if (remainingMs <= 0) throw createTotalTimeoutError()

            try {
                const result = await callProvider(providerName, messages, {
                    ...options,
                    timeoutMs: Math.max(1, Math.min(options.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS, remainingMs)),
                    nowFn,
                })
                lastUsed = providerName
                recordProviderSuccess(providerName, result.latencyMs, nowFn(), fallback)
                console.log(`[AI] ${provider.label} responded in ${result.latencyMs}ms${fallback ? " via fallback" : ""}`)
                return result
            } catch (error) {
                const failureTime = nowFn()
                const reason = safeErrorReason(error)
                recordAttemptFailure(providerName, error, failureTime)
                const delayMs = calculateRetryDelayMs(error, attempt, { randomFn, nowFn })
                const remainingAfterFailure = remainingDeadlineMs(options.deadlineAt, nowFn)
                const willRetry = isRetryableError(error)
                    && attempt < (options.retries || 0)
                    && delayMs < remainingAfterFailure

                if (willRetry) {
                    providerStats[providerName].retries++
                    console.warn(`[AI] ${provider.label} temporary failure; retrying in ${delayMs}ms`)
                    await sleepFn(delayMs)
                    continue
                }

                providerStats[providerName].failure++
                const cooldownMs = isCooldownFailure(error) ? openProviderCooldown(providerName, error, failureTime) : 0
                console.warn(`[AI] ${provider.label} failed: ${reason}${cooldownMs ? `; cooldown ${Math.ceil(cooldownMs / 1000)}s` : ""}`)
                errors.push(`${provider.label}: ${reason}`)
                break
            }
        }
    }

    if (!configuredCount) throw new Error("No AI providers are configured")
    if (!attemptedCount && cooldownSkipped) {
        const error = new Error("All configured AI providers are temporarily cooling down")
        error.code = "AI_PROVIDERS_COOLING_DOWN"
        throw error
    }
    if (remainingDeadlineMs(options.deadlineAt, nowFn) <= 0) throw createTotalTimeoutError()
    throw new Error(`All AI providers failed — ${errors.join(" | ")}`)
}

function getProviderStatus(name, nowMs = Date.now()) {
    const stats = providerStats[name]
    const health = providerHealth[name]
    const cooldownRemainingMs = Math.max(0, health.cooldownUntil - nowMs)
    return {
        ...JSON.parse(JSON.stringify(stats)),
        consecutiveTransientFailures: health.consecutiveTransientFailures,
        cooldownUntil: health.cooldownUntil || null,
        cooldownRemainingMs,
        health: cooldownRemainingMs > 0 ? "cooldown" : (health.consecutiveTransientFailures ? "probing" : "healthy"),
    }
}

function getReliabilityStatus() {
    return {
        geminiConfigured: Boolean(PROVIDERS.gemini.client),
        groqConfigured: Boolean(PROVIDERS.groq.client),
        openRouterConfigured: Boolean(PROVIDERS.openrouter.client),
        lastUsed,
        defaultProviderOrder: [...DEFAULT_PROVIDER_ORDER],
        models: { gemini: GEMINI_MODEL, groq: GROQ_MODEL, openrouter: OPENROUTER_MODEL },
        defaults: {
            providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
            totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
            retryBaseDelayMs: RETRY_BASE_DELAY_MS,
            retryMaxDelayMs: RETRY_MAX_DELAY_MS,
            cooldownBaseMs: COOLDOWN_BASE_MS,
            cooldownMaxMs: COOLDOWN_MAX_MS,
            transientFailureThreshold: TRANSIENT_FAILURE_THRESHOLD,
        },
        providerStats: Object.fromEntries(DEFAULT_PROVIDER_ORDER.map(name => [name, getProviderStatus(name)])),
    }
}

function resetProviderStateForTests() {
    lastUsed = "none"
    for (const name of DEFAULT_PROVIDER_ORDER) {
        Object.assign(providerStats[name], createProviderStats())
        Object.assign(providerHealth[name], createProviderHealth())
    }
}

module.exports = {
    callProvider,
    executeProviderChain,
    safeErrorReason,
    remainingDeadlineMs,
    normalizeProviderOrder,
    isRetryableError,
    parseRetryAfterMs,
    calculateRetryDelayMs,
    classifyProviderError,
    getReliabilityStatus,
    resetProviderStateForTests,
    gemini: PROVIDERS.gemini.client,
    groq: PROVIDERS.groq.client,
    openrouter: PROVIDERS.openrouter.client,
    GEMINI_MODEL,
    GROQ_MODEL,
    OPENROUTER_MODEL,
    DEFAULT_PROVIDER_ORDER,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    DEFAULT_TOTAL_TIMEOUT_MS,
}
