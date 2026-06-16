/**
 * commands/memory.js
 * Long-term memory commands for CURSED bot (Phase 1)
 * !memories, !remember, !forgetmemory, !clearmemory
 */

const {
    getUserLongTermMemories,
    addLongTermMemory,
    deleteLongTermMemory,
    clearLongTermMemories,
} = require("../utils/longTermMemory")
const { clearUserMemory } = require("../utils/memory")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeName } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const log = logger.child("MemoryCmd")

const TYPE_LABELS = {
    like: "❤️ Likes", dislike: "💔 Dislikes", game: "🎮 Games",
    anime: "🌸 Anime", music: "🎵 Music", friend: "👥 Friends",
    note: "📝 Notes", fact: "💡 Facts"
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── !memories ──────────────────────────────────────────────────────────────
    if (msgLower === "!memories" || msgLower === "!memory") {
        const memories = await getUserLongTermMemories(userId)
        if (!memories.length) {
            await createSafeMessage(message.channel,
                `🧠 **${senderName}**, I don't have any long-term memories about you yet!\n` +
                `Just chat with me and I'll start remembering things. 😊\n` +
                `You can also use \`!remember [fact]\` to tell me something directly.`)
            return true
        }

        const grouped = {}
        for (const m of memories) {
            if (!grouped[m.type]) grouped[m.type] = []
            grouped[m.type].push(m)
        }

        let output = `🧠 **What I Know About ${senderName}** (${memories.length} memories)\n\n`
        for (const [type, items] of Object.entries(grouped)) {
            const label = TYPE_LABELS[type] || type
            output += `**${label}:**\n`
            items.slice(0, 5).forEach((m, i) => {
                const id = m._id ? m._id.toString().slice(-4) : i
                output += `  \`[${id}]\` ${m.content}\n`
            })
            output += "\n"
        }
        output += `*Use \`!forgetmemory [id]\` to remove a specific memory.*`

        // Truncate if too long
        if (output.length > 1900) output = output.slice(0, 1890) + "\n*...and more*"
        await createSafeMessage(message.channel, output)
        return true
    }

    // ── !remember ──────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!remember")) {
        const content = message.content.slice(9).trim()
        if (!content || content.length < 3) {
            await createSafeMessage(message.channel,
                `📝 Usage: \`!remember [fact about yourself]\`\nExample: \`!remember I love playing Minecraft\``)
            return true
        }
        if (content.length > 200) {
            await createSafeMessage(message.channel, `📝 Keep it under 200 characters please!`)
            return true
        }

        // Detect type from content
        let type = "fact"
        const lower = content.toLowerCase()
        if (lower.includes("like") || lower.includes("love") || lower.includes("enjoy")) type = "like"
        else if (lower.includes("hate") || lower.includes("dislike") || lower.includes("don't like")) type = "dislike"
        else if (lower.includes("game") || lower.includes("play") || lower.includes("minecraft") || lower.includes("fortnite")) type = "game"
        else if (lower.includes("anime") || lower.includes("manga")) type = "anime"
        else if (lower.includes("music") || lower.includes("song") || lower.includes("band") || lower.includes("artist")) type = "music"
        else if (lower.includes("friend") || lower.includes("my friend")) type = "friend"

        await addLongTermMemory(userId, { type, content, importance: 3, tags: [] })
        await createSafeMessage(message.channel,
            `✅ Got it, **${senderName}**! I'll remember: *"${content}"*\nUse \`!memories\` to see everything I know about you.`)
        return true
    }

    // ── !forgetmemory ──────────────────────────────────────────────────────────
    if (msgLower.startsWith("!forgetmemory")) {
        const memoryId = message.content.split(" ")[1]?.trim()
        if (!memoryId) {
            await createSafeMessage(message.channel,
                `Usage: \`!forgetmemory [id]\`\nUse \`!memories\` to see memory IDs.`)
            return true
        }

        // Try to find the memory by partial ID match
        const memories = await getUserLongTermMemories(userId)
        const match = memories.find(m => m._id && m._id.toString().endsWith(memoryId))
        const idToDelete = match ? match._id.toString() : memoryId

        const deleted = await deleteLongTermMemory(userId, idToDelete)
        if (deleted) {
            await createSafeMessage(message.channel, `🗑️ Memory deleted! I've forgotten that. Use \`!memories\` to see what's left.`)
        } else {
            await createSafeMessage(message.channel, `❌ Couldn't find that memory. Use \`!memories\` to see valid IDs.`)
        }
        return true
    }

    // ── !clearmemory ───────────────────────────────────────────────────────────
    if (msgLower === "!clearmemory") {
        await clearLongTermMemories(userId)
        clearUserMemory(userId)
        await createSafeMessage(message.channel,
            `🧹 Done, **${senderName}**. I've wiped ALL memories about you — both short-term and long-term.\n` +
            `You're a complete stranger to me now. Fresh start! 😇`)
        return true
    }

    return false
}

module.exports = { handle }
