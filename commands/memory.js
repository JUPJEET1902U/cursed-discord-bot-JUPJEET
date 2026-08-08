const {
    getUserLongTermMemories,
    addLongTermMemory,
    deleteLongTermMemory,
    clearLongTermMemories,
} = require("../utils/longTermMemory")
const { clearUserMemory } = require("../utils/memory")
const { sanitizeName } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const {
    memory: memoryEmbed,
    statusLine,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const log = logger.child("MemoryCmd")

const TYPE_LABELS = Object.freeze({
    like: "Likes",
    dislike: "Dislikes",
    game: "Games",
    anime: "Anime",
    music: "Music",
    friend: "Friends",
    friendship: "Friends",
    personality: "Personality",
    note: "Notes",
    fact: "Facts",
})

function memoryId(memory, fallback) {
    return memory?._id ? memory._id.toString().slice(-4) : String(fallback)
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower === "!memories" || msgLower === "!memory") {
        const memories = await getUserLongTermMemories(userId)
        if (!memories.length) {
            await sendEmbed(message, memoryEmbed("Memory", "No long-term memories are stored for you yet.", {
                fields: [{ name: "Add one", value: "Use `!remember [fact]` or continue chatting with CURSED.", inline: false }],
            }))
            return true
        }

        const grouped = new Map()
        for (const item of memories) {
            const key = TYPE_LABELS[item.type] || String(item.type || "Other")
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key).push(item)
        }

        const fields = []
        for (const [label, items] of grouped.entries()) {
            fields.push({
                name: label,
                value: items.slice(0, 5).map((item, index) => `\`[${memoryId(item, index)}]\` ${item.content}`).join("\n").slice(0, 1024),
                inline: false,
            })
            if (fields.length >= 20) break
        }

        await sendEmbed(message, memoryEmbed(`${senderName}'s memory`, `${memories.length} stored memor${memories.length === 1 ? "y" : "ies"}.`, {
            fields,
        }))
        return true
    }

    if (msgLower.startsWith("!remember")) {
        const content = message.content.slice(9).trim()
        if (!content || content.length < 3) {
            await sendSafe(message, invalidUsage("!remember [fact about yourself]"))
            return true
        }
        if (content.length > 200) {
            await sendSafe(message, statusLine("warning", "Memories must be 200 characters or fewer."))
            return true
        }

        let type = "fact"
        const lower = content.toLowerCase()
        if (lower.includes("like") || lower.includes("love") || lower.includes("enjoy")) type = "like"
        else if (lower.includes("hate") || lower.includes("dislike") || lower.includes("don't like")) type = "dislike"
        else if (lower.includes("game") || lower.includes("play") || lower.includes("minecraft") || lower.includes("fortnite")) type = "game"
        else if (lower.includes("anime") || lower.includes("manga")) type = "anime"
        else if (lower.includes("music") || lower.includes("song") || lower.includes("band") || lower.includes("artist")) type = "music"
        else if (lower.includes("friend")) type = "friend"

        await addLongTermMemory(userId, { type, content, importance: 3, tags: [] })
        await sendSafe(message, statusLine("success", "Memory saved. Use `!memories` to review what CURSED remembers."))
        return true
    }

    if (msgLower.startsWith("!forgetmemory")) {
        const memoryIdInput = message.content.split(" ")[1]?.trim()
        if (!memoryIdInput) {
            await sendSafe(message, invalidUsage("!forgetmemory [id]"))
            return true
        }

        const memories = await getUserLongTermMemories(userId)
        const match = memories.find(item => item._id && item._id.toString().endsWith(memoryIdInput))
        const idToDelete = match ? match._id.toString() : memoryIdInput
        const deleted = await deleteLongTermMemory(userId, idToDelete)
        await sendSafe(message, deleted
            ? statusLine("success", "Memory deleted.")
            : statusLine("error", "Memory not found. Use `!memories` to view valid IDs."))
        return true
    }

    if (msgLower === "!clearmemory") {
        try {
            await clearLongTermMemories(userId)
            clearUserMemory(message.guild.id, userId)
            await sendSafe(message, statusLine("success", "Short-term and long-term memories cleared."))
        } catch (error) {
            log.error(`Memory clear failed: ${error.message}`)
            await sendSafe(message, statusLine("error", "Memory could not be fully cleared. Try again in a moment."))
        }
        return true
    }

    return false
}

module.exports = { handle }
