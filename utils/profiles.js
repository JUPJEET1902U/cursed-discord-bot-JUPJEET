const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const ProfileData = require("../database/profileModel")

const PROFILES_FILE = "./profiles.json"
const LEGACY_PROFILES_PATH = path.resolve(__dirname, "..", "profiles.json")
const DELETE_PROFILE = Symbol("delete-profile")

function readLegacyProfiles() {
    try {
        if (fs.existsSync(LEGACY_PROFILES_PATH)) {
            return JSON.parse(fs.readFileSync(LEGACY_PROFILES_PATH, "utf8"))
        }
    } catch (err) {
        console.error("Profiles legacy import read error:", err.message)
    }
    return {}
}

function clone(value) {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function serialize(value) {
    return JSON.stringify(value)
}

const profileCache = readLegacyProfiles()
const knownSnapshots = new Map(
    Object.entries(profileCache).map(([userId, profile]) => [userId, serialize(profile)])
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
        console.error("Profiles MongoDB connection error:", err.message)
        return false
    }
}

function scheduleRetry() {
    if (!process.env.MONGO_URI || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializeProfileStore()
            .then(ok => { if (ok) return flushProfiles() })
            .catch(err => console.error("Profiles MongoDB retry error:", err.message))
    }, 30000)
    retryTimer.unref?.()
}

async function initializeProfileStore() {
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        const connected = await ensureMongoConnected()
        if (!connected) {
            if (!process.env.MONGO_URI) {
                console.warn("⚠️  MONGO_URI not set — profiles are running from memory without persistence")
            }
            scheduleRetry()
            return false
        }

        const legacyEntries = Object.entries(profileCache)
        let imported = 0

        if (legacyEntries.length > 0) {
            const result = await ProfileData.bulkWrite(
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

        const records = await ProfileData.find({}).lean()
        for (const record of records) {
            const userId = record.userId
            const mongoData = clone(record.data)
            // A profile command may update the cache while MongoDB is connecting.
            // Keep the newer local value queued instead of replacing it with the
            // startup database snapshot.
            if (!pendingWrites.has(userId)) {
                profileCache[userId] = mongoData
                knownSnapshots.set(userId, serialize(mongoData))
            }
        }

        initialized = true
        console.log(`✅ Profiles MongoDB ready: ${records.length} profile(s), ${imported} imported from legacy JSON`)
        return true
    })()

    try {
        return await initializationPromise
    } catch (err) {
        console.error("Profiles MongoDB initialization error:", err.message)
        scheduleRetry()
        return false
    } finally {
        if (!initialized) initializationPromise = null
    }
}

function loadProfiles() {
    return profileCache
}

function collectChangedProfiles(data) {
    const source = data && typeof data === "object" ? data : profileCache
    const sourceIds = new Set(Object.keys(source))

    for (const [userId, profile] of Object.entries(source)) {
        if (source !== profileCache) profileCache[userId] = clone(profile)

        const snapshot = serialize(profile)
        if (snapshot !== knownSnapshots.get(userId)) {
            pendingWrites.set(userId, clone(profile))
            knownSnapshots.set(userId, snapshot)
        }
    }

    for (const userId of Array.from(knownSnapshots.keys())) {
        if (!sourceIds.has(userId)) {
            delete profileCache[userId]
            pendingWrites.set(userId, DELETE_PROFILE)
            knownSnapshots.delete(userId)
        }
    }
}

function saveProfiles(data) {
    try {
        collectChangedProfiles(data)
        return flushProfiles()
    } catch (err) {
        console.error("Profiles save queue error:", err.message)
        return Promise.resolve(false)
    }
}

async function flushProfiles() {
    if (flushPromise) return flushPromise
    if (pendingWrites.size === 0) return true

    flushPromise = (async () => {
        const ready = await initializeProfileStore()
        if (!ready) {
            scheduleRetry()
            return false
        }

        while (pendingWrites.size > 0) {
            const batch = Array.from(pendingWrites.entries())
            for (const [userId] of batch) pendingWrites.delete(userId)

            try {
                await ProfileData.bulkWrite(
                    batch.map(([userId, profile]) => profile === DELETE_PROFILE
                        ? { deleteOne: { filter: { userId } } }
                        : {
                            updateOne: {
                                filter: { userId },
                                update: { $set: { userId, data: clone(profile) } },
                                upsert: true,
                            },
                        }),
                    { ordered: false }
                )
            } catch (err) {
                for (const [userId, profile] of batch) {
                    if (!pendingWrites.has(userId)) pendingWrites.set(userId, profile)
                }
                console.error("Profiles MongoDB save error:", err.message)
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
            setImmediate(() => flushProfiles().catch(err =>
                console.error("Profiles MongoDB follow-up save error:", err.message)
            ))
        }
    }
}

function getProfile(userId) {
    return profileCache[userId] || null
}

function setProfile(userId, profile) {
    profileCache[userId] = profile
    saveProfiles(profileCache)
}

initializeProfileStore()
    .then(ok => { if (ok && pendingWrites.size > 0) return flushProfiles() })
    .catch(err => console.error("Profiles MongoDB startup error:", err.message))

module.exports = {
    PROFILES_FILE,
    loadProfiles,
    saveProfiles,
    getProfile,
    setProfile,
    initializeProfileStore,
    flushProfiles,
}
