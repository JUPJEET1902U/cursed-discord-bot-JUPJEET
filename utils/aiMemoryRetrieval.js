const { getUserLongTermMemories } = require("./longTermMemory")

const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i",
    "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "their", "them",
    "they", "this", "to", "was", "we", "were", "what", "when", "where", "who", "why",
    "with", "you", "your",
])

const TYPE_LABELS = {
    like: "Likes",
    dislike: "Dislikes",
    game: "Favorite games",
    anime: "Favorite anime",
    music: "Favorite music",
    friend: "Friends and people",
    friendship: "Friendships",
    personality: "Personality",
    note: "Notes",
    fact: "Known facts",
}

function tokens(value) {
    return new Set(
        String(value || "")
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(word => word.length > 1 && !STOP_WORDS.has(word))
    )
}

function memoryScore(memory, queryTokens, now = Date.now()) {
    const memoryTokens = tokens(`${memory.content || ""} ${(memory.tags || []).join(" ")} ${memory.type || ""}`)
    let shared = 0
    for (const token of queryTokens) if (memoryTokens.has(token)) shared++

    const overlap = queryTokens.size ? shared / queryTokens.size : 0
    const importance = Math.max(1, Math.min(5, Number(memory.importance) || 1)) / 5
    const ageMs = Math.max(0, now - new Date(memory.extractedAt || 0).getTime())
    const recency = Number.isFinite(ageMs) ? Math.max(0, 1 - ageMs / (180 * 24 * 60 * 60 * 1000)) : 0

    return overlap * 7 + importance * 2 + recency
}

function selectRelevantMemories(memories, query, limit = 8) {
    const safeLimit = Math.max(1, Math.min(12, Number(limit) || 8))
    const queryTokens = tokens(query)
    const ranked = (Array.isArray(memories) ? memories : [])
        .filter(memory => memory && String(memory.content || "").trim())
        .map(memory => ({ memory, score: memoryScore(memory, queryTokens) }))
        .sort((a, b) => b.score - a.score || new Date(b.memory.extractedAt || 0) - new Date(a.memory.extractedAt || 0))

    if (!ranked.length) return []

    const directlyRelevant = ranked.filter(item => item.score >= 1.4)
    if (directlyRelevant.length) return directlyRelevant.slice(0, safeLimit).map(item => item.memory)

    // A user may ask a generic follow-up with no matching keywords. Preserve only
    // the three strongest memories instead of injecting the entire profile.
    return ranked.slice(0, Math.min(3, safeLimit)).map(item => item.memory)
}

function formatRelevantMemories(memories) {
    if (!memories.length) return ""
    const grouped = new Map()

    for (const memory of memories) {
        const type = memory.type || "fact"
        if (!grouped.has(type)) grouped.set(type, [])
        const content = String(memory.content || "").replace(/\s+/g, " ").trim().slice(0, 220)
        if (content && !grouped.get(type).includes(content)) grouped.get(type).push(content)
    }

    const lines = []
    for (const [type, items] of grouped.entries()) {
        if (!items.length) continue
        lines.push(`${TYPE_LABELS[type] || type}: ${items.slice(0, 4).join("; ")}`)
    }

    if (!lines.length) return ""
    return `\n\n[RELEVANT USER MEMORY — use only when it helps answer the latest message; newer user corrections override this]\n${lines.join("\n")}`
}

async function buildRelevantMemoryContext(userId, query, options = {}) {
    const memories = await getUserLongTermMemories(userId)
    return formatRelevantMemories(selectRelevantMemories(memories, query, options.limit || 8))
}

module.exports = {
    tokens,
    memoryScore,
    selectRelevantMemories,
    formatRelevantMemories,
    buildRelevantMemoryContext,
}
