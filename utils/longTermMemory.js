/**
 * utils/longTermMemory.js
 * Persistent adaptive long-term user memory system.
 * Uses MongoDB when available and falls back to process memory.
 */

const mongoose = require("mongoose")
const { callAI } = require("./ai")
const logger = require("./logger")
const {
    rankMemories,
    deriveMemoryKey,
    normalizeMemoryOperation,
    memoryMatchesOperation,
    isExplicitClearAllRequest,
} = require("./memoryIntelligence")

const log = logger.child("LongTermMemory")
const MEMORY_TYPES = [
    "like", "dislike", "game", "anime", "music", "friend", "note", "fact",
    "friendship", "personality",
]

const memorySchema = new mongoose.Schema({
    userId:          { type: String, required: true, index: true },
    type:            { type: String, required: true, enum: MEMORY_TYPES },
    content:         { type: String, required: true, maxlength: 500 },
    importance:      { type: Number, default: 1, min: 1, max: 5 },
    confidence:      { type: Number, default: 0.65, min: 0, max: 1 },
    tags:            [{ type: String }],
    memoryKey:       { type: String, default: "fact:general", maxlength: 120 },
    source:          { type: String, enum: ["explicit", "inferred", "correction"], default: "inferred" },
    active:          { type: Boolean, default: true, index: true },
    extractedAt:     { type: Date, default: Date.now },
    lastConfirmedAt: { type: Date, default: Date.now },
    lastUsedAt:      { type: Date, default: null },
    useCount:        { type: Number, default: 0, min: 0 },
    supersededAt:    { type: Date, default: null },
})

memorySchema.index({ userId: 1, active: 1, importance: -1, lastConfirmedAt: -1 })
memorySchema.index({ userId: 1, memoryKey: 1, active: 1 })

let MemoryModel
try {
    MemoryModel = mongoose.model("LongTermMemory")
} catch {
    MemoryModel = mongoose.model("LongTermMemory", memorySchema)
}

const memoryFallback = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function activeQuery(userId) {
    return { userId, active: { $ne: false } }
}

async function getUserLongTermMemories(userId, options = {}) {
    const includeInactive = options.includeInactive === true
    if (isMongoConnected()) {
        try {
            const query = includeInactive ? { userId } : activeQuery(userId)
            return await MemoryModel.find(query)
                .sort({ importance: -1, lastConfirmedAt: -1, extractedAt: -1 })
                .limit(includeInactive ? 100 : 50)
                .lean()
        } catch (err) {
            if (err.message && err.message.includes("auth")) {
                log.error(`Auth error fetching memories for ${userId}: ${err.message}`)
            } else {
                log.error(`Failed to get memories for ${userId}: ${err.message}`)
            }
        }
    }
    const list = memoryFallback.get(userId) || []
    return includeInactive ? list : list.filter(memory => memory.active !== false)
}

function stringSimilarity(a, b) {
    const wordsA = new Set(String(a || "").toLowerCase().split(/\W+/).filter(Boolean))
    const wordsB = new Set(String(b || "").toLowerCase().split(/\W+/).filter(Boolean))
    if (!wordsA.size || !wordsB.size) return 0
    let shared = 0
    for (const word of wordsA) if (wordsB.has(word)) shared++
    return shared / Math.max(wordsA.size, wordsB.size)
}

function containsSensitiveMemory(content) {
    const patterns = [
        /\b[A-Za-z0-9_\-]{20,}\b/,
        /https?:\/\//i,
        /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
        /\b\d{7,}\b/,
        /process\.env/i,
        /password|secret|token|apikey|api_key/i,
    ]
    return patterns.some(pattern => pattern.test(content))
}

function normalizeType(type) {
    const value = String(type || "fact").toLowerCase()
    return MEMORY_TYPES.includes(value) ? value : "fact"
}

function buildEntry(userId, memory) {
    const normalized = normalizeMemoryOperation({ action: "upsert", ...memory })
    if (!normalized) return null
    if (containsSensitiveMemory(normalized.content)) return null

    return {
        userId,
        type: normalizeType(normalized.type),
        content: normalized.content,
        importance: normalized.importance,
        confidence: normalized.confidence,
        tags: normalized.tags,
        memoryKey: normalized.memoryKey || deriveMemoryKey(normalized),
        source: normalized.source,
        active: true,
        extractedAt: new Date(),
        lastConfirmedAt: new Date(),
        supersededAt: null,
    }
}

