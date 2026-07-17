const mongoose = require("mongoose")
const logger = require("./logger")

const log = logger.child("ModerationCases")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const moderationCaseSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    caseNumber: { type: Number, required: true, min: 1 },
    action: { type: String, required: true, uppercase: true, trim: true, index: true },
    targetId: { type: String, required: true, index: true },
    targetTag: { type: String, default: "Unknown user" },
    moderatorId: { type: String, default: null, index: true },
    moderatorTag: { type: String, default: "Auto-Moderation" },
    reason: { type: String, default: "No reason provided", maxlength: 2000 },
    durationMs: { type: Number, default: null, min: 0 },
    evidenceUrl: { type: String, default: null, maxlength: 2048 },
    source: { type: String, enum: ["manual", "automod", "system", "migration"], default: "manual" },
    status: { type: String, enum: ["active", "revoked", "expired", "deleted"], default: "active", index: true },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedById: { type: String, default: null },
    revokedByTag: { type: String, default: null },
    revokeReason: { type: String, default: null, maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: "moderationCases", timestamps: true, minimize: false })

moderationCaseSchema.index({ guildId: 1, caseNumber: 1 }, { unique: true })
moderationCaseSchema.index({ guildId: 1, targetId: 1, createdAt: -1 })
moderationCaseSchema.index({ guildId: 1, createdAt: -1 })

const caseCounterSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    sequence: { type: Number, default: 0, min: 0 },
}, { collection: "moderationCaseCounters", timestamps: true })

const ModerationCase = getModel("ModerationCase", moderationCaseSchema)
const ModerationCaseCounter = getModel("ModerationCaseCounter", caseCounterSchema)

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function cleanText(value, fallback, maxLength) {
    const text = typeof value === "string" ? value.trim() : ""
    return (text || fallback).slice(0, maxLength)
}

function normalizeAction(action) {
    return cleanText(action, "NOTE", 64).toUpperCase().replace(/[^A-Z0-9_]/g, "_")
}

function serializeCase(doc) {
    if (!doc) return null
    const value = typeof doc.toObject === "function" ? doc.toObject() : { ...doc }
    return {
        id: value._id ? String(value._id) : null,
        guildId: String(value.guildId),
        caseNumber: Number(value.caseNumber),
        action: String(value.action),
        targetId: String(value.targetId),
        targetTag: value.targetTag || "Unknown user",
        moderatorId: value.moderatorId || null,
        moderatorTag: value.moderatorTag || "Auto-Moderation",
        reason: value.reason || "No reason provided",
        durationMs: value.durationMs === null || value.durationMs === undefined
            ? null
            : Number(value.durationMs),
        evidenceUrl: value.evidenceUrl || null,
        source: value.source || "manual",
        status: value.status || "active",
        expiresAt: value.expiresAt ? new Date(value.expiresAt).toISOString() : null,
        revokedAt: value.revokedAt ? new Date(value.revokedAt).toISOString() : null,
        revokedById: value.revokedById || null,
        revokedByTag: value.revokedByTag || null,
        revokeReason: value.revokeReason || null,
        metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {},
        createdAt: value.createdAt ? new Date(value.createdAt).toISOString() : null,
        updatedAt: value.updatedAt ? new Date(value.updatedAt).toISOString() : null,
    }
}

async function nextCaseNumber(guildId) {
    const counter = await ModerationCaseCounter.findOneAndUpdate(
        { guildId: String(guildId) },
        { $inc: { sequence: 1 }, $setOnInsert: { guildId: String(guildId) } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return Number(counter.sequence)
}

async function createCase({
    guildId,
    action,
    target,
    moderator = null,
    reason = null,
    durationMs = null,
    evidenceUrl = null,
    source = "manual",
    status = "active",
    metadata = {},
}) {
    if (!isMongoConnected()) {
        log.warn(`Skipped case creation for ${guildId}: MongoDB unavailable`)
        return null
    }

    try {
        const caseNumber = await nextCaseNumber(guildId)
        const parsedDuration = Number(durationMs)
        const normalizedDuration = Number.isFinite(parsedDuration) && parsedDuration > 0
            ? Math.floor(parsedDuration)
            : null
        const expiresAt = normalizedDuration ? new Date(Date.now() + normalizedDuration) : null
        const doc = await ModerationCase.create({
            guildId: String(guildId),
            caseNumber,
            action: normalizeAction(action),
            targetId: String(target?.id || "unknown"),
            targetTag: cleanText(target?.tag, "Unknown user", 256),
            moderatorId: moderator?.id ? String(moderator.id) : null,
            moderatorTag: cleanText(moderator?.tag, "Auto-Moderation", 256),
            reason: cleanText(reason, "No reason provided", 2000),
            durationMs: normalizedDuration,
            evidenceUrl: typeof evidenceUrl === "string" && evidenceUrl.trim()
                ? evidenceUrl.trim().slice(0, 2048)
                : null,
            source: ["manual", "automod", "system", "migration"].includes(source) ? source : "manual",
            status: ["active", "revoked", "expired", "deleted"].includes(status) ? status : "active",
            expiresAt,
            metadata: metadata && typeof metadata === "object" ? metadata : {},
        })
        return serializeCase(doc)
    } catch (err) {
        log.error(`Case creation failed for ${guildId}: ${err.message}`)
        return null
    }
}

async function getCase(guildId, caseNumber) {
    if (!isMongoConnected()) return null
    const number = Number(caseNumber)
    if (!Number.isInteger(number) || number < 1) return null
    const doc = await ModerationCase.findOne({
        guildId: String(guildId),
        caseNumber: number,
        status: { $ne: "deleted" },
    }).lean()
    return serializeCase(doc)
}

async function listCases(guildId, options = {}) {
    if (!isMongoConnected()) return []
    const query = { guildId: String(guildId), status: { $ne: "deleted" } }
    if (options.targetId) query.targetId = String(options.targetId)
    if (options.action) query.action = normalizeAction(options.action)
    if (options.status && ["active", "revoked", "expired"].includes(options.status)) {
        query.status = options.status
    }
    if (options.beforeCaseNumber) {
        const before = Number(options.beforeCaseNumber)
        if (Number.isInteger(before) && before > 1) query.caseNumber = { $lt: before }
    }
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 25))
    const docs = await ModerationCase.find(query).sort({ caseNumber: -1 }).limit(limit).lean()
    return docs.map(serializeCase)
}

