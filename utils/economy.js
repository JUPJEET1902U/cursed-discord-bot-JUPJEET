const fs = require("fs")

const ECONOMY_FILE = "./economy.json"
const CURRENCY = "🪙 Cursed Coins"
const MEDALS = ["🥇", "🥈", "🥉"]

const SHOP = {
    "vip":       { name: "⭐ VIP Title",     price: 500,  desc: "Shows a VIP badge on your profile",          key: "vip",        once: true  },
    "shield":    { name: "🛡️ Roast Shield",  price: 200,  desc: "CURSED goes easy on you for 5 messages",     key: "roastShield",once: false, value: 5  },
    "xpboost":   { name: "💥 XP Boost",      price: 400,  desc: "Double XP on your next 10 messages",         key: "xpBoost",    once: false, value: 10 },
    "dailyboost":{ name: "🎲 Daily Boost",   price: 300,  desc: "Doubles your next daily reward",             key: "dailyBoost", once: false, value: 1  },
    "badge":     { name: "💀 Cursed Badge",  price: 1000, desc: "Permanent 💀 badge on your profile forever", key: "badge",      once: true  },
    "prestige":  { name: "🌟 Prestige",      price: 2000, desc: "Unlock prestige status — the ultimate flex", key: "prestige",   once: true  },
}

const QUEST_POOL = [
    { id: "chat5",     desc: "💬 Chat with CURSED 5 times",      key: "chat",        goal: 5, reward: { coins: 100, xp: 30 } },
    { id: "roast2",    desc: "🔥 Use !roast 2 times",            key: "roast",       goal: 2, reward: { coins: 150, xp: 40 } },
    { id: "trivia1",   desc: "🧠 Win 1 trivia question",         key: "triviaWin",   goal: 1, reward: { coins: 200, xp: 50 } },
    { id: "fortune1",  desc: "🔮 Ask for your fortune once",     key: "fortune",     goal: 1, reward: { coins: 75,  xp: 20 } },
    { id: "daily1",    desc: "🎁 Claim your daily reward",       key: "dailyClaimed",goal: 1, reward: { coins: 50,  xp: 25 } },
    { id: "give1",     desc: "💸 Give coins to someone",         key: "give",        goal: 1, reward: { coins: 120, xp: 35 } },
    { id: "gamble1",   desc: "🎲 Gamble at least once",          key: "gamble",      goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "story1",    desc: "📖 Request a story with !story",   key: "story",       goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "roleplay1", desc: "🎭 Start a !roleplay",             key: "roleplay",    goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "feedpet1",  desc: "🐾 Feed your pet with !feedpet",   key: "feedpet",     goal: 1, reward: { coins: 80,  xp: 25 } },
    { id: "imagine1",  desc: "🎨 Generate an image with !imagine", key: "imagine",   goal: 1, reward: { coins: 80,  xp: 20 } },
    { id: "slots1",    desc: "🎰 Play slots once with !slots",   key: "slots",       goal: 1, reward: { coins: 90,  xp: 25 } },
]

function loadEconomy() {
    try {
        if (fs.existsSync(ECONOMY_FILE)) return JSON.parse(fs.readFileSync(ECONOMY_FILE, "utf8"))
    } catch (err) { console.error("Economy load error:", err.message) }
    return {}
}

function saveEconomy(data) {
    try { fs.writeFileSync(ECONOMY_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { console.error("Economy save error:", err.message) }
}

function getUser(userId, name) {
    const data = loadEconomy()
    if (!data[userId]) {
        data[userId] = { name, coins: 0, xp: 0, level: 0, lastDaily: null, stats: {} }
    } else {
        data[userId].name = name
        if (!data[userId].stats) data[userId].stats = {}
    }
    return { data, user: data[userId] }
}

function calcLevel(xp) { return Math.floor(0.1 * Math.sqrt(xp)) }
function xpToNextLevel(level) { return Math.pow((level + 1) / 0.1, 2) }

function addXP(userId, name, amount) {
    const { data, user } = getUser(userId, name)
    user.xp += amount
    const newLevel = calcLevel(user.xp)
    const legacyLeveledUp = newLevel > user.level
    user.level = newLevel
    saveEconomy(data)

    // The MongoDB server-leveling system now owns visible level-up announcements.
    // Keep legacy economy XP and level values intact for battles, quests, boosts,
    // and backward compatibility, but suppress the old same-channel notification.
    return { leveledUp: false, legacyLeveledUp, newLevel }
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
    ECONOMY_FILE, CURRENCY, MEDALS, SHOP, QUEST_POOL,
    loadEconomy, saveEconomy, getUser, calcLevel, xpToNextLevel,
    addXP, addCoins, incrementStat,
    getOrCreateDailyQuests, updateQuestProgress
}