async function addLongTermMemory(userId, memory) {
    const entry = buildEntry(userId, memory)
    if (!entry) {
        if (memory?.content) log.debug(`Dropped invalid or sensitive memory for ${userId}`)
        return
    }

    if (isMongoConnected()) {
        try {
            const candidates = await MemoryModel.find({
                ...activeQuery(userId),
                $or: [
                    { type: entry.type },
                    { memoryKey: entry.memoryKey },
                ],
            }).lean()

            const nearDuplicate = candidates.find(candidate =>
                stringSimilarity(candidate.content, entry.content) >= 0.7
            )
            if (nearDuplicate) {
                await MemoryModel.findByIdAndUpdate(nearDuplicate._id, {
                    content: entry.content,
                    importance: Math.max(nearDuplicate.importance || 1, entry.importance),
                    confidence: Math.max(nearDuplicate.confidence || 0.65, entry.confidence),
                    tags: entry.tags.length ? entry.tags : nearDuplicate.tags,
                    memoryKey: entry.memoryKey,
                    source: entry.source === "correction" ? "correction" : (nearDuplicate.source || entry.source),
                    active: true,
                    lastConfirmedAt: entry.lastConfirmedAt,
                    supersededAt: null,
                })
                log.debug(`Confirmed existing memory for ${userId}: [${entry.type}] ${entry.content.slice(0, 40)}`)
                return
            }

            const conflicts = candidates.filter(candidate => candidate.memoryKey === entry.memoryKey)
            if (conflicts.length) {
                await MemoryModel.updateMany(
                    { _id: { $in: conflicts.map(memoryItem => memoryItem._id) } },
                    { active: false, supersededAt: new Date() }
                )
                entry.source = "correction"
            }

            await new MemoryModel(entry).save()
            log.debug(`Added memory for ${userId}: [${entry.type}] ${entry.content.slice(0, 40)}`)
            return
        } catch (err) {
            log.error(`Failed to add memory for ${userId}: ${err.message}`)
        }
    }

    const list = memoryFallback.get(userId) || []
    const active = list.filter(item => item.active !== false)
    const nearDuplicate = active.find(item =>
        (item.type === entry.type || item.memoryKey === entry.memoryKey)
        && stringSimilarity(item.content, entry.content) >= 0.7
    )

    if (nearDuplicate) {
        nearDuplicate.content = entry.content
        nearDuplicate.importance = Math.max(nearDuplicate.importance || 1, entry.importance)
        nearDuplicate.confidence = Math.max(nearDuplicate.confidence || 0.65, entry.confidence)
        nearDuplicate.tags = entry.tags.length ? entry.tags : nearDuplicate.tags
        nearDuplicate.memoryKey = entry.memoryKey
        nearDuplicate.lastConfirmedAt = entry.lastConfirmedAt
        nearDuplicate.active = true
    } else {
        for (const existing of active) {
            if (existing.memoryKey === entry.memoryKey) {
                existing.active = false
                existing.supersededAt = new Date()
                entry.source = "correction"
            }
        }
        list.push(entry)
        if (list.length > 100) list.splice(0, list.length - 100)
    }
    memoryFallback.set(userId, list)
}

async function deleteLongTermMemory(userId, memoryId) {
    if (isMongoConnected()) {
        try {
            const result = await MemoryModel.findOneAndDelete({ _id: memoryId, userId })
            return result !== null
        } catch (err) {
            log.error(`Failed to delete memory ${memoryId}: ${err.message}`)
            return false
        }
    }
    const list = memoryFallback.get(userId) || []
    const index = parseInt(memoryId)
    if (!Number.isNaN(index) && index >= 0 && index < list.length) {
        list.splice(index, 1)
        memoryFallback.set(userId, list)
        return true
    }
    return false
}

async function deleteMatchingMemories(userId, operation) {
    const normalized = normalizeMemoryOperation(operation)
    if (!normalized || normalized.action !== "delete") return 0
    const memories = await getUserLongTermMemories(userId)
    const matches = memories.filter(memory => memoryMatchesOperation(memory, normalized)).slice(0, 8)
    if (!matches.length) return 0

    if (isMongoConnected()) {
        try {
            await MemoryModel.updateMany(
                { userId, _id: { $in: matches.map(memory => memory._id) } },
                { active: false, supersededAt: new Date() }
            )
            return matches.length
        } catch (err) {
            log.error(`Failed to deactivate matching memories for ${userId}: ${err.message}`)
            return 0
        }
    }

    const list = memoryFallback.get(userId) || []
    const matchSet = new Set(matches)
    for (const memory of list) {
        if (matchSet.has(memory)) {
            memory.active = false
            memory.supersededAt = new Date()
        }
    }
    memoryFallback.set(userId, list)
    return matches.length
}

