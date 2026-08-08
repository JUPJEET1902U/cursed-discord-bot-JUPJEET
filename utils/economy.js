const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const EconomyUser = require("../database/economyModel")

const ECONOMY_FILE = "./economy.json"
const LEGACY_ECONOMY_PATH = path.resolve(__dirname, "..", "economy.json")
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

function readLegacyEconomy() {
    try {
        if (fs.existsSync(LEGACY_ECONOMY_PATH)) {
            return JSON.parse(fs.readFileSync(LEGACY_ECONOMY_PATH, "utf8"))
        }
    } catch (err) {
        console.error("Economy legacy import read error:", err.message)
    }
    return {}
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function serialize(value) {
    return JSON.stringify(value)
}

const economyCache = readLegacyEconomy()
const knownSnapshots = new Map(
    Object.entries(economyCache).map(([userId, user]) => [userId, serialize(user)])
)
const pendingWrites = new Map()
let initializationPromise = null
let initialized = false
let flushPromise = null
let retryTimer = null

// Cache & Snapshot Lifecycle Constants
const MAX_SNAPSHOT_CACHE_SIZE = 1000
const SNAPSHOT_TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_ECONOMY_CACHE_SIZE = 1000
const ECONOMY_CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const HIGH_QUEUE_PRESSURE_THRESHOLD = 100
const CENTRALIZED_CLEANUP_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

const cacheLastAccess = new Map()
const snapshotLastAccess = new Map()
let backoffDelayMs = 5000
const MAX_BACKOFF_DELAY_MS = 60000

for (const userId of Object.keys(economyCache)) {
    cacheLastAccess.set(userId, Date.now())
    snapshotLastAccess.set(userId, Date.now())
}

function updateSnapshot(userId, user) {
    knownSnapshots.set(userId, serialize(user))
    snapshotLastAccess.set(userId, Date.now())
}

function getSnapshot(userId) {
    if (knownSnapshots.has(userId)) {
        snapshotLastAccess.set(userId, Date.now())
        return knownSnapshots.get(userId)
    }
    return undefined
}

function deleteSnapshot(userId) {
    knownSnapshots.delete(userId)
    snapshotLastAccess.delete(userId)
}

function runCentralizedCacheCleanup() {
    const now = Date.now()

    // 1. Snapshot eviction (safe derived data)
    for (const [userId, lastAccess] of snapshotLastAccess.entries()) {
        if (now - lastAccess > SNAPSHOT_TTL_MS) {
            deleteSnapshot(userId)
        }
    }
    if (knownSnapshots.size > MAX_SNAPSHOT_CACHE_SIZE) {
        const sorted = Array.from(snapshotLastAccess.entries()).sort((a, b) => a[1] - b[1])
        const toEvict = sorted.slice(0, knownSnapshots.size - MAX_SNAPSHOT_CACHE_SIZE)
        for (const [userId] of toEvict) {
            deleteSnapshot(userId)
        }
    }

    // 2. Economy cache eviction (ONLY if persisted and Mongo initialized)
    if (initialized || isMongoConnected()) {
        for (const [userId, lastAccess] of cacheLastAccess.entries()) {
            if (!pendingWrites.has(userId) && now - lastAccess > ECONOMY_CACHE_TTL_MS) {
                delete economyCache[userId]
                cacheLastAccess.delete(userId)
            }
        }
        if (Object.keys(economyCache).length > MAX_ECONOMY_CACHE_SIZE) {
            const sorted = Array.from(cacheLastAccess.entries())
                .filter(([userId]) => !pendingWrites.has(userId))
                .sort((a, b) => a[1] - b[1])
            const excess = Object.keys(economyCache).length - MAX_ECONOMY_CACHE_SIZE
            for (let i = 0; i < Math.min(excess, sorted.length); i++) {
                const userId = sorted[i][0]
                delete economyCache[userId]
                cacheLastAccess.delete(userId)
            }
        }
    }
}

const cleanupInterval = setInterval(runCentralizedCacheCleanup, CENTRALIZED_CLEANUP_INTERVAL_MS)
cleanupInterval.unref?.()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

async function ensureMongoConnected() {
    if (mongoose.connection.readyState === 1) return true
    if (!process.env.MONGO_URI) return false

    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGO_URI)
        } else {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup()
                    reject(new Error("MongoDB connection timed out"))
                }, 30000)

                const onConnected = () => {
                    cleanup()
                    resolve()
                }
                const onError = (err) => {
                    cleanup()
                    reject(err)
                }
                const cleanup = () => {
                    clearTimeout(timeout)
                    mongoose.connection.off("connected", onConnected)
                    mongoose.connection.off("error", onError)
                }

                mongoose.connection.once("connected", onConnected)
                mongoose.connection.once("error", onError)
            })
        }
        return mongoose.connection.readyState === 1
    } catch (err) {
        console.error("Economy MongoDB connection error:", err.message)
        return false
    }
}

