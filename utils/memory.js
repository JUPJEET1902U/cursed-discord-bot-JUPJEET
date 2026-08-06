const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const ShortTermMemory = require("../database/shortTermMemoryModel")

const MEMORY_FILE = "./memory.json"
const MEMORY_FILE_BAK = "./memory.json.bak"
const LEGACY_MEMORY_PATH = path.resolve(__dirname, "..", "memory.json")
const MAX_MEMORY = 40
const MAX_CONTEXT = 20
const MAX_FILE_SIZE = 10_485_760
const DELETE_MEMORY = Symbol("delete-memory")

function memKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function boundedLimit(value, fallback, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(max, Math.floor(parsed)))
}

function planLimits(userId) {
    try { return require("./premium").getPlanLimits(userId) }
    catch { return { memoryStoredMessages: 8, memoryContextMessages: 4 } }
}

function clone(value) {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function serialize(value) {
    return JSON.stringify(value)
}

function readLegacyMemory() {
    try {
        if (fs.existsSync(LEGACY_MEMORY_PATH)) {
            return JSON.parse(fs.readFileSync(LEGACY_MEMORY_PATH, "utf8"))
        }
    } catch (err) {
        console.error("Memory legacy import read error:", err.message)
    }
    return {}
}

const memoryCache = readLegacyMemory()
const knownSnapshots = new Map(
    Object.entries(memoryCache).map(([key, history]) => [key, serialize(history)])
)
const pendingWrites = new Map()
let initializationPromise = null
let initialized = false
let flushPromise = null
let retryTimer = null

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
        console.error("Short-term memory MongoDB connection error:", err.message)
        return false
    }
}

function scheduleRetry() {
    if (!process.env.MONGO_URI || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializeMemoryStore()
            .then(ok => { if (ok) return flushMemory() })
            .catch(err => console.error("Short-term memory MongoDB retry error:", err.message))
    }, 30000)
    retryTimer.unref?.()
}

async function initializeMemoryStore() {
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        const connected = await ensureMongoConnected()
        if (!connected) {
            if (!process.env.MONGO_URI) {
                console.warn("⚠️  MONGO_URI not set — short-term memory is running from memory without persistence")
            }
            scheduleRetry()
            return false
        }

        const legacyEntries = Object.entries(memoryCache)
        let imported = 0

        if (legacyEntries.length > 0) {
            const result = await ShortTermMemory.bulkWrite(
                legacyEntries.map(([memoryKey, messages]) => ({
                    updateOne: {
                        filter: { memoryKey },
                        update: { $setOnInsert: { memoryKey, messages: clone(messages) } },
                        upsert: true,
                    },
                })),
                { ordered: false }
            )
            imported = result.upsertedCount || 0
        }

        const records = await ShortTermMemory.find({}).lean()
        for (const record of records) {
            const key = record.memoryKey
            const mongoMessages = clone(record.messages)
            // A chat or !clearmemory command may update the cache while MongoDB
            // is connecting. Keep that newer local operation queued instead of
            // replacing it with an older startup snapshot.
            if (!pendingWrites.has(key)) {
                memoryCache[key] = mongoMessages
                knownSnapshots.set(key, serialize(mongoMessages))
            }
        }

        initialized = true
        console.log(`✅ Short-term memory MongoDB ready: ${records.length} conversation(s), ${imported} imported from legacy JSON`)
        return true
    })()

    try {
        return await initializationPromise
    } catch (err) {
        console.error("Short-term memory MongoDB initialization error:", err.message)
        scheduleRetry()
        return false
    } finally {
        if (!initialized) initializationPromise = null
    }
}

function loadMemory() {
    return memoryCache
}

function collectChangedMemory(mem) {
    const source = mem && typeof mem === "object" ? mem : memoryCache
    const sourceKeys = new Set(Object.keys(source))

    for (const [key, history] of Object.entries(source)) {
        if (source !== memoryCache) memoryCache[key] = clone(history)

        const snapshot = serialize(history)
        if (snapshot !== knownSnapshots.get(key)) {
            pendingWrites.set(key, clone(history))
            knownSnapshots.set(key, snapshot)
        }
    }

    for (const key of Array.from(knownSnapshots.keys())) {
        if (!sourceKeys.has(key)) {
            delete memoryCache[key]
            pendingWrites.set(key, DELETE_MEMORY)
            knownSnapshots.delete(key)
        }
    }
}

