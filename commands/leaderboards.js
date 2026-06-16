/**
 * commands/leaderboards.js
 * Multi-category leaderboards with caching (Phase 10)
 */

const { loadEconomy, MEDALS } = require("../utils/economy")
const { loadPets, calcPetLevel } = require("../utils/pets")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { leaderboardCache } = require("../utils/cache")
const logger = require("../utils/logger")
const log = logger.child("Leaderboards")

const CACHE_TTL = 60 * 1000 // 1 minute cache

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()

    if (!msgLower.startsWith("!leaderboard") && msgLower !== "!lb") return false

    const parts = message.content.split(" ")
    const category = parts[1]?.toLowerCase() || "xp"

    const validCategories = ["xp", "coins", "battles", "pets", "quests"]
    if (!validCategories.includes(category)) {
        await createSafeMessage(message.channel,
            `📊 **Leaderboard Categories:**\n` +
            `\`!leaderboard xp\` — Top users by XP\n` +
            `\`!leaderboard coins\` — Richest users\n` +
            `\`!leaderboard battles\` — Best fighters\n` +
            `\`!leaderboard pets\` — Highest level pets\n` +
            `\`!leaderboard quests\` — Quest masters`)
        return true
    }

    const cacheKey = `lb_${category}`
    const cached = leaderboardCache.get(cacheKey)
    if (cached) {
        await createSafeMessage(message.channel, cached)
        return true
    }

    try {
        let output = ""

        if (category === "xp") {
            const data = loadEconomy()
            const sorted = Object.values(data).sort((a, b) => b.xp - a.xp).slice(0, 10)
            if (!sorted.length) { await createSafeMessage(message.channel, "No XP data yet! Start chatting."); return true }
            const lines = sorted.map((u, i) => `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — ⭐ Level ${u.level} | 📊 ${u.xp} XP`)
            output = `⭐ **XP LEADERBOARD** ⭐\n\n${lines.join("\n")}`
        }

        else if (category === "coins") {
            const data = loadEconomy()
            const sorted = Object.values(data).sort((a, b) => b.coins - a.coins).slice(0, 10)
            if (!sorted.length) { await createSafeMessage(message.channel, "No coin data yet! Type `!daily` to start."); return true }
            const lines = sorted.map((u, i) => `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — 🪙 ${u.coins} coins`)
            output = `🪙 **RICHEST USERS** 🪙\n\n${lines.join("\n")}`
        }

        else if (category === "battles") {
            const data = loadEconomy()
            const sorted = Object.values(data)
                .filter(u => (u.stats?.battles || 0) > 0)
                .sort((a, b) => (b.stats?.battlesWon || 0) - (a.stats?.battlesWon || 0))
                .slice(0, 10)
            if (!sorted.length) { await createSafeMessage(message.channel, "No battle data yet! Use `!battle @user` to fight."); return true }
            const lines = sorted.map((u, i) => {
                const wins = u.stats?.battlesWon || 0
                const total = u.stats?.battles || 0
                const rate = total > 0 ? Math.floor((wins / total) * 100) : 0
                return `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — ⚔️ ${wins}W/${total - wins}L (${rate}%)`
            })
            output = `⚔️ **BATTLE LEADERBOARD** ⚔️\n\n${lines.join("\n")}`
        }

        else if (category === "pets") {
            const petData = loadPets()
            const sorted = Object.entries(petData)
                .map(([uid, pet]) => ({ ...pet, uid }))
                .sort((a, b) => calcPetLevel(b.xp) - calcPetLevel(a.xp))
                .slice(0, 10)
            if (!sorted.length) { await createSafeMessage(message.channel, "No pets yet! Use `!adopt` to get one."); return true }
            const ecoData = loadEconomy()
            const lines = sorted.map((pet, i) => {
                const owner = ecoData[pet.uid]?.name || "Unknown"
                const level = calcPetLevel(pet.xp)
                return `${MEDALS[i] || `**#${i + 1}**`} ${pet.emoji} **${pet.name}** (${pet.type}) — Lv.${level} | Owner: ${owner}`
            })
            output = `🐾 **PET LEADERBOARD** 🐾\n\n${lines.join("\n")}`
        }

        else if (category === "quests") {
            const data = loadEconomy()
            const sorted = Object.values(data)
                .filter(u => (u.stats?.questClaimed || 0) > 0)
                .sort((a, b) => (b.stats?.questClaimed || 0) - (a.stats?.questClaimed || 0))
                .slice(0, 10)
            if (!sorted.length) { await createSafeMessage(message.channel, "No quest completions yet! Use `!quests` to start."); return true }
            const lines = sorted.map((u, i) => `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — ✅ ${u.stats.questClaimed} quests completed`)
            output = `📋 **QUEST MASTERS** 📋\n\n${lines.join("\n")}`
        }

        leaderboardCache.set(cacheKey, output, CACHE_TTL)
        await createSafeMessage(message.channel, output)
    } catch (err) {
        log.error(`Leaderboard error for ${category}: ${err.message}`)
        await createSafeMessage(message.channel, "❌ Failed to load leaderboard. Try again!")
    }

    return true
}

module.exports = { handle }
