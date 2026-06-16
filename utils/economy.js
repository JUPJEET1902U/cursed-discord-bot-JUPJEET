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

const ACHIEVEMENTS = [
    // ── Chat Achievements (10) ─────────────────────────────────────────────────
    { id: "first_msg",      name: "👋 First Words",       desc: "Send your first message to CURSED",         xp: 20,  coins: 50   },
    { id: "chat10",         name: "💬 Getting Started",   desc: "Send 10 messages to CURSED",                xp: 30,  coins: 60   },
    { id: "chat100",        name: "💬 Chatterbox",        desc: "Send 100 messages to CURSED",               xp: 100, coins: 200  },
    { id: "chat500",        name: "🗣️ Motor Mouth",       desc: "Send 500 messages to CURSED",               xp: 200, coins: 400  },
    { id: "chat1000",       name: "📢 Legendary Talker",  desc: "Send 1000 messages to CURSED",              xp: 500, coins: 1000 },
    { id: "roast1",         name: "🔥 First Roast",       desc: "Roast someone for the first time",          xp: 20,  coins: 40   },
    { id: "roast10",        name: "🔥 Roast Master",      desc: "Roast 10 people",                           xp: 75,  coins: 150  },
    { id: "roast50",        name: "🔥 Roast Legend",      desc: "Roast 50 people",                           xp: 200, coins: 400  },
    { id: "story5",         name: "📖 Storyteller",       desc: "Request 5 stories",                         xp: 50,  coins: 100  },
    { id: "fortune5",       name: "🔮 Oracle Seeker",     desc: "Ask for your fortune 5 times",              xp: 40,  coins: 80   },

    // ── Economy Achievements (10) ──────────────────────────────────────────────
    { id: "rich500",        name: "💰 Getting Rich",      desc: "Have 500 coins at once",                    xp: 50,  coins: 0    },
    { id: "rich2000",       name: "🤑 Big Spender",       desc: "Have 2000 coins at once",                   xp: 100, coins: 0    },
    { id: "rich10000",      name: "💎 Coin Hoarder",      desc: "Have 10,000 coins at once",                 xp: 300, coins: 0    },
    { id: "daily7",         name: "📅 Loyal Follower",    desc: "Claim daily reward 7 times total",          xp: 100, coins: 200  },
    { id: "daily30",        name: "📅 Dedicated",         desc: "Claim daily reward 30 times total",         xp: 300, coins: 500  },
    { id: "work10",         name: "💼 Hard Worker",       desc: "Work 10 times",                             xp: 80,  coins: 150  },
    { id: "work50",         name: "💼 Workaholic",        desc: "Work 50 times",                             xp: 200, coins: 400  },
    { id: "prestige_owner", name: "👑 Prestige",          desc: "Unlock Prestige status from the shop",      xp: 500, coins: 0    },
    { id: "investor",       name: "📈 Investor",          desc: "Collect your first investment",             xp: 100, coins: 200  },
    { id: "business_owner", name: "🏢 Entrepreneur",      desc: "Start your first business",                 xp: 150, coins: 300  },

    // ── Battle Achievements (10) ───────────────────────────────────────────────
    { id: "first_battle",   name: "⚔️ First Blood",       desc: "Win your first battle",                     xp: 50,  coins: 100  },
    { id: "battles10",      name: "⚔️ Warrior",           desc: "Win 10 battles",                            xp: 150, coins: 300  },
    { id: "battles50",      name: "⚔️ Champion",          desc: "Win 50 battles",                            xp: 400, coins: 800  },
    { id: "boss_slayer",    name: "👹 Boss Slayer",        desc: "Defeat your first boss",                    xp: 200, coins: 400  },
    { id: "boss5",          name: "👹 Boss Hunter",        desc: "Defeat 5 bosses",                           xp: 500, coins: 1000 },
    { id: "pvp_win",        name: "🏆 PvP Victor",        desc: "Win a PvP battle against another user",     xp: 100, coins: 200  },
    { id: "duel_win",       name: "⚔️ Duelist",           desc: "Win your first coin duel",                  xp: 80,  coins: 150  },
    { id: "duel10",         name: "⚔️ Duel Master",       desc: "Win 10 coin duels",                         xp: 200, coins: 400  },
    { id: "battleai5",      name: "🤖 AI Slayer",         desc: "Defeat the AI 5 times",                     xp: 150, coins: 300  },
    { id: "undefeated",     name: "🛡️ Undefeated",        desc: "Win 5 battles in a row",                    xp: 300, coins: 600  },

    // ── Quest Achievements (10) ────────────────────────────────────────────────
    { id: "quest_complete", name: "✅ Quest Slayer",      desc: "Complete your first daily quest set",       xp: 50,  coins: 100  },
    { id: "quests5",        name: "📋 Quest Addict",      desc: "Complete 5 daily quest sets",               xp: 150, coins: 300  },
    { id: "quests20",       name: "📋 Quest Master",      desc: "Complete 20 daily quest sets",              xp: 400, coins: 800  },
    { id: "quests50",       name: "📋 Quest Legend",      desc: "Complete 50 daily quest sets",              xp: 1000,coins: 2000 },
    { id: "trivia1",        name: "🧠 Trivia Starter",    desc: "Win your first trivia question",            xp: 30,  coins: 60   },
    { id: "trivia5",        name: "🧠 Trivia Ace",        desc: "Win 5 trivia questions",                    xp: 75,  coins: 150  },
    { id: "trivia20",       name: "🧠 Trivia Champion",   desc: "Win 20 trivia questions",                   xp: 200, coins: 400  },
    { id: "treasure1",      name: "🗺️ Treasure Hunter",   desc: "Find your first treasure",                  xp: 40,  coins: 80   },
    { id: "treasure10",     name: "🗺️ Treasure Master",   desc: "Find 10 treasures",                         xp: 150, coins: 300  },
    { id: "games10",        name: "🎮 Gamer",             desc: "Win 10 mini-games",                         xp: 150, coins: 300  },

    // ── Pet Achievements (5) ───────────────────────────────────────────────────
    { id: "pet_owner",      name: "🐾 Pet Parent",        desc: "Adopt your first pet",                      xp: 40,  coins: 80   },
    { id: "pet_fed10",      name: "🍖 Devoted Feeder",    desc: "Feed your pet 10 times",                    xp: 80,  coins: 150  },
    { id: "pet_play10",     name: "🎾 Playful Owner",     desc: "Play with your pet 10 times",               xp: 80,  coins: 150  },
    { id: "pet_level5",     name: "⭐ Pet Trainer",       desc: "Raise your pet to level 5",                 xp: 150, coins: 300  },
    { id: "pet_level10",    name: "🌟 Master Trainer",    desc: "Raise your pet to level 10",                xp: 300, coins: 600  },

    // ── Premium Achievements (5) ───────────────────────────────────────────────
    { id: "vip_owner",      name: "⭐ VIP Status",        desc: "Purchase VIP from the shop",                xp: 100, coins: 0    },
    { id: "badge_owner",    name: "💀 Cursed Badge",      desc: "Earn the Cursed Badge",                     xp: 200, coins: 0    },
    { id: "shield_user",    name: "🛡️ Shield Bearer",     desc: "Use a Roast Shield",                        xp: 30,  coins: 50   },
    { id: "xpboost_user",   name: "💥 Boosted",           desc: "Use an XP Boost",                           xp: 30,  coins: 50   },
    { id: "shop5",          name: "🛒 Shopaholic",        desc: "Buy 5 items from the shop",                 xp: 100, coins: 200  },

    // ── Social Achievements (5) ────────────────────────────────────────────────
    { id: "give1",          name: "💸 Generous",          desc: "Give coins to another user",                xp: 30,  coins: 50   },
    { id: "give10",         name: "💸 Philanthropist",    desc: "Give coins to others 10 times",             xp: 100, coins: 200  },
    { id: "gambler_first",  name: "🎲 First Roll",        desc: "Gamble for the first time",                 xp: 20,  coins: 30   },
    { id: "gambler_win",    name: "🎰 Lucky Duck",        desc: "Win a gamble",                              xp: 30,  coins: 75   },
    { id: "slots_jackpot",  name: "🎰 Jackpot!",          desc: "Hit the jackpot on slots",                  xp: 100, coins: 300  },

    // ── Level Achievements (5) ─────────────────────────────────────────────────
    { id: "level5",         name: "⭐ Rising Star",       desc: "Reach Level 5",                             xp: 50,  coins: 100  },
    { id: "level10",        name: "🌟 Power User",        desc: "Reach Level 10",                            xp: 100, coins: 200  },
    { id: "level25",        name: "💥 Elite",             desc: "Reach Level 25",                            xp: 200, coins: 500  },
    { id: "level50",        name: "🔥 Veteran",           desc: "Reach Level 50",                            xp: 500, coins: 1000 },
    { id: "level100",       name: "👑 Legend",            desc: "Reach Level 100",                           xp: 1000,coins: 2000 },
]

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
        // Chat
        ["first_msg",      () => (s.chat || 0) >= 1],
        ["chat10",         () => (s.chat || 0) >= 10],
        ["chat100",        () => (s.chat || 0) >= 100],
        ["chat500",        () => (s.chat || 0) >= 500],
        ["chat1000",       () => (s.chat || 0) >= 1000],
        ["roast1",         () => (s.roast || 0) >= 1],
        ["roast10",        () => (s.roast || 0) >= 10],
        ["roast50",        () => (s.roast || 0) >= 50],
        ["story5",         () => (s.story || 0) >= 5],
        ["fortune5",       () => (s.fortune || 0) >= 5],
        // Economy
        ["rich500",        () => user.coins >= 500],
        ["rich2000",       () => user.coins >= 2000],
        ["rich10000",      () => user.coins >= 10000],
        ["daily7",         () => (s.dailyClaimed || 0) >= 7],
        ["daily30",        () => (s.dailyClaimed || 0) >= 30],
        ["work10",         () => (s.workCount || 0) >= 10],
        ["work50",         () => (s.workCount || 0) >= 50],
        ["prestige_owner", () => !!user.prestige],
        ["investor",       () => (s.investmentsClaimed || 0) >= 1],
        ["business_owner", () => !!user.business],
        // Battle
        ["first_battle",   () => (s.battlesWon || 0) >= 1],
        ["battles10",      () => (s.battlesWon || 0) >= 10],
        ["battles50",      () => (s.battlesWon || 0) >= 50],
        ["boss_slayer",    () => (s.bossKills || 0) >= 1],
        ["boss5",          () => (s.bossKills || 0) >= 5],
        ["pvp_win",        () => (s.battlesWon || 0) >= 1],
        ["duel_win",       () => (s.duelsWon || 0) >= 1],
        ["duel10",         () => (s.duelsWon || 0) >= 10],
        ["battleai5",      () => (s.aiWins || 0) >= 5],
        ["undefeated",     () => (s.winStreak || 0) >= 5],
        // Quests
        ["quest_complete", () => (s.questClaimed || 0) >= 1],
        ["quests5",        () => (s.questClaimed || 0) >= 5],
        ["quests20",       () => (s.questClaimed || 0) >= 20],
        ["quests50",       () => (s.questClaimed || 0) >= 50],
        ["trivia1",        () => (s.triviaWin || 0) >= 1],
        ["trivia5",        () => (s.triviaWin || 0) >= 5],
        ["trivia20",       () => (s.triviaWin || 0) >= 20],
        ["treasure1",      () => (s.treasureFound || 0) >= 1],
        ["treasure10",     () => (s.treasureFound || 0) >= 10],
        ["games10",        () => (s.gamesWon || 0) >= 10],
        // Pets
        ["pet_owner",      () => (s.petAdopt || 0) >= 1],
        ["pet_fed10",      () => (s.feedpet || 0) >= 10],
        ["pet_play10",     () => (s.petplay || 0) >= 10],
        ["pet_level5",     () => (s.petMaxLevel || 0) >= 5],
        ["pet_level10",    () => (s.petMaxLevel || 0) >= 10],
        // Premium
        ["vip_owner",      () => !!user.vip],
        ["badge_owner",    () => !!user.badge],
        ["shield_user",    () => (s.shieldUsed || 0) >= 1],
        ["xpboost_user",   () => (s.xpBoostUsed || 0) >= 1],
        ["shop5",          () => (s.shopBuys || 0) >= 5],
        // Social
        ["give1",          () => (s.give || 0) >= 1],
        ["give10",         () => (s.give || 0) >= 10],
        ["gambler_first",  () => (s.gamble || 0) >= 1],
        ["gambler_win",    () => (s.gambleWin || 0) >= 1],
        ["slots_jackpot",  () => (s.slotsJackpot || 0) >= 1],
        // Levels
        ["level5",         () => user.level >= 5],
        ["level10",        () => user.level >= 10],
        ["level25",        () => user.level >= 25],
        ["level50",        () => user.level >= 50],
        ["level100",       () => user.level >= 100],
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
