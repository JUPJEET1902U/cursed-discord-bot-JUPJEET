/**
 * Mongo-first guild configuration store with a serverConfig.json fallback.
 *
 * Bot commands keep their existing synchronous API through an in-memory
 * cache. MongoDB is refreshed in the background, and legacy JSON documents
 * are inserted only when a guild has no MongoDB document yet.
 */

const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")

const CONFIG_FILE = path.resolve(process.cwd(), "serverConfig.json")
const parsedRefreshInterval = Number(process.env.GUILD_CONFIG_REFRESH_MS || 5000)
const REFRESH_INTERVAL_MS =
    Number.isFinite(parsedRefreshInterval) && parsedRefreshInterval >= 1000
        ? parsedRefreshInterval
        : 5000
const MIRROR_JSON =
    String(process.env.GUILD_CONFIG_MIRROR_JSON || "true").toLowerCase() !== "false"
const BASELINE_SYMBOL = Symbol("guildConfigBaseline")

const DEFAULT_CONFIG = {
    allowedChannels: [],
    premiumRoleId: null,
    paymentLinks: {},
    welcomeChannelId: null,
    welcomeMessage: null,
    welcomeUseAI: false,
    welcomeColor: null,
    welcomeThumbnail: true,
    welcomeImageUrl: null,
    welcomeFooter: null,
    autoroleId: null,
    autoroleRoleName: null,
}

const guildConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
    },
    {
        collection: "guildConfigs",
        strict: false,
        minimize: false,
    }
)

const GuildConfigModel = getModel("GuildConfig", guildConfigSchema)

const mongoCache = new Map()
const pendingMigrations = new Set()
let refreshTimer = null
let refreshInFlight = false

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value || {}))
}

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function normalizeConfig(config = {}) {
    const normalized = { ...config }

    if (!Array.isArray(normalized.allowedChannels)) normalized.allowedChannels = []
    if (!normalized.paymentLinks || typeof normalized.paymentLinks !== "object") normalized.paymentLinks = {}
    if (normalized.premiumRoleId === undefined) normalized.premiumRoleId = null

    if (normalized.welcomeChannelId === undefined) normalized.welcomeChannelId = null
    if (normalized.welcomeMessage === undefined) normalized.welcomeMessage = null
    if (normalized.welcomeUseAI === undefined) normalized.welcomeUseAI = false
    if (normalized.welcomeColor === undefined) normalized.welcomeColor = null
    if (normalized.welcomeThumbnail === undefined) normalized.welcomeThumbnail = true
    if (normalized.welcomeImageUrl === undefined) normalized.welcomeImageUrl = null
    if (normalized.welcomeFooter === undefined) normalized.welcomeFooter = null

    if (normalized.autoroleId === undefined) normalized.autoroleId = null
    if (normalized.autoroleRoleName === undefined) normalized.autoroleRoleName = null

    return normalized
}

function stripMongoFields(doc) {
    if (!doc) return null
    const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc }
    delete obj._id
    delete obj.__v
    delete obj.createdAt
    delete obj.updatedAt
    delete obj.migratedFrom
    delete obj.migratedAt
    const { guildId, ...config } = obj
    return { guildId, config: normalizeConfig(config) }
}

function loadJsonConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
            return parsed && typeof parsed === "object" ? parsed : {}
        }
    } catch (err) {
        console.error("Config load error:", err.message)
    }
    return {}
}

function writeJsonConfig(data) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
        return true
    } catch (err) {
        console.error("Config save error:", err.message)
        return false
    }
}

function saveJsonGuildConfig(guildId, config) {
    if (!MIRROR_JSON) return true
    const data = loadJsonConfig()
    data[guildId] = normalizeConfig(config)
    return writeJsonConfig(data)
}

async function upsertMongoConfig(guildId, config, extra = {}) {
    if (!isMongoConnected()) return false

    const normalized = normalizeConfig(config)
    const setFields = {}
    const unsetFields = {}

    for (const [key, value] of Object.entries({ ...normalized, ...extra })) {
        if (value === undefined) unsetFields[key] = ""
        else setFields[key] = value
    }

    setFields.updatedAt = new Date()

    try {
        const update = {
            $set: setFields,
            $setOnInsert: { guildId, createdAt: new Date() },
        }
        if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields

        await GuildConfigModel.updateOne({ guildId }, update, { upsert: true })
        mongoCache.set(guildId, clone(normalized))
        return true
    } catch (err) {
        console.error(`[GuildConfigStore] Mongo save failed for ${guildId}: ${err.message}`)
        return false
    }
}

