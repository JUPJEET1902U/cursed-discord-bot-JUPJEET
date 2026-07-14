/**
 * commands/admin.js
 * Developer/admin commands for bot statistics and debugging (Phase 12)
 */

const { loadEconomy } = require("../utils/economy")
const { loadPets } = require("../utils/pets")
const { getStatus: getAIStatus } = require("../utils/ai")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const logger = require("../utils/logger")
const log = logger.child("Admin")

const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean)
const START_TIME = Date.now()

function isAdmin(message) {
    if (BOT_OWNER_IDS.includes(message.author.id)) return true
    return message.member?.permissions?.has("Administrator") || false
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const userId = message.author.id

    if (!msgLower.startsWith("!botstats") &&
        !msgLower.startsWith("!aistats") &&
        !msgLower.startsWith("!memorydebug") &&
        !msgLower.startsWith("!economystats")) {
        return false
    }

    if (!isAdmin(message)) {
        await createSafeMessage(message.channel, `🔒 These commands are admin-only.`)
        return true
    }

    // ── !botstats ──────────────────────────────────────────────────────────────
    if (msgLower === "!botstats") {
        const uptime = formatUptime(Date.now() - START_TIME)
        const mem = process.memoryUsage()
        const guildCount = message.client?.guilds?.cache?.size || "N/A"
        const userCount = message.client?.users?.cache?.size || "N/A"
        const ecoData = loadEconomy()
        const totalUsers = Object.keys(ecoData).length

        await createSafeMessage(message.channel,
            `📊 **CURSED Bot Statistics**\n\n` +
            `⏱️ Uptime: **${uptime}**\n` +
            `🖥️ Memory: **${formatBytes(mem.heapUsed)}** / ${formatBytes(mem.heapTotal)}\n` +
            `🌐 Servers: **${guildCount}**\n` +
            `👥 Cached Users: **${userCount}**\n` +
            `💾 Economy Users: **${totalUsers}**\n` +
            `🟢 Node.js: **${process.version}**\n` +
            `📦 Platform: **${process.platform}**`)
        return true
    }

    // ── !aistats ───────────────────────────────────────────────────────────────
    if (msgLower === "!aistats") {
        const ai = getAIStatus()
        await createSafeMessage(message.channel,
            `🤖 **AI Provider Status**\n\n` +
            `🟢 Groq: **${ai.groqConfigured ? "Configured" : "Not configured"}**\n` +
            `🔵 Gemini: **${ai.geminiConfigured ? "Configured" : "Not configured"}**\n` +
            `📡 Last Used: **${ai.lastUsed}**\n` +
            `⚠️ Groq Fail Count: **${ai.groqFailCount}**`)
        return true
    }

    // ── !memorydebug ───────────────────────────────────────────────────────────
    if (msgLower === "!memorydebug") {
        const fs = require("fs")
        let memoryFileSize = "N/A"
        try {
            const stat = fs.statSync("./memory.json")
            memoryFileSize = formatBytes(stat.size)
        } catch {}

        let longTermCount = 0
        try {
            const mongoose = require("mongoose")
            if (mongoose.connection.readyState === 1) {
                const { default: LTM } = await Promise.resolve().then(() => require("../utils/longTermMemory"))
                // Just report connection status
                longTermCount = "MongoDB connected"
            } else {
                longTermCount = "MongoDB not connected (using in-memory)"
            }
        } catch {
            longTermCount = "N/A"
        }

        await createSafeMessage(message.channel,
            `🧠 **Memory System Debug**\n\n` +
            `📁 Short-term memory file: **${memoryFileSize}**\n` +
            `🗄️ Long-term memory: **${longTermCount}**\n` +
            `💾 Process heap: **${formatBytes(process.memoryUsage().heapUsed)}**`)
        return true
    }

    // ── !economystats ──────────────────────────────────────────────────────────
    if (msgLower === "!economystats") {
        const data = loadEconomy()
        const users = Object.values(data)
        const totalCoins = users.reduce((s, u) => s + (u.coins || 0), 0)
        const totalXP = users.reduce((s, u) => s + (u.xp || 0), 0)
        const avgLevel = users.length > 0 ? (users.reduce((s, u) => s + (u.level || 0), 0) / users.length).toFixed(1) : 0
        const petData = loadPets()
        const totalPets = Object.keys(petData).length

        await createSafeMessage(message.channel,
            `💰 **Economy Statistics**\n\n` +
            `👥 Total Users: **${users.length}**\n` +
            `🪙 Total Coins in Circulation: **${totalCoins.toLocaleString()}**\n` +
            `⭐ Total XP Earned: **${totalXP.toLocaleString()}**\n` +
            `📊 Average Level: **${avgLevel}**\n` +
            `🐾 Total Pets: **${totalPets}**`)
        return true
    }

    return false
}

module.exports = { handle }
