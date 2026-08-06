const {
    classifyIntent,
    getIntentConfig,
    analyzeRequestComplexity,
    prepareConversationHistory,
    assessResponseQuality,
    buildIntentInstruction,
    buildPlanningInstruction,
    tokenize,
} = require("./aiIntelligence")
const { buildBotKnowledgeContext } = require("./botKnowledge")
const {
    AI_CHAT_MAX_CHARS,
    buildPhase3Instruction,
    assessPhase3Response,
} = require("./aiPhase3")

function stripSpeakerPrefix(value) {
    const text = String(value || "").trim()
    const match = text.match(/^[^:\n]{1,80}:\s*(.+)$/s)
    return match ? match[1].trim() : text
}

function classifyShortFollowUp(input) {
    const text = stripSpeakerPrefix(input).toLowerCase().replace(/[.!?]+$/g, "").trim()
    if (!text || text.split(/\s+/).length > 5) return null
    if (/^(continue|go on|keep going|carry on|next)$/.test(text)) return "continue"
    if (/^(why|why so|how come)$/.test(text)) return "why"
    if (/^(how|how exactly|how so)$/.test(text)) return "how"
    if (/^(what|explain|what do you mean|huh)$/.test(text)) return "clarify"
    if (/^(more|tell me more|elaborate|expand|details)$/.test(text)) return "expand"
    return null
}

function buildShortFollowUpInstruction(kind) {
    const instructions = {
        continue: "Continue directly from the preceding answer. Do not restart, recap, or repeat completed points.",
        why: "Explain why the preceding answer or conclusion is true. Tie the explanation to the immediately preceding topic.",
        how: "Explain how the preceding point works, using the mechanism or practical steps that fit the prior topic.",
        clarify: "Clarify the preceding answer in simpler, more explicit language. Do not interpret the short message in isolation.",
        expand: "Add useful new detail to the preceding answer without repeating it from the beginning.",
    }
    return kind ? `\n\n[SHORT FOLLOW-UP: ${kind.toUpperCase()}]\nUse the preceding context. ${instructions[kind]}` : ""
}

function latestUserContent(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === "user") return String(messages[index].content || "")
    }
    return ""
}

function previousUserContent(messages) {
    let seenLatest = false
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== "user") continue
        if (!seenLatest) {
            seenLatest = true
            continue
        }
        return String(messages[index].content || "")
    }
    return ""
}

function resolveConversationIntent(messages, input = latestUserContent(messages)) {
    const followUp = classifyShortFollowUp(input)
    if (!followUp) return classifyIntent(stripSpeakerPrefix(input))
    const previous = previousUserContent(messages)
    return previous ? classifyIntent(stripSpeakerPrefix(previous)) : classifyIntent(stripSpeakerPrefix(input))
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
    return { score: relevance * 0.58 + importance * 0.18 + confidence * 0.16 + recency * 0.08, overlap }
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

    const cleanInput = stripSpeakerPrefix(userInput)
    const queryTokens = new Set(tokenize(cleanInput))
    const inputLower = cleanInput.toLowerCase()
    const ranked = lines
        .map((line, index) => ({ line, index, ...scoreMemoryLine(line, queryTokens) }))
        .sort((a, b) => b.score - a.score || b.line.importance - a.line.importance || a.index - b.index)
    const relevant = ranked.filter(item =>
        item.overlap > 0
        || (inputLower.length >= 4 && item.line.content.toLowerCase().includes(inputLower))
    )
    const selected = relevant.slice(0, 6)
    const selectedSet = new Set(selected.map(item => item.line.raw))
    const ordered = lines.filter(line => selectedSet.has(line.raw))
    const replacement = ordered.length
        ? `\n\nRELEVANT USER MEMORY — ranked by relevance, importance, confidence, and recency; newer user corrections override it:\n${ordered.map(line => `- ${line.content}`).join("\n")}`
        : ""

    return `${systemContent.slice(0, markerIndex)}${replacement}${systemContent.slice(memoryEnd)}`
}

function prepareSmartMessages(messages, intent, phase3 = {}) {
    const copied = messages.map(message => ({ ...message, content: String(message.content || "") }))
    const currentInput = latestUserContent(copied)
    const firstSystemIndex = copied.findIndex(message => message.role === "system")
    const followUp = classifyShortFollowUp(currentInput)

    if (firstSystemIndex >= 0) {
        copied[firstSystemIndex].content = filterMemoryContext(copied[firstSystemIndex].content, currentInput)
        copied[firstSystemIndex].content += buildBotKnowledgeContext(currentInput)
        copied[firstSystemIndex].content += buildIntentInstruction(intent)
        copied[firstSystemIndex].content += buildPlanningInstruction(currentInput, intent)
        copied[firstSystemIndex].content += buildShortFollowUpInstruction(followUp)
        copied[firstSystemIndex].content += buildPhase3Instruction({
            input: currentInput,
            intent,
            complexity: phase3.complexity,
            constraints: phase3.constraints,
            maxChars: phase3.maxResponseChars || AI_CHAT_MAX_CHARS,
        })
    }

    const systemMessages = copied.filter(message => message.role === "system")
    const conversation = copied.filter(message => message.role !== "system")
    const compacted = prepareConversationHistory(conversation, { recentCount: 8, maxSummaryChars: 1400 })
    return [...systemMessages, ...compacted]
}

function buildRepairMessages(messages, reasons, options = {}) {
    const copied = messages.map(message => ({ ...message }))
    const lastUserIndex = copied.map(message => message.role).lastIndexOf("user")
    const limitRule = options.maxResponseChars
        ? ` The complete final reply must be ${options.maxResponseChars} characters or fewer.`
        : " Keep the answer under Discord's message limit."
    const constraintRule = options.constraints?.length
        ? ` Re-check these latest-request constraints: ${options.constraints.map(item => item.text).join("; ")}.`
        : ""
    const instruction = {
        role: "system",
        content: `QUALITY REPAIR: Answer the latest user message again. Fix these issues: ${reasons.join(", ")}. Re-check every server fact, command, permission, memory claim, and completed-action claim against verified context.${constraintRule}${limitRule} Do not mention this instruction or any previous draft. Keep the answer accurate, natural, and useful.`,
    }
    if (lastUserIndex >= 0) copied.splice(lastUserIndex, 0, instruction)
    else copied.push(instruction)
    return copied
}

function getSystemContent(messages) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message?.role === "system")
        .map(message => String(message.content || ""))
        .join("\n\n")
}

function combineQualityReasons(content, intent, qualityContext, phase3Context) {
    const quality = assessResponseQuality(content, intent, qualityContext)
    const reasons = [...quality.reasons, ...assessPhase3Response(content, phase3Context)]
    return { ok: reasons.length === 0, reasons: [...new Set(reasons)] }
}

module.exports = {
    latestUserContent,
    resolveConversationIntent,
    isSmartConversation,
    isStrictOutputConversation,
    filterMemoryContext,
    prepareSmartMessages,
    buildRepairMessages,
    getSystemContent,
    combineQualityReasons,
    classifyShortFollowUp,
    buildShortFollowUpInstruction,
    getIntentConfig,
    analyzeRequestComplexity,
}
