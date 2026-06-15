const fs = require("fs")
const logger = require("./logger")
const { FILES, SHOP, ACHIEVEMENTS, QUEST_POOL, MEDALS } = require("../config/constants")

const ECONOMY_FILE = FILES.ECONOMY
const CURRENCY = "🪙 Cursed Coins"

function loadEconomy() {
    try {
        if (fs.existsSync(ECONOMY_FILE)) return JSON.parse(fs.readFileSync(ECONOMY_FILE, "utf8"))
    } catch (err) { logger.error("Economy", `Load error: ${err.message}`) }
    return {}
}

function saveEconomy(data) {
    try { fs.writeFileSync(ECONOMY_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { logger.error("Economy", `Save error: ${err.message}`) }
}

function getUser(userId, name) {
    const data = loadEconomy()
    if (!data[userId]) {
        data[userId] = { name, coins: 0, xp: 0, level: 0, lastDaily: null, stats: {}, achievements: [] }
    } else {
        data[userId].name = name
        if (!data[userId].stats) data[userId].stats = {}
        if (!data[userId].achievements) data[userId].achievements = []
    }
    return { data, user: data[userId] }
}

function calcLevel(xp) { return Math.floor(0.1 * Math.sqrt(xp)) }
function xpToNextLevel(level) { return Math.pow((level + 1) / 0.1, 2) }

function addXP(userId, name, amount) {
    const { data, user } = getUser(userId, name)
    user.xp += amount
    const newLevel = calcLevel(user.xp)
    const leveledUp = newLevel > user.level
    user.level = newLevel
    saveEconomy(data)
    return { leveledUp, newLevel }
}

function addCoins(userId, name, amount) {
    const { data, user } = getUser(userId, name)
    user.coins = Math.max(0, user.coins + amount)
    saveEconomy(data)
    return user.coins
}

function incrementStat(userId, name, stat, amount = 1) {
    const { data, user } = getUser(userId, name)
    user.stats[stat] = (user.stats[stat] || 0) + amount
    saveEconomy(data)
    return user.stats[stat]
}

function checkAndGrantAchievements(userId, name) {
    const { data, user } = getUser(userId, name)
    const earned = []
    const has = (id) => (user.achievements || []).includes(id)
    const s = user.stats || {}

    const checks = [
        ["first_msg",      () => (s.chat || 0) >= 1],
        ["chat100",        () => (s.chat || 0) >= 100],
        ["level5",         () => user.level >= 5],
        ["level10",        () => user.level >= 10],
        ["level25",        () => user.level >= 25],
        ["roast10",        () => (s.roast || 0) >= 10],
        ["rich500",        () => user.coins >= 500],
        ["rich2000",       () => user.coins >= 2000],
        ["gambler_first",  () => (s.gamble || 0) >= 1],
        ["gambler_win",    () => (s.gambleWin || 0) >= 1],
        ["trivia5",        () => (s.triviaWin || 0) >= 5],
        ["pet_owner",      () => (s.petAdopt || 0) >= 1],
        ["quest_complete", () => (s.questClaimed || 0) >= 1],
        ["daily7",         () => (s.dailyClaimed || 0) >= 7],
        ["prestige_owner", () => !!user.prestige],
        ["slots_jackpot",  () => (s.slotsJackpot || 0) >= 1],
    ]

    for (const [id, cond] of checks) {
        if (!has(id) && cond()) earned.push(id)
    }

    if (earned.length > 0) {
        if (!user.achievements) user.achievements = []
        for (const id of earned) {
            user.achievements.push(id)
            const ach = ACHIEVEMENTS.find(a => a.id === id)
            if (ach) {
                user.coins += ach.coins
                user.xp += ach.xp
                user.level = calcLevel(user.xp)
            }
        }
        saveEconomy(data)
    }

    return earned.map(id => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean)
}

function getOrCreateDailyQuests(user) {
    const today = new Date().toDateString()
    if (!user.questProgress || user.questProgress.date !== today) {
        const pool = [...QUEST_POOL]
        const picked = []
        while (picked.length < 3 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length)
            picked.push({ ...pool[idx], progress: 0 })
            pool.splice(idx, 1)
        }
        user.questProgress = { date: today, quests: picked, claimed: false }
    }
    return user.questProgress
}

function updateQuestProgress(userId, name, statKey, amount = 1) {
    const { data, user } = getUser(userId, name)
    getOrCreateDailyQuests(user)
    let updated = false
    for (const q of user.questProgress.quests) {
        if (q.key === statKey && q.progress < q.goal) {
            q.progress = Math.min(q.goal, q.progress + amount)
            updated = true
        }
    }
    if (updated) saveEconomy(data)
}

module.exports = {
    ECONOMY_FILE, CURRENCY, MEDALS, SHOP, ACHIEVEMENTS, QUEST_POOL,
    loadEconomy, saveEconomy, getUser, calcLevel, xpToNextLevel,
    addXP, addCoins, incrementStat, checkAndGrantAchievements,
    getOrCreateDailyQuests, updateQuestProgress
}