async function insertMongoConfigIfMissing(guildId, config, extra = {}) {
    if (!isMongoConnected()) return false

    const normalized = normalizeConfig(config)
    const insertFields = {}
    for (const [key, value] of Object.entries({ ...normalized, ...extra })) {
        if (value !== undefined) insertFields[key] = value
    }

    try {
        const result = await GuildConfigModel.updateOne(
            { guildId },
            {
                $setOnInsert: {
                    guildId,
                    ...insertFields,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            { upsert: true }
        )

        if (result.upsertedCount > 0) mongoCache.set(guildId, clone(normalized))
        return result.upsertedCount > 0
    } catch (err) {
        if (err?.code !== 11000) {
            console.error(`[GuildConfigStore] Mongo migration failed for ${guildId}: ${err.message}`)
        }
        return false
    }
}

function migrateJsonGuildToMongo(guildId, config) {
    if (!isMongoConnected() || pendingMigrations.has(guildId)) return
    pendingMigrations.add(guildId)

    insertMongoConfigIfMissing(guildId, config, {
        migratedFrom: "serverConfig.json",
        migratedAt: new Date(),
    }).finally(() => pendingMigrations.delete(guildId))
}

async function refreshMongoCache() {
    if (!isMongoConnected() || refreshInFlight) return
    refreshInFlight = true
    try {
        const docs = await GuildConfigModel.find({}).lean()
        const next = new Map()
        for (const doc of docs) {
            const parsed = stripMongoFields(doc)
            if (parsed?.guildId) next.set(parsed.guildId, parsed.config)
        }
        mongoCache.clear()
        for (const [guildId, config] of next) mongoCache.set(guildId, clone(config))
    } catch (err) {
        console.error(`[GuildConfigStore] Mongo refresh failed: ${err.message}`)
    } finally {
        refreshInFlight = false
    }
}

async function migrateJsonConfigsToMongo() {
    if (!isMongoConnected()) return

    const data = loadJsonConfig()
    for (const [guildId, config] of Object.entries(data)) {
        if (!mongoCache.has(guildId)) {
            migrateJsonGuildToMongo(guildId, normalizeConfig(config))
        }
    }
}

async function bootstrapMongoCache() {
    await refreshMongoCache()
    await migrateJsonConfigsToMongo()
}

function startRefreshLoop() {
    if (refreshTimer || !isMongoConnected()) return
    bootstrapMongoCache()
    refreshTimer = setInterval(refreshMongoCache, REFRESH_INTERVAL_MS)
    if (typeof refreshTimer.unref === "function") refreshTimer.unref()
}

function stopRefreshLoop() {
    if (!refreshTimer) return
    clearInterval(refreshTimer)
    refreshTimer = null
}

mongoose.connection.on("connected", startRefreshLoop)
mongoose.connection.on("disconnected", stopRefreshLoop)
mongoose.connection.on("error", stopRefreshLoop)
if (isMongoConnected()) startRefreshLoop()

function getGuildConfig(guildId) {
    if (!guildId) throw new Error("guildId is required")
    if (mongoCache.has(guildId)) return clone(mongoCache.get(guildId))

    const data = loadJsonConfig()
    const config = normalizeConfig(data[guildId] || DEFAULT_CONFIG)
    data[guildId] = config

    if (MIRROR_JSON) writeJsonConfig(data)
    migrateJsonGuildToMongo(guildId, config)
    return clone(config)
}

function createTrackedGuildData(guildId, config) {
    const normalized = normalizeConfig(config)
    const data = { [guildId]: config }
    Object.defineProperty(data, BASELINE_SYMBOL, {
        enumerable: false,
        value: { [guildId]: clone(normalized) },
    })
    return data
}

function saveGuildConfig(guildId, config) {
    if (!guildId) throw new Error("guildId is required")

    const normalized = normalizeConfig(config)
    mongoCache.set(guildId, clone(normalized))
    saveJsonGuildConfig(guildId, normalized)
    upsertMongoConfig(guildId, normalized)
    return clone(normalized)
}

function updateGuildConfig(guildId, updates = {}) {
    const current = getGuildConfig(guildId)
    return saveGuildConfig(guildId, { ...current, ...updates })
}

/**
 * Atomically applies a validated field patch and waits for MongoDB.
 * Legacy JSON is used only as $setOnInsert data, so it can never overwrite an
 * existing MongoDB document. Existing synchronous command writes are unchanged.
 */
async function updateGuildConfigAndWait(guildId, updates = {}) {
    if (!guildId) throw new Error("guildId is required")
    if (!isMongoConnected()) {
        const error = new Error("MongoDB is unavailable")
        error.code = "MONGO_UNAVAILABLE"
        throw error
    }

    const blockedKeys = new Set([
        "_id", "__v", "guildId", "createdAt", "updatedAt",
        "migratedFrom", "migratedAt",
    ])
    const setFields = { updatedAt: new Date() }
    const unsetFields = {}

    for (const [key, value] of Object.entries(updates || {})) {
        if (blockedKeys.has(key)) continue
        if (value === undefined) unsetFields[key] = ""
        else setFields[key] = value
    }

    const jsonData = loadJsonConfig()
    const legacyConfig = normalizeConfig(jsonData[guildId] || DEFAULT_CONFIG)
    const setOnInsert = { ...legacyConfig }

    for (const key of blockedKeys) delete setOnInsert[key]
    Object.assign(setOnInsert, {
        guildId,
        createdAt: new Date(),
        migratedFrom: "serverConfig.json",
        migratedAt: new Date(),
    })

    for (const key of [...Object.keys(setFields), ...Object.keys(unsetFields)]) {
        delete setOnInsert[key]
    }

    const update = { $set: setFields, $setOnInsert: setOnInsert }
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields

    let doc
    try {
        doc = await GuildConfigModel.findOneAndUpdate(
            { guildId },
            update,
            { upsert: true, new: true }
        ).lean()
    } catch (err) {
        if (err?.code !== 11000) throw err
        doc = await GuildConfigModel.findOneAndUpdate(
            { guildId },
            { $set: setFields, ...(update.$unset ? { $unset: update.$unset } : {}) },
            { new: true }
        ).lean()
    }

    const parsed = stripMongoFields(doc)
    if (!parsed?.config) throw new Error("Guild config update returned no document")

    mongoCache.set(guildId, clone(parsed.config))
    saveJsonGuildConfig(guildId, parsed.config)
    return clone(parsed.config)
}

function loadAllGuildConfigs() {
    const data = loadJsonConfig()
    for (const [guildId, config] of mongoCache) data[guildId] = clone(config)
    return data
}

function saveAllGuildConfigs(data) {
    const baseline = data?.[BASELINE_SYMBOL] || null
    const normalizedData = {}

    for (const [guildId, config] of Object.entries(data || {})) {
        normalizedData[guildId] = normalizeConfig(config)

        if (baseline?.[guildId]) {
            const before = normalizeConfig(baseline[guildId])
            const after = normalizedData[guildId]
            const updates = {}

            const keys = new Set([...Object.keys(before), ...Object.keys(after)])
            for (const key of keys) {
                const value = after[key]
                if (JSON.stringify(value) !== JSON.stringify(before[key])) updates[key] = value
            }

            if (Object.keys(updates).length === 0) continue
            updateGuildConfig(guildId, updates)
            continue
        }

        mongoCache.set(guildId, clone(normalizedData[guildId]))
        saveJsonGuildConfig(guildId, normalizedData[guildId])
        upsertMongoConfig(guildId, normalizedData[guildId])
    }

    if (baseline) return normalizedData
    if (MIRROR_JSON) writeJsonConfig(normalizedData)
    return normalizedData
}

module.exports = {
    getGuildConfig,
    saveGuildConfig,
    updateGuildConfig,
    updateGuildConfigAndWait,
    loadAllGuildConfigs,
    saveAllGuildConfigs,
    createTrackedGuildData,
    normalizeConfig,
    refreshMongoCache,
    migrateJsonConfigsToMongo,
    isMongoConnected,
}