function scheduleRetry() {
    if (!process.env.MONGO_URI || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializeEconomyStore()
            .then(ok => {
                if (ok) {
                    backoffDelayMs = 5000
                    return flushEconomy()
                }
            })
            .catch(err => console.error("Economy MongoDB retry error:", err.message))
    }, backoffDelayMs)
    retryTimer.unref?.()
    backoffDelayMs = Math.min(MAX_BACKOFF_DELAY_MS, backoffDelayMs * 2)
}

async function initializeEconomyStore() {
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        const connected = await ensureMongoConnected()
        if (!connected) {
            if (!process.env.MONGO_URI) {
                console.warn("⚠️  MONGO_URI not set — economy is running from memory without persistence")
            }
            scheduleRetry()
            return false
        }

        const legacyEntries = Object.entries(economyCache)
        let imported = 0

        if (legacyEntries.length > 0) {
            const result = await EconomyUser.bulkWrite(
                legacyEntries.map(([userId, data]) => ({
                    updateOne: {
                        filter: { userId },
                        update: { $setOnInsert: { userId, data: clone(data) } },
                        upsert: true,
                    },
                })),
                { ordered: false }
            )
            imported = result.upsertedCount || 0
        }

        const records = await EconomyUser.find({}).lean()
        for (const record of records) {
            const userId = record.userId
            const mongoData = clone(record.data || {})
            if (!pendingWrites.has(userId)) {
                economyCache[userId] = mongoData
                updateSnapshot(userId, mongoData)
                cacheLastAccess.set(userId, Date.now())
            }
        }

        initialized = true
        console.log(`✅ Economy MongoDB ready: ${records.length} user(s), ${imported} imported from legacy JSON`)
        return true
    })()

    try {
        return await initializationPromise
    } catch (err) {
        console.error("Economy MongoDB initialization error:", err.message)
        scheduleRetry()
        return false
    } finally {
        if (!initialized) initializationPromise = null
    }
}

function loadEconomy() {
    return economyCache
}

function collectChangedUsers(data) {
    const source = data || economyCache
    for (const [userId, user] of Object.entries(source)) {
        if (!user || typeof user !== "object") continue
        cacheLastAccess.set(userId, Date.now())

        const snapshot = serialize(user)
        if (snapshot !== getSnapshot(userId)) {
            pendingWrites.set(userId, clone(user))
            updateSnapshot(userId, snapshot)
        }
    }

    if (pendingWrites.size >= HIGH_QUEUE_PRESSURE_THRESHOLD) {
        console.warn(`[Economy] High pending writes queue pressure: ${pendingWrites.size} items queued`)
        flushEconomy().catch(err => console.error("Economy high pressure flush error:", err.message))
    }
}

function saveEconomy(data) {
    try {
        collectChangedUsers(data)
        return flushEconomy()
    } catch (err) {
        console.error("Economy save queue error:", err.message)
        return Promise.resolve(false)
    }
}

async function flushEconomy() {
    if (flushPromise) return flushPromise
    if (pendingWrites.size === 0) return true

    flushPromise = (async () => {
        const ready = await initializeEconomyStore()
        if (!ready) {
            scheduleRetry()
            return false
        }

        while (pendingWrites.size > 0) {
            const batch = Array.from(pendingWrites.entries())
            for (const [userId] of batch) pendingWrites.delete(userId)

            try {
                await EconomyUser.bulkWrite(
                    batch.map(([userId, data]) => ({
                        updateOne: {
                            filter: { userId },
                            update: { $set: { userId, data: clone(data) } },
                            upsert: true,
                        },
                    })),
                    { ordered: false }
                )
            } catch (err) {
                for (const [userId, data] of batch) {
                    if (!pendingWrites.has(userId)) pendingWrites.set(userId, data)
                }
                console.error("Economy MongoDB save error:", err.message)
                scheduleRetry()
                return false
            }
        }

        return true
    })()

    try {
        return await flushPromise
    } finally {
        flushPromise = null
        if (pendingWrites.size > 0 && initialized) {
            setImmediate(() => flushEconomy().catch(err =>
                console.error("Economy MongoDB follow-up save error:", err.message)
            ))
        }
    }
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

initializeEconomyStore()
    .then(ok => { if (ok && pendingWrites.size > 0) return flushEconomy() })
    .catch(err => console.error("Economy MongoDB startup error:", err.message))

module.exports = {
    ECONOMY_FILE, CURRENCY, MEDALS, SHOP, QUEST_POOL,
    loadEconomy, saveEconomy, getUser, calcLevel, xpToNextLevel,
    addXP, addCoins, incrementStat,
    getOrCreateDailyQuests, updateQuestProgress,
    initializeEconomyStore, flushEconomy,
}
