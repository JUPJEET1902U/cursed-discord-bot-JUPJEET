const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const PetData = require("../database/petModel")

const PETS_FILE = "./pets.json"
const LEGACY_PETS_PATH = path.resolve(__dirname, "..", "pets.json")
const DELETE_PET = Symbol("delete-pet")

const PET_TYPES = {
    dragon: { emoji: "🐉", desc: "Fierce and loyal, grows to be a mighty beast",       personality: "You are a fierce but loyal dragon named {name}. Speak in short dramatic sentences. You are protective of your owner." },
    cat:    { emoji: "😺", desc: "Sarcastic like its owner, mysteriously powerful",     personality: "You are a sarcastic and superior cat named {name}. Speak with disdain and mild condescension. You secretly care." },
    ghost:  { emoji: "👻", desc: "Haunts your enemies and spooks the server",           personality: "You are a spooky ghost named {name}. Speak ominously and reference the afterlife. You're playfully scary." },
    slime:  { emoji: "🟢", desc: "Weird and wobbly, surprisingly powerful",             personality: "You are a cheerful bubbly slime named {name}. Speak with enthusiasm and lots of bouncy energy." },
    demon:  { emoji: "😈", desc: "Pure evil energy, maximum chaos",                     personality: "You are a chaotic little demon named {name}. Speak with sinister energy and dark humor. Chaos is your love language." },
}

function readLegacyPets() {
    try {
        if (fs.existsSync(LEGACY_PETS_PATH)) {
            return JSON.parse(fs.readFileSync(LEGACY_PETS_PATH, "utf8"))
        }
    } catch (err) {
        console.error("Pets legacy import read error:", err.message)
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

const petCache = readLegacyPets()
const knownSnapshots = new Map(
    Object.entries(petCache).map(([userId, pet]) => [userId, serialize(pet)])
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
        console.error("Pets MongoDB connection error:", err.message)
        return false
    }
}

function scheduleRetry() {
    if (!process.env.MONGO_URI || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializePetStore()
            .then(ok => { if (ok) return flushPets() })
            .catch(err => console.error("Pets MongoDB retry error:", err.message))
    }, 30000)
    retryTimer.unref?.()
}

async function initializePetStore() {
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        const connected = await ensureMongoConnected()
        if (!connected) {
            if (!process.env.MONGO_URI) {
                console.warn("⚠️  MONGO_URI not set — pets are running from memory without persistence")
            }
            scheduleRetry()
            return false
        }

        const legacyEntries = Object.entries(petCache)
        let imported = 0

        if (legacyEntries.length > 0) {
            const result = await PetData.bulkWrite(
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

        const records = await PetData.find({}).lean()
        for (const record of records) {
            const userId = record.userId
            const mongoData = clone(record.data)
            // A pet command may change the cache while MongoDB is connecting.
            // Keep the newer local value queued instead of replacing it with the
            // startup database snapshot.
            if (!pendingWrites.has(userId)) {
                if (mongoData == null) {
                    // A null MongoDB value is a tombstone. It blocks stale
                    // pets.json data while staying invisible to current callers.
                    delete petCache[userId]
                    knownSnapshots.delete(userId)
                } else {
                    petCache[userId] = mongoData
                    knownSnapshots.set(userId, serialize(mongoData))
                }
            }
        }

        initialized = true
        console.log(`✅ Pets MongoDB ready: ${records.length} pet(s), ${imported} imported from legacy JSON`)
        return true
    })()

    try {
        return await initializationPromise
    } catch (err) {
        console.error("Pets MongoDB initialization error:", err.message)
        scheduleRetry()
        return false
    } finally {
        if (!initialized) initializationPromise = null
    }
}

function loadPets() {
    return petCache
}

function collectChangedPets(data) {
    const source = data && typeof data === "object" ? data : petCache
    const sourceIds = new Set(Object.keys(source))

    for (const [userId, pet] of Object.entries(source)) {
        if (source !== petCache) petCache[userId] = clone(pet)

        const snapshot = serialize(pet)
        if (snapshot !== knownSnapshots.get(userId)) {
            pendingWrites.set(userId, clone(pet))
            knownSnapshots.set(userId, snapshot)
        }
    }

    for (const userId of Array.from(knownSnapshots.keys())) {
        if (!sourceIds.has(userId)) {
            delete petCache[userId]
            pendingWrites.set(userId, DELETE_PET)
            knownSnapshots.delete(userId)
        }
    }
}

function savePets(data) {
    try {
        collectChangedPets(data)
        return flushPets()
    } catch (err) {
        console.error("Pets save queue error:", err.message)
        return Promise.resolve(false)
    }
}

async function flushPets() {
    if (flushPromise) return flushPromise
    if (pendingWrites.size === 0) return true

    flushPromise = (async () => {
        const ready = await initializePetStore()
        if (!ready) {
            scheduleRetry()
            return false
        }

        while (pendingWrites.size > 0) {
            const batch = Array.from(pendingWrites.entries())
            for (const [userId] of batch) pendingWrites.delete(userId)

            try {
                await PetData.bulkWrite(
                    batch.map(([userId, pet]) => ({
                        updateOne: {
                            filter: { userId },
                            update: {
                                $set: {
                                    userId,
                                    data: pet === DELETE_PET ? null : clone(pet),
                                },
                            },
                            upsert: true,
                        },
                    })),
                    { ordered: false }
                )
            } catch (err) {
                for (const [userId, pet] of batch) {
                    if (!pendingWrites.has(userId)) pendingWrites.set(userId, pet)
                }
                console.error("Pets MongoDB save error:", err.message)
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
            setImmediate(() => flushPets().catch(err =>
                console.error("Pets MongoDB follow-up save error:", err.message)
            ))
        }
    }
}

function getPet(userId) {
    return { data: petCache, pet: petCache[userId] || null }
}

function calcPetLevel(xp) { return Math.floor(0.15 * Math.sqrt(xp)) + 1 }

initializePetStore()
    .then(ok => { if (ok && pendingWrites.size > 0) return flushPets() })
    .catch(err => console.error("Pets MongoDB startup error:", err.message))

module.exports = {
    PETS_FILE,
    PET_TYPES,
    loadPets,
    savePets,
    getPet,
    calcPetLevel,
    initializePetStore,
    flushPets,
}
