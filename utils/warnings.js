/**
 * Mongo-first warning store with a legacy warnings.json migration fallback.
 * The public API stays synchronous for compatibility with existing commands:
 * cache updates happen immediately and Mongo persistence is queued safely.
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const mongoose = require("mongoose")

const WARNINGS_FILE = path.resolve(process.cwd(), "warnings.json")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const warningSchema = new mongoose.Schema({
    id: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    moderatorId: { type: String, required: true },
    moderatorName: { type: String, required: true },
    timestamp: { type: Date, required: true },
    active: { type: Boolean, default: true },
    clearedAt: { type: Date, default: null },
    clearedById: { type: String, default: null },
})

const warningRecordSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: "Unknown user" },
    warnings: { type: [warningSchema], default: [] },
}, { collection: "warningRecords", timestamps: true, minimize: false })
warningRecordSchema.index({ guildId: 1, userId: 1 }, { unique: true })

const WarningRecord = getModel("WarningRecord", warningRecordSchema)
const cache = new Map()
let bootstrapInFlight = null

function key(guildId, userId) {
    return `${guildId}:${userId}`
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function normalizeWarning(warning = {}) {
    return {
        id: String(warning.id || crypto.randomUUID()),
        reason: String(warning.reason || "No reason provided").slice(0, 2000),
        moderatorId: String(warning.moderatorId || "unknown"),
        moderatorName: String(warning.moderatorName || "Unknown moderator").slice(0, 256),
        timestamp: new Date(warning.timestamp || Date.now()).toISOString(),
        active: warning.active !== false,
        clearedAt: warning.clearedAt ? new Date(warning.clearedAt).toISOString() : null,
        clearedById: warning.clearedById ? String(warning.clearedById) : null,
    }
}

function normalizeRecord(guildId, userId, value = {}) {
    return {
        guildId: String(guildId),
        userId: String(userId),
        username: String(value.username || "Unknown user").slice(0, 256),
        warnings: Array.isArray(value.warnings) ? value.warnings.map(normalizeWarning) : [],
    }
}

function loadLegacyWarnings() {
    try {
        if (!fs.existsSync(WARNINGS_FILE)) return {}
        const parsed = JSON.parse(fs.readFileSync(WARNINGS_FILE, "utf8"))
        return parsed && typeof parsed === "object" ? parsed : {}
    } catch (err) {
        console.error("Warnings load error:", err.message)
        return {}
    }
}

function loadLegacyRecord(guildId, userId) {
    const data = loadLegacyWarnings()
    const value = data?.[guildId]?.[userId]
    return value ? normalizeRecord(guildId, userId, value) : null
}

function persistRecord(record) {
    if (!isMongoConnected()) return
    const mongoWarnings = record.warnings.map(warning => ({
        ...warning,
        timestamp: new Date(warning.timestamp),
        clearedAt: warning.clearedAt ? new Date(warning.clearedAt) : null,
    }))
    WarningRecord.updateOne(
        { guildId: record.guildId, userId: record.userId },
        {
            $set: {
                username: record.username,
                warnings: mongoWarnings,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                guildId: record.guildId,
                userId: record.userId,
                createdAt: new Date(),
            },
        },
        { upsert: true }
    ).catch(err => console.error("Warning persistence error:", err.message))
}

function getRecord(guildId, userId, username = null) {
    const cacheKey = key(guildId, userId)
    if (cache.has(cacheKey)) return cache.get(cacheKey)

    const legacy = loadLegacyRecord(guildId, userId)
    const record = legacy || normalizeRecord(guildId, userId, { username, warnings: [] })
    if (username) record.username = String(username).slice(0, 256)
    cache.set(cacheKey, record)
    if (legacy) persistRecord(record)
    return record
}

function addWarning(guildId, userId, username, reason, moderatorId, moderatorName) {
    const record = getRecord(guildId, userId, username)
    record.username = String(username || record.username).slice(0, 256)
    record.warnings.push(normalizeWarning({
        id: crypto.randomUUID(),
        reason,
        moderatorId,
        moderatorName,
        timestamp: new Date(),
        active: true,
    }))
    persistRecord(record)
    return clone(record.warnings.filter(warning => warning.active !== false))
}

function getWarnings(guildId, userId, { includeCleared = false } = {}) {
    const record = getRecord(guildId, userId)
    const warnings = includeCleared
        ? record.warnings
        : record.warnings.filter(warning => warning.active !== false)
    return clone(warnings)
}

function clearWarnings(guildId, userId, clearedById = null) {
    const record = getRecord(guildId, userId)
    const active = record.warnings.filter(warning => warning.active !== false)
    const now = new Date().toISOString()
    for (const warning of record.warnings) {
        if (warning.active === false) continue
        warning.active = false
        warning.clearedAt = now
        warning.clearedById = clearedById ? String(clearedById) : null
    }
    persistRecord(record)
    return active.length
}

function getWarningCount(guildId, userId) {
    return getWarnings(guildId, userId).length
}

async function bootstrapWarnings() {
    if (!isMongoConnected()) return
    if (bootstrapInFlight) return bootstrapInFlight

    bootstrapInFlight = (async () => {
        try {
            const docs = await WarningRecord.find({}).lean()
            for (const doc of docs) {
                const record = normalizeRecord(doc.guildId, doc.userId, doc)
                cache.set(key(doc.guildId, doc.userId), record)
            }

            const legacy = loadLegacyWarnings()
            for (const [guildId, users] of Object.entries(legacy)) {
                for (const [userId, value] of Object.entries(users || {})) {
                    const cacheKey = key(guildId, userId)
                    if (cache.has(cacheKey)) continue
                    const record = normalizeRecord(guildId, userId, value)
                    cache.set(cacheKey, record)
                    await WarningRecord.updateOne(
                        { guildId: String(guildId), userId: String(userId) },
                        {
                            $setOnInsert: {
                                guildId: String(guildId),
                                userId: String(userId),
                                username: record.username,
                                warnings: record.warnings.map(warning => ({
                                    ...warning,
                                    timestamp: new Date(warning.timestamp),
                                    clearedAt: warning.clearedAt ? new Date(warning.clearedAt) : null,
                                })),
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        },
                        { upsert: true }
                    )
                }
            }
        } catch (err) {
            console.error("Warning bootstrap error:", err.message)
        } finally {
            bootstrapInFlight = null
        }
    })()

    return bootstrapInFlight
}

mongoose.connection.on("connected", bootstrapWarnings)
if (isMongoConnected()) bootstrapWarnings()

module.exports = {
    WarningRecord,
    addWarning,
    getWarnings,
    clearWarnings,
    getWarningCount,
    bootstrapWarnings,
}