async function clearLongTermMemories(userId) {
    if (isMongoConnected()) {
        try {
            await MemoryModel.deleteMany({ userId })
            log.info(`Cleared all memories for ${userId}`)
            return
        } catch (err) {
            log.error(`Failed to clear memories for ${userId}: ${err.message}`)
        }
    }
    memoryFallback.delete(userId)
}

async function applyMemoryOperations(userId, operations) {
    for (const rawOperation of (Array.isArray(operations) ? operations : []).slice(0, 8)) {
        const operation = normalizeMemoryOperation(rawOperation)
        if (!operation) continue
        if (operation.action === "clear_all") {
            await clearLongTermMemories(userId)
            continue
        }
        if (operation.action === "delete") {
            await deleteMatchingMemories(userId, operation)
            continue
        }
        await addLongTermMemory(userId, operation)
    }
}

async function extractAndStoreMemories(userId, userMessage, botReply) {
    try {
        if (isExplicitClearAllRequest(userMessage)) {
            await clearLongTermMemories(userId)
            return
        }

        const result = await callAI([
            {
                role: "system",
                content: `You are CURSED's memory update extractor. Analyze only what the USER explicitly reveals, corrects, or asks to forget.
Output ONLY a valid JSON array with up to 6 operations.

Allowed operations:
1. Upsert a useful durable fact:
{"action":"upsert","type":"fact","content":"short factual statement","importance":1-5,"confidence":0.2-1,"tags":["topic"],"source":"explicit"}
2. Delete an outdated or explicitly forgotten memory:
{"action":"delete","match":"specific subject or old value","tags":["topic"]}
3. Clear all memory only when the user explicitly asks to forget everything:
{"action":"clear_all"}

Allowed types: like, dislike, game, anime, music, friend, note, fact, friendship, personality.
Correction rules:
- New explicit user corrections override old information.
- "I no longer X" or "forget X" should create a delete operation.
- "It is Railway, not Replit" should delete the old Replit fact and upsert the Railway fact with source correction.
- Do not infer personal facts from the bot reply.
- Do not store secrets, tokens, IDs, contact details, URLs, temporary moods, or one-off requests.
- If nothing durable changed, output [].
Output ONLY JSON.`
            },
            {
                role: "user",
                content: `User message: ${JSON.stringify(String(userMessage || "").slice(0, 1200))}\nBot reply for context only: ${JSON.stringify(String(botReply || "").slice(0, 800))}`
            }
        ], { maxTokens: 550, temperature: 0.1 })

        const match = result.content.trim().match(/\[[\s\S]*\]/)
        if (!match) return
        const operations = JSON.parse(match[0])
        if (!Array.isArray(operations)) return
        await applyMemoryOperations(userId, operations)
    } catch (err) {
        log.debug(`Memory extraction skipped for ${userId}: ${err.message}`)
    }
}

async function getRelevantMemories(userId, userInput = "", limit = 12) {
    const memories = await getUserLongTermMemories(userId)
    return rankMemories(memories, userInput, limit)
}

async function buildMemoryContext(userId, userInput = "") {
    const memories = await getRelevantMemories(userId, userInput, userInput ? 12 : 20)
    if (!memories.length) return ""

    const lines = memories.map(memory => {
        const confirmed = memory.lastConfirmedAt || memory.extractedAt
        const confirmedDate = confirmed && !Number.isNaN(new Date(confirmed).getTime())
            ? new Date(confirmed).toISOString().slice(0, 10)
            : "unknown"
        const importance = Math.max(1, Math.min(5, Number(memory.importance) || 1))
        const confidence = Math.max(0, Math.min(1, Number(memory.confidence) || 0.65)).toFixed(2)
        return `- [type=${memory.type || "fact"} importance=${importance} confidence=${confidence} lastConfirmed=${confirmedDate}] ${memory.content}`
    })

    return `\n\nWHAT YOU KNOW ABOUT THIS USER:\n${lines.join("\n")}`
}

module.exports = {
    getUserLongTermMemories,
    getRelevantMemories,
    addLongTermMemory,
    deleteLongTermMemory,
    deleteMatchingMemories,
    clearLongTermMemories,
    applyMemoryOperations,
    extractAndStoreMemories,
    buildMemoryContext,
    stringSimilarity,
}
