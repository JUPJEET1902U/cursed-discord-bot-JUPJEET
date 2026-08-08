const mongoose = require("mongoose")
const logger = require("./logger")

const log = logger.child("CustomCommands")
const MAX_CUSTOM_COMMANDS = 50
const CACHE_TTL_MS = 30_000
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const customCommandSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, lowercase: true, trim: true },
    response: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
}, { collection: "customCommands", timestamps: true })
customCommandSchema.index({ guildId: 1, name: 1 }, { unique: true })

const CustomCommand = getModel("CustomCommand", customCommandSchema)
const cache = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function normalizeName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^[!/]+/, "")
        .slice(0, 32)
}

function validateName(value) {
    const name = normalizeName(value)
    if (!NAME_PATTERN.test(name)) return { ok: false, error: "Use 1-32 lowercase letters, numbers, or hyphens" }
    return { ok: true, name }
}

function normalizeResponse(value) {
    return String(value || "").trim().slice(0, 1800)
}

function invalidate(guildId) {
    cache.delete(String(guildId))
}

async function listCustomCommands(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return CustomCommand.find({ guildId: String(guildId) }).sort({ name: 1 }).lean()
}

async function getCommandMap(guildId) {
    const id = String(guildId)
    const cached = cache.get(id)
    if (cached && cached.expiresAt > Date.now()) return cached.commands
    if (!isMongoConnected()) return new Map()
    try {
        const docs = await CustomCommand.find({ guildId: id, enabled: true }).lean()
        const commands = new Map(docs.map(doc => [doc.name, doc]))
        cache.set(id, { commands, expiresAt: Date.now() + CACHE_TTL_MS })
        return commands
    } catch (error) {
        log.warn(`Custom command load failed for ${id}: ${error.message}`)
        return new Map()
    }
}

async function getCustomCommand(guildId, name) {
    const commands = await getCommandMap(guildId)
    return commands.get(normalizeName(name)) || null
}

async function upsertCustomCommand(guildId, { name, response, createdBy = null }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const check = validateName(name)
    if (!check.ok) throw new Error(check.error)
    const cleanResponse = normalizeResponse(response)
    if (!cleanResponse) throw new Error("Response is required")
    const id = String(guildId)
    const existing = await CustomCommand.findOne({ guildId: id, name: check.name }).lean()
    if (!existing) {
        const count = await CustomCommand.countDocuments({ guildId: id })
        if (count >= MAX_CUSTOM_COMMANDS) throw new Error(`This server already has the maximum of ${MAX_CUSTOM_COMMANDS} custom commands`)
    }
    const saved = await CustomCommand.findOneAndUpdate(
        { guildId: id, name: check.name },
        { $set: { response: cleanResponse, enabled: true, createdBy: createdBy ? String(createdBy) : null } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    invalidate(id)
    return saved
}

async function removeCustomCommand(guildId, name) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await CustomCommand.deleteOne({ guildId: String(guildId), name: normalizeName(name) })
    invalidate(guildId)
    return result.deletedCount > 0
}

async function clearCustomCommands(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const result = await CustomCommand.deleteMany({ guildId: String(guildId) })
    invalidate(guildId)
    return result.deletedCount || 0
}

function renderCustomResponse(template, message) {
    const memberName = message.member?.displayName || message.author?.username || "Member"
    return String(template || "")
        .replace(/\{user\}/gi, memberName)
        .replace(/\{server\}/gi, message.guild?.name || "Server")
        .replace(/\{channel\}/gi, message.channel?.name ? `#${message.channel.name}` : "this channel")
        .slice(0, 1800)
}

module.exports = {
    MAX_CUSTOM_COMMANDS,
    NAME_PATTERN,
    CustomCommand,
    normalizeName,
    validateName,
    normalizeResponse,
    listCustomCommands,
    getCustomCommand,
    upsertCustomCommand,
    removeCustomCommand,
    clearCustomCommands,
    renderCustomResponse,
    invalidate,
}
