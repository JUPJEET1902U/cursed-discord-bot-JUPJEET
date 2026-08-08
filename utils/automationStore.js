const mongoose = require("mongoose")
const logger = require("./logger")

const log = logger.child("AutomationStore")
const CACHE_TTL_MS = 30_000
const MAX_RESPONDERS = 20
const MAX_REACTIONS = 10
const MAX_RESPONSE_LENGTH = 1800
const MAX_TRIGGER_LENGTH = 80
const MAX_EMOJIS = 5
const MATCH_MODES = Object.freeze(["exact", "contains"])

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const responderSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    trigger: { type: String, required: true },
    triggerKey: { type: String, required: true },
    response: { type: String, required: true },
    mode: { type: String, enum: MATCH_MODES, default: "exact" },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
}, { collection: "automationResponders", timestamps: true })
responderSchema.index({ guildId: 1, triggerKey: 1 }, { unique: true })

const reactionSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    trigger: { type: String, required: true },
    triggerKey: { type: String, required: true },
    emojis: { type: [String], default: [] },
    mode: { type: String, enum: MATCH_MODES, default: "exact" },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
}, { collection: "automationReactions", timestamps: true })
reactionSchema.index({ guildId: 1, triggerKey: 1 }, { unique: true })

const AutoResponderRule = getModel("AutoResponderRule", responderSchema)
const AutoReactionRule = getModel("AutoReactionRule", reactionSchema)

const responderCache = new Map()
const reactionCache = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function normalizeTrigger(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TRIGGER_LENGTH)
}

function triggerKey(value) {
    return normalizeTrigger(value).toLowerCase()
}

function normalizeMode(value) {
    return MATCH_MODES.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "exact"
}

function normalizeResponse(value) {
    return String(value || "").trim().slice(0, MAX_RESPONSE_LENGTH)
}

function normalizeEmojis(values) {
    const raw = Array.isArray(values) ? values : String(values || "").split(/\s+/)
    return [...new Set(raw.map(value => String(value || "").trim()).filter(Boolean))]
        .filter(value => value.length <= 100)
        .slice(0, MAX_EMOJIS)
}

function cacheGet(cache, guildId) {
    const entry = cache.get(String(guildId))
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
        cache.delete(String(guildId))
        return null
    }
    return entry.rules
}

function cacheSet(cache, guildId, rules) {
    const safe = Array.isArray(rules) ? rules : []
    cache.set(String(guildId), { rules: safe, expiresAt: Date.now() + CACHE_TTL_MS })
    return safe
}

function invalidateGuild(guildId) {
    const id = String(guildId)
    responderCache.delete(id)
    reactionCache.delete(id)
}

async function readRules(model, cache, guildId) {
    const id = String(guildId)
    const cached = cacheGet(cache, id)
    if (cached) return cached
    if (!isMongoConnected()) return []
    try {
        const rules = await model.find({ guildId: id, enabled: true }).sort({ createdAt: 1 }).lean()
        return cacheSet(cache, id, rules)
    } catch (error) {
        log.warn(`Rule lookup failed for ${id}: ${error.message}`)
        return []
    }
}

async function listResponderRules(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return AutoResponderRule.find({ guildId: String(guildId) }).sort({ createdAt: 1 }).lean()
}

async function listReactionRules(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return AutoReactionRule.find({ guildId: String(guildId) }).sort({ createdAt: 1 }).lean()
}

async function getResponderRules(guildId) {
    return readRules(AutoResponderRule, responderCache, guildId)
}

async function getReactionRules(guildId) {
    return readRules(AutoReactionRule, reactionCache, guildId)
}

async function upsertResponderRule(guildId, { trigger, response, mode = "exact", createdBy = null }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const id = String(guildId)
    const cleanTrigger = normalizeTrigger(trigger)
    const cleanResponse = normalizeResponse(response)
    if (!cleanTrigger) throw new Error("Trigger is required")
    if (!cleanResponse) throw new Error("Response is required")

    const key = triggerKey(cleanTrigger)
    const existing = await AutoResponderRule.findOne({ guildId: id, triggerKey: key }).lean()
    if (!existing) {
        const count = await AutoResponderRule.countDocuments({ guildId: id })
        if (count >= MAX_RESPONDERS) throw new Error(`This server already has the maximum of ${MAX_RESPONDERS} autoresponders`)
    }

    const doc = await AutoResponderRule.findOneAndUpdate(
        { guildId: id, triggerKey: key },
        {
            $set: {
                trigger: cleanTrigger,
                response: cleanResponse,
                mode: normalizeMode(mode),
                enabled: true,
                createdBy: createdBy ? String(createdBy) : null,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    invalidateGuild(id)
    return doc
}

async function removeResponderRule(guildId, trigger) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await AutoResponderRule.deleteOne({ guildId: String(guildId), triggerKey: triggerKey(trigger) })
    invalidateGuild(guildId)
    return result.deletedCount > 0
}

async function clearResponderRules(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await AutoResponderRule.deleteMany({ guildId: String(guildId) })
    invalidateGuild(guildId)
    return result.deletedCount || 0
}

async function upsertReactionRule(guildId, { trigger, emojis, mode = "exact", createdBy = null }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const id = String(guildId)
    const cleanTrigger = normalizeTrigger(trigger)
    const cleanEmojis = normalizeEmojis(emojis)
    if (!cleanTrigger) throw new Error("Trigger is required")
    if (!cleanEmojis.length) throw new Error("At least one emoji is required")

    const key = triggerKey(cleanTrigger)
    const existing = await AutoReactionRule.findOne({ guildId: id, triggerKey: key }).lean()
    if (!existing) {
        const count = await AutoReactionRule.countDocuments({ guildId: id })
        if (count >= MAX_REACTIONS) throw new Error(`This server already has the maximum of ${MAX_REACTIONS} auto-reaction rules`)
    }

    const doc = await AutoReactionRule.findOneAndUpdate(
        { guildId: id, triggerKey: key },
        {
            $set: {
                trigger: cleanTrigger,
                emojis: cleanEmojis,
                mode: normalizeMode(mode),
                enabled: true,
                createdBy: createdBy ? String(createdBy) : null,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    invalidateGuild(id)
    return doc
}

async function removeReactionRule(guildId, trigger) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await AutoReactionRule.deleteOne({ guildId: String(guildId), triggerKey: triggerKey(trigger) })
    invalidateGuild(guildId)
    return result.deletedCount > 0
}

async function clearReactionRules(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await AutoReactionRule.deleteMany({ guildId: String(guildId) })
    invalidateGuild(guildId)
    return result.deletedCount || 0
}

function matchesRule(content, rule) {
    const normalized = String(content || "").replace(/\s+/g, " ").trim().toLowerCase()
    const trigger = triggerKey(rule?.trigger)
    if (!normalized || !trigger) return false
    return rule.mode === "contains" ? normalized.includes(trigger) : normalized === trigger
}

module.exports = {
    MATCH_MODES,
    MAX_RESPONDERS,
    MAX_REACTIONS,
    MAX_EMOJIS,
    AutoResponderRule,
    AutoReactionRule,
    isMongoConnected,
    normalizeTrigger,
    normalizeMode,
    normalizeResponse,
    normalizeEmojis,
    matchesRule,
    getResponderRules,
    getReactionRules,
    listResponderRules,
    listReactionRules,
    upsertResponderRule,
    removeResponderRule,
    clearResponderRules,
    upsertReactionRule,
    removeReactionRule,
    clearReactionRules,
    invalidateGuild,
}
