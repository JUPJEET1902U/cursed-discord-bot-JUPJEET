const { loadEconomy, MEDALS } = require("../utils/economy")
const { loadPets, calcPetLevel } = require("../utils/pets")
const { leaderboardCache } = require("../utils/cache")
const logger = require("../utils/logger")
const {
    games: gamesEmbed,
    invalidUsage,
    statusLine,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const log = logger.child("Leaderboards")
const CACHE_TTL = 60 * 1000
const VALID_CATEGORIES = new Set(["xp", "coins", "battles", "pets", "quests"])

function rankPrefix(index) {
    return MEDALS[index] || `#${index + 1}`
}

function buildLeaderboard(category) {
    const economy = loadEconomy()

    if (category === "xp") {
        const sorted = Object.values(economy).sort((a, b) => b.xp - a.xp).slice(0, 10)
        return {
            title: "XP leaderboard",
            empty: "No XP activity yet.",
            description: sorted.map((user, index) => `${rankPrefix(index)} **${user.name}** · Level ${user.level} · ${Number(user.xp || 0).toLocaleString()} XP`).join("\n"),
        }
    }

    if (category === "coins") {
        const sorted = Object.values(economy).sort((a, b) => b.coins - a.coins).slice(0, 10)
        return {
            title: "Coin leaderboard",
            empty: "No economy activity yet. Use `!daily` to get started.",
            description: sorted.map((user, index) => `${rankPrefix(index)} **${user.name}** · ${Number(user.coins || 0).toLocaleString()} coins`).join("\n"),
        }
    }

    if (category === "battles") {
        const sorted = Object.values(economy)
            .filter(user => (user.stats?.battles || 0) > 0)
            .sort((a, b) => (b.stats?.battlesWon || 0) - (a.stats?.battlesWon || 0))
            .slice(0, 10)
        return {
            title: "Battle leaderboard",
            empty: "No battle activity yet.",
            description: sorted.map((user, index) => {
                const wins = user.stats?.battlesWon || 0
                const total = user.stats?.battles || 0
                const losses = Math.max(0, total - wins)
                const rate = total > 0 ? Math.floor((wins / total) * 100) : 0
                return `${rankPrefix(index)} **${user.name}** · ${wins}W/${losses}L · ${rate}% win rate`
            }).join("\n"),
        }
    }

    if (category === "pets") {
        const sorted = Object.entries(loadPets())
            .map(([userId, pet]) => ({ ...pet, userId }))
            .sort((a, b) => calcPetLevel(b.xp) - calcPetLevel(a.xp))
            .slice(0, 10)
        return {
            title: "Pet leaderboard",
            empty: "No pets have been adopted yet.",
            description: sorted.map((pet, index) => {
                const owner = economy[pet.userId]?.name || "Unknown"
                return `${rankPrefix(index)} ${pet.emoji || ""} **${pet.name}** · ${pet.type} · Level ${calcPetLevel(pet.xp)} · ${owner}`.trim()
            }).join("\n"),
        }
    }

    const sorted = Object.values(economy)
        .filter(user => (user.stats?.questClaimed || 0) > 0)
        .sort((a, b) => (b.stats?.questClaimed || 0) - (a.stats?.questClaimed || 0))
        .slice(0, 10)
    return {
        title: "Quest leaderboard",
        empty: "No quest completions yet.",
        description: sorted.map((user, index) => `${rankPrefix(index)} **${user.name}** · ${user.stats.questClaimed} daily quest set${user.stats.questClaimed === 1 ? "" : "s"} claimed`).join("\n"),
    }
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    if (!msgLower.startsWith("!leaderboard") && msgLower !== "!lb") return false

    const category = message.content.split(" ")[1]?.toLowerCase() || "xp"
    if (!VALID_CATEGORIES.has(category)) {
        await sendEmbed(message, gamesEmbed("Leaderboards", "Choose a leaderboard category.", {
            fields: [
                { name: "Usage", value: "`!leaderboard [xp|coins|battles|pets|quests]`", inline: false },
                { name: "Categories", value: "XP · Coins · Battles · Pets · Quests", inline: false },
            ],
        }))
        return true
    }

    const cacheKey = `lb_v2_${category}`
    try {
        const cached = leaderboardCache.get(cacheKey)
        const result = cached || buildLeaderboard(category)
        if (!cached) leaderboardCache.set(cacheKey, result, CACHE_TTL)

        if (!result.description) {
            await sendSafe(message, result.empty || "No leaderboard data yet.")
            return true
        }
        await sendEmbed(message, gamesEmbed(result.title, result.description, {
            fields: [{ name: "Refresh", value: "Cached for up to 60 seconds.", inline: false }],
        }))
    } catch (error) {
        log.error(`Leaderboard error for ${category}: ${error.message}`)
        await sendSafe(message, statusLine("error", "Leaderboard data is unavailable right now."))
    }
    return true
}

module.exports = { handle, buildLeaderboard }
