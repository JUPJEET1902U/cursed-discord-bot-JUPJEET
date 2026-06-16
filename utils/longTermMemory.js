/**
 * utils/longTermMemory.js
 * Persistent long-term user memory system (Phase 1)
 * Stores structured facts about users extracted from conversations.
 * Uses MongoDB when available, falls back to in-memory storage.
 */

const mongoose = require("mongoose")
const { callAI } = require("./ai")
const logger = require("./logger")
const log = logger.child("LongTermMemory")

// ── Mongoose Schema ────────────────────────────────────────────────────────────
const memorySchema = new mongoose.Schema({
    userId:      { type: String, required: true, index: true },
    type:        { type: String, required: true, enum: ["like", "dislike", "game", "anime", "music", "friend", "note", "fact"] },
    content:     { type: String, required: true, maxlength: 500 },
    importance:  { type: Number, default: 1, min: 1, max: 5 },
    tags:        [{ type: String }],
    extractedAt: { type: Date, default: Date.now },
})

memorySchema.index({ userId: 1, type: 1 })

let MemoryModel
try {
    MemoryModel = mongoose.model("LongTermMemory")
} catch {
    MemoryModel = mongoose.model("LongTermMemory", memorySchema)
}

// In-memory fallback: Map<userId, MemoryEntry[]>
const memoryFallback = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

/**
 * Get all long-term memories for a user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getUserLongTermMemories(userId) {
    if (isMongoConnected()) {
        try {
            return await MemoryModel.find({ userId }).sort({ importance: -1, extractedAt: -1 }).limit(50).lean()
        } catch (err) {
            log.error(`Failed to get memories for ${userId}: ${err.message}`)
        }
    }
    return memoryFallback.get(userId) || []
}

/**
 * Add a long-term memory for a user.
 * @param {string} userId
 * @param {object} memory  { type, content, importance, tags }
 * @returns {Promise<void>}
 */
async function addLongTermMemory(userId, memory) {
    const entry = {
        userId,
        type: memory.type || "fact",
        content: String(memory.content || "").slice(0, 500),
        importance: Math.min(5, Math.max(1, parseInt(memory.importance) || 1)),
        tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 10) : [],
        extractedAt: new Date(),
    }

    if (isMongoConnected()) {
        try {
            await MemoryModel.create(entry)
            log.debug(`Added memory for ${userId}: [${entry.type}] ${entry.content.slice(0, 40)}`)
            return
        } catch (err) {
            log.error(`Failed to add memory for ${userId}: ${err.message}`)
        }
    }

    const list = memoryFallback.get(userId) || []
    list.push(entry)
    // Keep only the 100 most recent in fallback
    if (list.length > 100) list.splice(0, list.length - 100)
    memoryFallback.set(userId, list)
}

/**
 * Delete a specific memory by ID (MongoDB) or index (fallback).
 * @param {string} userId
 * @param {string} memoryId
 * @returns {Promise<boolean>}
 */
async function deleteLongTermMemory(userId, memoryId) {
    if (isMongoConnected()) {
        try {
            const result = await MemoryModel.deleteOne({ _id: memoryId, userId })
            return result.deletedCount > 0
        } catch (err) {
            log.error(`Failed to delete memory ${memoryId}: ${err.message}`)
            return false
        }
    }
    const list = memoryFallback.get(userId) || []
    const idx = parseInt(memoryId)
    if (!isNaN(idx) && idx >= 0 && idx < list.length) {
        list.splice(idx, 1)
        memoryFallback.set(userId, list)
        return true
    }
    return false
}

/**
 * Clear all long-term memories for a user.
 * @param {string} userId
 * @returns {Promise<void>}
 */
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

/**
 * Extract memories from a conversation exchange using AI.
 * Runs asynchronously and does not block the response.
 * @param {string} userId
 * @param {string} userMessage
 * @param {string} botReply
 * @returns {Promise<void>}
 */
async function extractAndStoreMemories(userId, userMessage, botReply) {
    try {
        const result = await callAI([
            {
                role: "system",
                content: `You are a memory extraction system. Analyze the conversation and extract any personal facts about the user.
Output ONLY a JSON array of memory objects. Each object must have:
- "type": one of: like, dislike, game, anime, music, friend, note, fact
- "content": a short factual statement (max 100 chars)
- "importance": 1-5 (5 = very important personal detail)
- "tags": array of 1-3 relevant keywords

If there is nothing worth remembering, output an empty array: []
Output ONLY valid JSON, no explanation.`
            },
            {
                role: "user",
                content: `User said: "${userMessage}"\nBot replied: "${botReply}"\n\nExtract memorable facts about the user:`
            }
        ], { maxTokens: 400 })

        const text = result.content.trim()
        // Extract JSON array from response
        const match = text.match(/\[[\s\S]*\]/)
        if (!match) return

        const memories = JSON.parse(match[0])
        if (!Array.isArray(memories)) return

        for (const mem of memories.slice(0, 5)) {
            if (mem.content && mem.type) {
                await addLongTermMemory(userId, mem)
            }
        }
    } catch (err) {
        // Memory extraction is best-effort — never block the main flow
        log.debug(`Memory extraction skipped for ${userId}: ${err.message}`)
    }
}

/**
 * Build a memory context string to prepend to AI conversations.
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function buildMemoryContext(userId) {
    const memories = await getUserLongTermMemories(userId)
    if (!memories.length) return ""

    const grouped = {}
    for (const m of memories) {
        if (!grouped[m.type]) grouped[m.type] = []
        grouped[m.type].push(m.content)
    }

    const lines = []
    const typeLabels = {
        like: "Likes", dislike: "Dislikes", game: "Favorite games",
        anime: "Favorite anime", music: "Favorite music",
        friend: "Friends/people they mention", note: "Notes", fact: "Known facts"
    }

    for (const [type, items] of Object.entries(grouped)) {
        const label = typeLabels[type] || type
        lines.push(`${label}: ${items.slice(0, 5).join(", ")}`)
    }

    return `\n\nWHAT YOU KNOW ABOUT THIS USER:\n${lines.join("\n")}`
}

module.exports = {
    getUserLongTermMemories,
    addLongTermMemory,
    deleteLongTermMemory,
    clearLongTermMemories,
    extractAndStoreMemories,
    buildMemoryContext,
}
