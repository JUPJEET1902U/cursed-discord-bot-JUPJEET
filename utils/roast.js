const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const RoastLeaderboardEntry = require("../database/roastLeaderboardModel")

const LEADERBOARD_FILE = "./roast_counts.json"
const LEGACY_LEADERBOARD_PATH = path.resolve(__dirname, "..", "roast_counts.json")

function normalizeCount(value) {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0
}

function readLegacyCounts() {
    try {
        if (fs.existsSync(LEGACY_LEADERBOARD_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(LEGACY_LEADERBOARD_PATH, "utf8"))
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
        }
    } catch (err) {
        console.error("Roast legacy import read error:", err.message)
    }
    return {}
}

const legacyCounts = readLegacyCounts()
const countCache = new Map()
const orderCache = new Map()
const pendingIncrements = new Map()
let nextOrder = 0
let initializationPromise = null
let initialized = false
let flushPromise = null
let retryTimer = null

function seedCache(source = {}) {
    countCache.clear()
    orderCache.clear()
    nextOrder = 0

    for (const [targetName, count] of Object.entries(source)) {
        countCache.set(targetName, normalizeCount(count))
        orderCache.set(targetName, nextOrder)
        nextOrder += 1
    }
}

seedCache(legacyCounts)

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
                const onError = err => {
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
        console.error("Roast leaderboard MongoDB connection error:", err.message)
        return false
    }
}

function scheduleRetry() {
    if (!process.env.MONGO_URI || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializeRoastLeaderboard()
            .then(ok => { if (ok) return flushRoastIncrements() })
            .catch(err => console.error("Roast leaderboard MongoDB retry error:", err.message))
    }, 30000)
    retryTimer.unref?.()
}

function queueIncrement(targetName, delta = 1, order = null) {
    const existing = pendingIncrements.get(targetName)
    if (existing) {
        existing.delta += delta
        if (existing.order == null && order != null) existing.order = order
        return
    }
    pendingIncrements.set(targetName, { delta, order })
}

async function initializeRoastLeaderboard() {
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        const connected = await ensureMongoConnected()
        if (!connected) {
            if (!process.env.MONGO_URI) {
                console.warn("⚠️  MONGO_URI not set — roast leaderboard is running from memory without persistence")
            }
            scheduleRetry()
            return false
        }

        const legacyEntries = Object.entries(legacyCounts)
        let imported = 0

        if (legacyEntries.length > 0) {
            const result = await RoastLeaderboardEntry.bulkWrite(
                legacyEntries.map(([targetName, count], order) => ({
                    updateOne: {
                        filter: { targetName },
                        update: {
                            $setOnInsert: {
                                targetName,
                                count: normalizeCount(count),
                                order,
                            },
                        },
                        upsert: true,
                    },
                })),
                { ordered: false }
            )
            imported = result.upsertedCount || 0
        }

        const records = await RoastLeaderboardEntry.find({})
            .sort({ order: 1, createdAt: 1, _id: 1 })
            .lean()

        countCache.clear()
        orderCache.clear()
        nextOrder = 0

        for (const record of records) {
            const targetName = String(record.targetName)
            const order = Number.isFinite(Number(record.order)) ? Number(record.order) : nextOrder
            countCache.set(targetName, normalizeCount(record.count))
            orderCache.set(targetName, order)
            nextOrder = Math.max(nextOrder, order + 1)
        }

        // Roasts can complete while MongoDB is still connecting. Reapply those
        // increments after hydration so an older database snapshot cannot erase them.
        for (const [targetName, pending] of pendingIncrements.entries()) {
            let order = orderCache.get(targetName)
            if (order == null) {
                order = nextOrder
                nextOrder += 1
                pending.order = order
                orderCache.set(targetName, order)
            }
            countCache.set(targetName, (countCache.get(targetName) || 0) + pending.delta)
        }

        initialized = true
        console.log(`✅ Roast leaderboard MongoDB ready: ${records.length} target(s), ${imported} imported from legacy JSON`)
        return true
    })()

    try {
        return await initializationPromise
    } catch (err) {
        console.error("Roast leaderboard MongoDB initialization error:", err.message)
        scheduleRetry()
        return false
    } finally {
        if (!initialized) initializationPromise = null
    }
}

async function flushRoastIncrements() {
    if (flushPromise) return flushPromise
    if (pendingIncrements.size === 0) return true

    flushPromise = (async () => {
        const ready = await initializeRoastLeaderboard()
        if (!ready) {
            scheduleRetry()
            return false
        }

        while (pendingIncrements.size > 0) {
            const batch = Array.from(pendingIncrements.entries())
            for (const [targetName] of batch) pendingIncrements.delete(targetName)

            try {
                await RoastLeaderboardEntry.bulkWrite(
                    batch.map(([targetName, pending]) => ({
                        updateOne: {
                            filter: { targetName },
                            update: {
                                $inc: { count: pending.delta },
                                $setOnInsert: {
                                    targetName,
                                    order: pending.order == null ? orderCache.get(targetName) : pending.order,
                                },
                            },
                            upsert: true,
                        },
                    })),
                    { ordered: false }
                )
            } catch (err) {
                for (const [targetName, pending] of batch) {
                    queueIncrement(targetName, pending.delta, pending.order)
                }
                console.error("Roast leaderboard MongoDB save error:", err.message)
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
        if (pendingIncrements.size > 0 && initialized) {
            setImmediate(() => flushRoastIncrements().catch(err =>
                console.error("Roast leaderboard MongoDB follow-up save error:", err.message)
            ))
        }
    }
}

function addRoast(name) {
    const targetName = String(name)
    if (!orderCache.has(targetName)) {
        orderCache.set(targetName, nextOrder)
        nextOrder += 1
    }

    countCache.set(targetName, (countCache.get(targetName) || 0) + 1)
    queueIncrement(targetName, 1, orderCache.get(targetName))
    flushRoastIncrements().catch(err =>
        console.error("Roast leaderboard save queue error:", err.message)
    )
}

function getLeaderboard() {
    const sorted = Array.from(countCache.entries()).sort((a, b) => b[1] - a[1])
    return sorted.length === 0 ? null : sorted
}

function resetForTests(seed = {}) {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    pendingIncrements.clear()
    initializationPromise = null
    flushPromise = null
    initialized = false
    seedCache(seed)
}

initializeRoastLeaderboard()
    .then(ok => { if (ok && pendingIncrements.size > 0) return flushRoastIncrements() })
    .catch(err => console.error("Roast leaderboard MongoDB startup error:", err.message))

module.exports = {
    LEADERBOARD_FILE,
    addRoast,
    getLeaderboard,
    initializeRoastLeaderboard,
    flushRoastIncrements,
    _resetForTests: resetForTests,
}
