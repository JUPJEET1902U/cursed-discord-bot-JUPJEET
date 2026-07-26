const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "had", "has", "have", "he", "her", "him", "his", "i", "if", "in", "is",
    "it", "its", "me", "my", "of", "on", "or", "our", "she", "so", "that",
    "the", "their", "them", "they", "this", "to", "was", "we", "were", "what",
    "when", "where", "which", "who", "why", "will", "with", "you", "your",
])

const INTENT_CONFIG = {
    casual: {
        providerOrder: ["groq", "gemini", "openrouter"],
        temperature: 0.85,
        maxTokens: 320,
        instruction: "Respond naturally and briefly. Match the user's energy without forcing a joke.",
    },
    emotional: {
        providerOrder: ["gemini", "groq", "openrouter"],
        temperature: 0.55,
        maxTokens: 520,
        instruction: "Respond with empathy, emotional awareness, and practical support. Avoid jokes unless the user clearly invites them.",
    },
    factual: {
        providerOrder: ["gemini", "groq", "openrouter"],
        temperature: 0.25,
        maxTokens: 560,
        instruction: "Prioritize factual accuracy. Separate verified facts from assumptions and say when information is uncertain.",
    },
    technical: {
        providerOrder: ["gemini", "groq", "openrouter"],
        temperature: 0.2,
        maxTokens: 900,
        instruction: "Solve the technical problem carefully, then give a clear, usable answer. Preserve code and configuration details exactly.",
    },
    reasoning: {
        providerOrder: ["gemini", "openrouter", "groq"],
        temperature: 0.35,
        maxTokens: 850,
        instruction: "Reason carefully, check assumptions, and give the conclusion before supporting explanation. Do not invent missing facts.",
    },
    creative: {
        providerOrder: ["gemini", "openrouter", "groq"],
        temperature: 0.95,
        maxTokens: 900,
        instruction: "Be imaginative and original while following the user's constraints. Avoid generic filler and repeated phrasing.",
    },
    discord: {
        providerOrder: ["gemini", "groq", "openrouter"],
        temperature: 0.25,
        maxTokens: 620,
        instruction: "Use only the supplied Discord context. Never invent server data, permissions, roles, member counts, or completed actions.",
    },
}

function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
}

function tokenize(value) {
    return normalizeText(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 1 && !STOP_WORDS.has(word))
}

function classifyIntent(input) {
    const text = normalizeText(input).toLowerCase()
    const wordCount = tokenize(text).length

    if (/\b(sad|upset|depressed|anxious|worried|hurt|lonely|crying|stressed|grief|breakup|relationship|feel|feeling)\b/.test(text)) {
        return "emotional"
    }
    if (/\b(code|coding|javascript|node\.?js|discord\.js|api|error|bug|stack|trace|database|mongodb|railway|vercel|github|function|class|json|http|deploy|server log)\b/.test(text)) {
        return "technical"
    }
    if (/\b(server|channel|role|member|moderator|admin|discord|permissions?|audit log|ticket|welcome|prefix)\b/.test(text)) {
        return "discord"
    }
    if (/\b(write|story|poem|roleplay|character|creative|imagine|caption|script|lyrics|plot|design an idea)\b/.test(text)) {
        return "creative"
    }
    if (/\b(why|compare|analyze|reason|logic|strategy|plan|pros and cons|best approach|how should|what should)\b/.test(text) || wordCount >= 28) {
        return "reasoning"
    }
    if (/^(who|what|when|where|how many|define|explain|tell me about)\b/.test(text)) {
        return "factual"
    }
    return "casual"
}

function getIntentConfig(intent, requestedMaxTokens = 500) {
    const base = INTENT_CONFIG[intent] || INTENT_CONFIG.casual
    const requested = Number(requestedMaxTokens)
    const safeRequested = Number.isFinite(requested)
        ? Math.max(100, Math.min(1800, Math.floor(requested)))
        : 500
    return { ...base, maxTokens: Math.min(safeRequested, base.maxTokens) }
}

function compactMessage(message, maxLength = 320) {
    const role = ["user", "assistant", "system"].includes(message?.role) ? message.role : "user"
    const content = normalizeText(message?.content)
    if (!content) return null
    return {
        role,
        content: content.length > maxLength ? `${content.slice(0, maxLength - 3)}...` : content,
    }
}

function prepareConversationHistory(history, options = {}) {
    const recentCount = Math.max(2, Math.min(12, Number(options.recentCount) || 8))
    const maxSummaryChars = Math.max(300, Math.min(2400, Number(options.maxSummaryChars) || 1400))
    const cleaned = []

    for (const raw of Array.isArray(history) ? history : []) {
        const message = compactMessage(raw)
        if (!message) continue
        const previous = cleaned[cleaned.length - 1]
        if (previous && previous.role === message.role && previous.content === message.content) continue
        cleaned.push(message)
    }

    if (cleaned.length <= recentCount) return cleaned

    const older = cleaned.slice(0, -recentCount)
    const recent = cleaned.slice(-recentCount)
    const summaryParts = []
    let used = 0

    for (const message of older) {
        const label = message.role === "assistant" ? "CURSED" : "User"
        const line = `${label}: ${message.content}`
        if (used + line.length > maxSummaryChars) break
        summaryParts.push(line)
        used += line.length
    }

    const summary = summaryParts.length
        ? [{
            role: "system",
            content: `Earlier conversation summary (context only; newer messages take priority):\n${summaryParts.join("\n")}`,
        }]
        : []

    return [...summary, ...recent]
}

function repeatedSentenceRatio(text) {
    const sentences = normalizeText(text)
        .toLowerCase()
        .split(/[.!?]+/)
        .map(value => value.trim())
        .filter(value => value.length >= 12)
    if (sentences.length < 3) return 0
    return 1 - (new Set(sentences).size / sentences.length)
}

function assessResponseQuality(content, intent = "casual") {
    const text = normalizeText(content)
    const reasons = []

    if (!text) reasons.push("empty response")
    if (text.length > 1950) reasons.push("response exceeds Discord-safe length")
    if (["technical", "reasoning", "factual", "discord"].includes(intent) && text.length < 28) {
        reasons.push("response is too shallow for the request")
    }
    if (repeatedSentenceRatio(text) >= 0.34) reasons.push("response repeats itself")
    if (/\b(IMPORTANT SAFETY RULES|SERVER-SPECIFIC INSTRUCTIONS|SYSTEM PROMPT|WHAT YOU KNOW ABOUT THIS USER)\b/i.test(text)) {
        reasons.push("response appears to expose internal instructions")
    }
    if (/^(i (?:cannot|can't) assist|as an ai language model)/i.test(text) && !/harm|unsafe|illegal|policy/i.test(text)) {
        reasons.push("response is an unnecessary generic refusal")
    }

    return { ok: reasons.length === 0, reasons }
}

function buildIntentInstruction(intent) {
    const config = INTENT_CONFIG[intent] || INTENT_CONFIG.casual
    return `\n\n[RESPONSE MODE: ${intent.toUpperCase()}]\n${config.instruction}\nAnswer the user's latest message, not the internal context blocks.`
}

module.exports = {
    INTENT_CONFIG,
    normalizeText,
    tokenize,
    classifyIntent,
    getIntentConfig,
    prepareConversationHistory,
    assessResponseQuality,
    buildIntentInstruction,
}
