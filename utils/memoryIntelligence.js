const MEMORY_STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
    "had", "has", "have", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or",
    "that", "the", "their", "them", "they", "this", "to", "was", "we", "were", "with",
    "you", "your", "user", "likes", "like", "fact", "note", "favorite", "favourite",
])

const GENERIC_MEMORY_TAGS = new Set([
    "user", "personal", "preference", "fact", "note", "memory", "general", "profile",
])

function normalizeMemoryText(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
}

function tokenizeMemory(value) {
    return normalizeMemoryText(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 1 && !MEMORY_STOP_WORDS.has(token))
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

function toDate(value) {
    const date = value instanceof Date ? value : new Date(value || 0)
    return Number.isNaN(date.getTime()) ? null : date
}

function calculateMemoryScore(memory, query, now = new Date()) {
    const queryTokens = new Set(tokenizeMemory(query))
    const memoryTokens = new Set([
        ...tokenizeMemory(memory?.content),
        ...(Array.isArray(memory?.tags) ? memory.tags.flatMap(tokenizeMemory) : []),
        ...tokenizeMemory(memory?.memoryKey),
    ])

    let overlap = 0
    for (const token of queryTokens) {
        if (memoryTokens.has(token)) overlap++
    }

    const relevance = queryTokens.size
        ? Math.min(1, overlap / Math.max(1, Math.min(queryTokens.size, 5)))
        : 0
    const importance = clampNumber(memory?.importance, 1, 1, 5) / 5
    const confidence = clampNumber(memory?.confidence, 0.65, 0, 1)

    const confirmedAt = toDate(memory?.lastConfirmedAt || memory?.extractedAt)
    const ageDays = confirmedAt
        ? Math.max(0, (now.getTime() - confirmedAt.getTime()) / 86_400_000)
        : 365
    const recency = Math.max(0.1, 1 / (1 + ageDays / 45))
    const explicitBonus = memory?.source === "explicit" ? 0.12 : 0
    const correctionBonus = memory?.source === "correction" ? 0.18 : 0

    return Number((
        relevance * 0.52
        + importance * 0.18
        + confidence * 0.16
        + recency * 0.14
        + explicitBonus
        + correctionBonus
    ).toFixed(6))
}

function rankMemories(memories, query, limit = 8, now = new Date()) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8))
    return (Array.isArray(memories) ? memories : [])
        .filter(memory => memory && memory.active !== false && normalizeMemoryText(memory.content))
        .map((memory, index) => ({
            memory,
            index,
            score: calculateMemoryScore(memory, query, now),
        }))
        .sort((a, b) => b.score - a.score
            || clampNumber(b.memory.importance, 1, 1, 5) - clampNumber(a.memory.importance, 1, 1, 5)
            || b.index - a.index)
        .slice(0, safeLimit)
        .map(item => ({ ...item.memory, relevanceScore: item.score }))
}

function deriveMemoryKey(memory) {
    const type = normalizeMemoryText(memory?.type || "fact").toLowerCase()
    const tags = (Array.isArray(memory?.tags) ? memory.tags : [])
        .flatMap(tokenizeMemory)
        .filter(tag => !GENERIC_MEMORY_TAGS.has(tag))
    const uniqueTags = [...new Set(tags)].slice(0, 2)
    const contentTokens = tokenizeMemory(memory?.content)
        .filter(token => !GENERIC_MEMORY_TAGS.has(token))
        .slice(0, 3)
    const keyParts = uniqueTags.length ? uniqueTags : contentTokens
    return `${type}:${keyParts.join("-") || "general"}`.slice(0, 120)
}

function normalizeMemoryOperation(operation) {
    const action = String(operation?.action || "upsert").toLowerCase()
    if (!["upsert", "delete", "clear_all"].includes(action)) return null

    if (action === "clear_all") return { action }

    if (action === "delete") {
        const match = normalizeMemoryText(operation?.match || operation?.content)
        const tags = Array.isArray(operation?.tags)
            ? operation.tags.map(normalizeMemoryText).filter(Boolean).slice(0, 5)
            : []
        if (match.length < 2 && !tags.length) return null
        return { action, match, tags }
    }

    const content = normalizeMemoryText(operation?.content).slice(0, 500)
    if (!content) return null
    const normalized = {
        action,
        type: normalizeMemoryText(operation?.type || "fact").toLowerCase(),
        content,
        importance: Math.round(clampNumber(operation?.importance, 2, 1, 5)),
        confidence: clampNumber(operation?.confidence, 0.72, 0.2, 1),
        tags: Array.isArray(operation?.tags)
            ? operation.tags.map(normalizeMemoryText).filter(Boolean).slice(0, 10)
            : [],
        source: ["explicit", "inferred", "correction"].includes(operation?.source)
            ? operation.source
            : "inferred",
    }
    normalized.memoryKey = deriveMemoryKey(normalized)
    return normalized
}

function memoryMatchesOperation(memory, operation) {
    if (!memory || !operation || operation.action !== "delete") return false
    const memoryText = `${memory.content || ""} ${(memory.tags || []).join(" ")} ${memory.memoryKey || ""}`.toLowerCase()
    const matchText = normalizeMemoryText(operation.match).toLowerCase()
    if (matchText && memoryText.includes(matchText)) return true

    const memoryTokens = new Set(tokenizeMemory(memoryText))
    const requestedTokens = new Set([
        ...tokenizeMemory(matchText),
        ...(operation.tags || []).flatMap(tokenizeMemory),
    ])
    if (!requestedTokens.size) return false

    let overlap = 0
    for (const token of requestedTokens) if (memoryTokens.has(token)) overlap++
    return overlap / requestedTokens.size >= 0.6
}

function isExplicitClearAllRequest(input) {
    const text = normalizeMemoryText(input).toLowerCase()
    return /^(?:please\s+)?(?:forget|delete|clear|remove)\s+(?:everything|all)(?:\s+(?:you\s+)?(?:remember|know|stored|saved))?(?:\s+about\s+me)?[.!]?$/i.test(text)
        || /^(?:please\s+)?wipe\s+(?:all\s+)?(?:my\s+)?memor(?:y|ies)[.!]?$/i.test(text)
}

module.exports = {
    normalizeMemoryText,
    tokenizeMemory,
    calculateMemoryScore,
    rankMemories,
    deriveMemoryKey,
    normalizeMemoryOperation,
    memoryMatchesOperation,
    isExplicitClearAllRequest,
}