function saveMemory(mem) {
    try {
        collectChangedMemory(mem)
        return flushMemory()
    } catch (err) {
        console.error("Short-term memory save queue error:", err.message)
        return Promise.resolve(false)
    }
}

async function flushMemory() {
    if (flushPromise) return flushPromise
    if (pendingWrites.size === 0) return true

    flushPromise = (async () => {
        const ready = await initializeMemoryStore()
        if (!ready) {
            scheduleRetry()
            return false
        }

        while (pendingWrites.size > 0) {
            const batch = Array.from(pendingWrites.entries())
            for (const [key] of batch) pendingWrites.delete(key)

            try {
                await ShortTermMemory.bulkWrite(
                    batch.map(([memoryKey, messages]) => messages === DELETE_MEMORY
                        ? { deleteOne: { filter: { memoryKey } } }
                        : {
                            updateOne: {
                                filter: { memoryKey },
                                update: { $set: { memoryKey, messages: clone(messages) } },
                                upsert: true,
                            },
                        }),
                    { ordered: false }
                )
            } catch (err) {
                for (const [key, messages] of batch) {
                    if (!pendingWrites.has(key)) pendingWrites.set(key, messages)
                }
                console.error("Short-term memory MongoDB save error:", err.message)
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
            setImmediate(() => flushMemory().catch(err =>
                console.error("Short-term memory MongoDB follow-up save error:", err.message)
            ))
        }
    }
}

function cleanupMemory() {
    const mem = loadMemory()
    let changed = false
    for (const key of Object.keys(mem)) {
        if (!Array.isArray(mem[key]) || mem[key].length === 0) {
            delete mem[key]
            changed = true
        } else if (mem[key].length > MAX_MEMORY) {
            mem[key] = mem[key].slice(-MAX_MEMORY)
            changed = true
        }
    }
    if (changed) saveMemory(mem)
}

function getUserMemory(guildId, userId, contextLimit) {
    const mem = loadMemory()
    const history = mem[memKey(guildId, userId)] || []
    const defaultLimit = planLimits(userId).memoryContextMessages
    const limit = boundedLimit(contextLimit, defaultLimit, MAX_CONTEXT)
    return limit === 0 ? [] : history.slice(-limit)
}

function appendUserMemory(guildId, userId, userMsg, botReply, storageLimit) {
    const mem = loadMemory()
    const key = memKey(guildId, userId)
    const defaultLimit = planLimits(userId).memoryStoredMessages
    const limit = boundedLimit(storageLimit, defaultLimit, MAX_MEMORY)
    if (limit === 0) {
        delete mem[key]
        pendingWrites.set(key, DELETE_MEMORY)
        knownSnapshots.delete(key)
        flushMemory()
        return
    }
    if (!mem[key]) mem[key] = []
    mem[key].push({ role: "user", content: userMsg })
    mem[key].push({ role: "assistant", content: botReply })
    if (mem[key].length > limit) mem[key] = mem[key].slice(-limit)
    saveMemory(mem)
}

function clearUserMemory(guildId, userId) {
    const key = memKey(guildId, userId)
    delete memoryCache[key]
    pendingWrites.set(key, DELETE_MEMORY)
    knownSnapshots.delete(key)
    flushMemory()
}

initializeMemoryStore()
    .then(ok => { if (ok && pendingWrites.size > 0) return flushMemory() })
    .catch(err => console.error("Short-term memory MongoDB startup error:", err.message))

module.exports = {
    getUserMemory,
    appendUserMemory,
    clearUserMemory,
    cleanupMemory,
    initializeMemoryStore,
    flushMemory,
    MEMORY_FILE,
    MEMORY_FILE_BAK,
    MAX_FILE_SIZE,
}