async function updateCaseReason(guildId, caseNumber, reason, moderator) {
    if (!isMongoConnected()) throw Object.assign(new Error("MongoDB is unavailable"), { code: "MONGO_UNAVAILABLE" })
    const cleanReason = cleanText(reason, "No reason provided", 2000)
    const doc = await ModerationCase.findOneAndUpdate(
        { guildId: String(guildId), caseNumber: Number(caseNumber), status: { $ne: "deleted" } },
        {
            $set: { reason: cleanReason },
            $push: {
                "metadata.reasonHistory": {
                    reason: cleanReason,
                    moderatorId: moderator?.id ? String(moderator.id) : null,
                    moderatorTag: moderator?.tag || null,
                    changedAt: new Date(),
                },
            },
        },
        { new: true }
    ).lean()
    return serializeCase(doc)
}

async function revokeCase(guildId, caseNumber, moderator, reason = null) {
    if (!isMongoConnected()) throw Object.assign(new Error("MongoDB is unavailable"), { code: "MONGO_UNAVAILABLE" })
    const doc = await ModerationCase.findOneAndUpdate(
        { guildId: String(guildId), caseNumber: Number(caseNumber), status: "active" },
        {
            $set: {
                status: "revoked",
                revokedAt: new Date(),
                revokedById: moderator?.id ? String(moderator.id) : null,
                revokedByTag: moderator?.tag || null,
                revokeReason: cleanText(reason, "Revoked by moderator", 1000),
            },
        },
        { new: true }
    ).lean()
    return serializeCase(doc)
}

async function softDeleteCase(guildId, caseNumber, moderator) {
    if (!isMongoConnected()) throw Object.assign(new Error("MongoDB is unavailable"), { code: "MONGO_UNAVAILABLE" })
    const doc = await ModerationCase.findOneAndUpdate(
        { guildId: String(guildId), caseNumber: Number(caseNumber), status: { $ne: "deleted" } },
        {
            $set: {
                status: "deleted",
                revokedAt: new Date(),
                revokedById: moderator?.id ? String(moderator.id) : null,
                revokedByTag: moderator?.tag || null,
                revokeReason: "Case deleted",
            },
        },
        { new: true }
    ).lean()
    return serializeCase(doc)
}

async function getCaseStats(guildId) {
    if (!isMongoConnected()) {
        return { available: false, total: 0, active: 0, warnings: 0, automod: 0, last24Hours: 0 }
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rows = await ModerationCase.aggregate([
        { $match: { guildId: String(guildId), status: { $ne: "deleted" } } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                warnings: { $sum: { $cond: [{ $eq: ["$action", "WARN"] }, 1, 0] } },
                automod: { $sum: { $cond: [{ $eq: ["$source", "automod"] }, 1, 0] } },
                last24Hours: { $sum: { $cond: [{ $gte: ["$createdAt", since] }, 1, 0] } },
            },
        },
    ])
    const row = rows[0] || {}
    return {
        available: true,
        total: Number(row.total || 0),
        active: Number(row.active || 0),
        warnings: Number(row.warnings || 0),
        automod: Number(row.automod || 0),
        last24Hours: Number(row.last24Hours || 0),
    }
}

module.exports = {
    ModerationCase,
    ModerationCaseCounter,
    isMongoConnected,
    serializeCase,
    createCase,
    getCase,
    listCases,
    updateCaseReason,
    revokeCase,
    softDeleteCase,
    getCaseStats,
}
