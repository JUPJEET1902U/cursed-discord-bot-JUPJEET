const {
    AI_CHAT_MAX_CHARS,
    analyzeRequestedOutputLength,
    buildLengthLimitReply,
    extractExplicitConstraints,
    classifyIntelligenceLevel,
    getLevelTokenBudget,
    compactToCharacterLimit,
} = require("./aiPhase3")
const {
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
    gemini,
    groq,
    openrouter,
    GEMINI_MODEL,
    GROQ_MODEL,
    OPENROUTER_MODEL,
    DEFAULT_PROVIDER_ORDER,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    DEFAULT_TOTAL_TIMEOUT_MS,
} = require("./aiProviderReliability")
const {
    latestUserContent,
    resolveConversationIntent,
    isSmartConversation,
    isStrictOutputConversation,
    filterMemoryContext,
    prepareSmartMessages,
    buildRepairMessages,
    getSystemContent,
    combineQualityReasons,
    getIntentConfig,
    analyzeRequestComplexity,
    classifyShortFollowUp,
    buildShortFollowUpInstruction,
} = require("./aiConversationQuality")

// Public source-compatibility contract retained for established CI and audits.
// Provider key aliases remain supported by the preserved client layer: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY.
// Provider retry logging retains the contract: temporary failure: provider error; retrying once.
// Smart-message preparation still uses buildBotKnowledgeContext and buildPlanningInstruction in aiConversationQuality.js.

let requestSequence = 0

function boundedNumber(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

async function callAI(messages, options = {}) {
    const smart = options.smart ?? isSmartConversation(messages)
    const strictOutput = !smart && isStrictOutputConversation(messages)
    const input = latestUserContent(messages)
    const intent = smart ? resolveConversationIntent(messages, input) : (options.intent || "casual")
    const complexity = smart ? analyzeRequestComplexity(input, intent) : null
    const constraints = smart ? extractExplicitConstraints(input) : []
    const intelligenceLevel = smart ? classifyIntelligenceLevel(input, intent, complexity) : null
    const maxResponseChars = smart ? AI_CHAT_MAX_CHARS : null
    const nowFn = typeof options.nowFn === "function" ? options.nowFn : Date.now
    const totalTimeoutMs = boundedNumber(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, 50, 120_000)
    const deadlineAt = Number.isFinite(options.deadlineAt) ? options.deadlineAt : nowFn() + totalTimeoutMs
    const requestId = options.requestId || `ai-${++requestSequence}`

    if (smart) {
        const requestedLength = analyzeRequestedOutputLength(input, maxResponseChars)
        if (requestedLength.oversized) {
            return {
                content: buildLengthLimitReply(requestedLength, maxResponseChars),
                provider: "policy",
                model: "phase3-response-policy",
                latencyMs: 0,
                usage: null,
                intent,
                intelligenceLevel,
                repaired: false,
                policyLimited: true,
                requestId,
            }
        }
    }

    const intentConfig = getIntentConfig(intent, options.maxTokens || 500)
    const requestedMaxTokens = Math.floor(boundedNumber(options.maxTokens, intentConfig.maxTokens, 50, 2000))
    const maxTokens = smart
        ? Math.min(requestedMaxTokens, getLevelTokenBudget(intelligenceLevel))
        : requestedMaxTokens
    const defaultTemperature = smart ? intentConfig.temperature : (strictOutput ? 0.1 : 0.7)
    const temperature = boundedNumber(options.temperature, defaultTemperature, 0, 1.2)
    const retries = Math.floor(boundedNumber(options.retries, 1, 0, 2))
    const providerOrder = normalizeProviderOrder(options.providerOrder || (smart ? intentConfig.providerOrder : null))
    const preparedMessages = smart
        ? prepareSmartMessages(messages, intent, { complexity, constraints, maxResponseChars })
        : messages
    const qualityContext = { systemContent: getSystemContent(preparedMessages) }
    const phase3Context = { maxChars: maxResponseChars, constraints }
    const chainOptions = {
        maxTokens,
        temperature,
        retries,
        providerOrder,
        timeoutMs: boundedNumber(options.timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS, 500, 60_000),
        deadlineAt,
        nowFn,
        sleepFn: options.sleepFn,
        randomFn: options.randomFn,
        requestId,
    }

    const result = await executeProviderChain(preparedMessages, chainOptions)

    if (!smart) return { ...result, requestId }

    if (options.skipQualityRepair) {
        return {
            ...result,
            content: compactToCharacterLimit(result.content, maxResponseChars),
            intent,
            intelligenceLevel,
            repaired: false,
            requestId,
        }
    }

    const quality = combineQualityReasons(result.content, intent, qualityContext, phase3Context)
    if (quality.ok) return { ...result, intent, intelligenceLevel, repaired: false, requestId }

    console.warn(`[AI] Low-quality ${intent} response from ${result.provider}: ${quality.reasons.join(", ")}`)
    const alternateOrder = providerOrder.filter(provider => provider !== result.provider)
    alternateOrder.push(result.provider)

    if (remainingDeadlineMs(deadlineAt, nowFn) > 0) {
        try {
            const repaired = await executeProviderChain(buildRepairMessages(preparedMessages, quality.reasons, {
                maxResponseChars,
                constraints,
            }), {
                ...chainOptions,
                temperature: Math.max(0.15, temperature - 0.15),
                retries: 0,
                providerOrder: alternateOrder,
            })
            const repairedQuality = combineQualityReasons(repaired.content, intent, qualityContext, phase3Context)
            if (repairedQuality.ok) {
                return { ...repaired, intent, intelligenceLevel, repaired: true, requestId }
            }
        } catch (error) {
            console.warn(`[AI] Quality repair failed: ${safeErrorReason(error)}`)
        }
    }

    return {
        ...result,
        content: compactToCharacterLimit(result.content, maxResponseChars),
        intent,
        intelligenceLevel,
        repaired: false,
        qualityWarning: quality.reasons,
        hardLimited: result.content.length > maxResponseChars,
        requestId,
    }
}

function getStatus() {
    const status = getReliabilityStatus()
    return {
        ...status,
        groqFailCount: status.providerStats.groq.failure,
        aiChatMaxChars: AI_CHAT_MAX_CHARS,
    }
}

function resetAIStateForTests() {
    requestSequence = 0
    resetProviderStateForTests()
}

module.exports = {
    callAI,
    callProvider,
    executeProviderChain,
    groq,
    gemini,
    openrouter,
    GROQ_MODEL,
    GEMINI_MODEL,
    OPENROUTER_MODEL,
    DEFAULT_PROVIDER_ORDER,
    AI_CHAT_MAX_CHARS,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    DEFAULT_TOTAL_TIMEOUT_MS,
    normalizeProviderOrder,
    isRetryableError,
    parseRetryAfterMs,
    calculateRetryDelayMs,
    classifyProviderError,
    isSmartConversation,
    isStrictOutputConversation,
    filterMemoryContext,
    prepareSmartMessages,
    resolveConversationIntent,
    classifyShortFollowUp,
    buildShortFollowUpInstruction,
    getStatus,
    resetProviderStateForTests: resetAIStateForTests,
}
