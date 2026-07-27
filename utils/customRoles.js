const mongoose = require("mongoose")
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")
const {
    BASE_ROLE_COMMANDS,
    normalizeConfig,
    normalizeCommandName,
    validateConfigPayload,
    hasDangerousRolePermissions,
} = require("./customRolePolicy")

const CACHE_TTL_MS = 5_000
const AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60
const configCache = new Map()

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const commandSchema = new mongoose.Schema({
    name: { type: String, required: true, lowercase: true, trim: true },
    roleId: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    base: { type: Boolean, default: false },
}, { _id: false })

const customRoleConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    requiredRoleId: { type: String, default: null },
    baseCommands: { type: [commandSchema], default: [] },
    customCommands: { type: [commandSchema], default: [] },
    updatedBy: { type: String, default: null },
}, {
    collection: "customRoleConfigs",
    timestamps: true,
    minimize: false,
})

const customRoleAuditSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    actorId: { type: String, required: true },
    targetId: { type: String, default: null },
    roleId: { type: String, default: null },
    commandName: { type: String, default: null },
    action: { type: String, enum: ["add", "remove", "configure", "deny"], required: true },
    success: { type: Boolean, default: true },
    reason: { type: String, default: null },
    source: { type: String, enum: ["discord", "dashboard"], default: "discord" },
    createdAt: { type: Date, default: Date.now, index: true },
}, {
    collection: "customRoleAudits",
    minimize: false,
})
customRoleAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_TTL_SECONDS })

const CustomRoleConfig = getModel("CustomRoleConfig", customRoleConfigSchema)
const CustomRoleAudit = getModel("CustomRoleAudit", customRoleAuditSchema)

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function defaultConfig(guildId) {
    return normalizeConfig({
        guildId,
        enabled: false,
        requiredRoleId: null,
        baseCommands: BASE_ROLE_COMMANDS.map(item => ({ name: item.name, roleId: null, enabled: true, base: true })),
        customCommands: [],
    })
}

function cacheConfig(guildId, config) {
    const normalized = normalizeConfig({ ...config, guildId })
    configCache.set(String(guildId), { config: normalized, expiresAt: Date.now() + CACHE_TTL_MS })
    return normalized
}

function clearCustomRoleCache(guildId) {
    if (guildId) configCache.delete(String(guildId))
    else configCache.clear()
}

async function getCustomRoleConfig(guildId, options = {}) {
    const id = String(guildId || "")
    if (!id) throw new Error("guildId is required")
    const cached = configCache.get(id)
    if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.config
    if (!isMongoConnected()) return cached?.config || defaultConfig(id)

    const doc = await CustomRoleConfig.findOne({ guildId: id }).lean()
    return cacheConfig(id, doc || defaultConfig(id))
}

async function saveCustomRoleConfig(guildId, rawConfig, options = {}) {
    const id = String(guildId || "")
    if (!id) throw new Error("guildId is required")
    if (!isMongoConnected()) {
        const error = new Error("MongoDB is unavailable")
        error.code = "MONGO_UNAVAILABLE"
        throw error
    }
    const normalized = normalizeConfig({ ...rawConfig, guildId: id })
    const doc = await CustomRoleConfig.findOneAndUpdate(
        { guildId: id },
        {
            $set: {
                enabled: normalized.enabled,
                requiredRoleId: normalized.requiredRoleId,
                baseCommands: normalized.baseCommands,
                customCommands: normalized.customCommands,
                updatedBy: options.actorId ? String(options.actorId) : null,
            },
            $setOnInsert: { guildId: id },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(id, doc)
}

function getReservedCommandNames() {
    const names = new Set(["reqrole", "rolecmd", "rolecommands"])
    try {
        const { getControlCommands } = require("./dashboardControl")
        for (const command of getControlCommands()) {
            names.add(normalizeCommandName(command.name))
            for (const alias of command.aliases || []) names.add(normalizeCommandName(alias))
        }
    } catch {}
    return names
}

function roleUnavailableReason(role, guild, botMember) {
    if (!role || !guild) return "Role is unavailable."
    if (role.id === guild.id) return "The @everyone role cannot be used."
    if (role.managed) return "This role is managed by Discord or an integration."
    if (!botMember) return "CURSED is not available as a guild member."
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return "CURSED needs the Manage Roles permission."
    if (role.position >= botMember.roles.highest.position) return "Move the CURSED role above this role in Discord."
    if (hasDangerousRolePermissions(role.permissions.bitfield)) return "Administrator and Manage Roles roles are blocked."
    return null
}

function buildRoleCatalog(guild) {
    const botMember = guild?.members?.me || null
    return [...(guild?.roles?.cache?.values?.() || [])]
        .sort((a, b) => b.position - a.position)
        .map(role => {
            const everyone = role.id === guild.id
            const dangerous = hasDangerousRolePermissions(role.permissions.bitfield)
            const unavailableReason = roleUnavailableReason(role, guild, botMember)
            return {
                id: role.id,
                name: role.name,
                color: role.color,
                position: role.position,
                permissions: String(role.permissions.bitfield),
                managed: role.managed,
                everyone,
                dangerous,
                assignable: unavailableReason === null,
                requiredEligible: !everyone && !role.managed,
                unavailableReason,
            }
        })
}

function validateConfigForGuild(guild, payload) {
    return validateConfigPayload(payload, {
        roleCatalog: buildRoleCatalog(guild),
        reservedNames: getReservedCommandNames(),
    })
}

async function recordCustomRoleAudit(entry) {
    if (!isMongoConnected()) return null
    try {
        return await CustomRoleAudit.create({
            guildId: String(entry.guildId),
            actorId: String(entry.actorId),
            targetId: entry.targetId ? String(entry.targetId) : null,
            roleId: entry.roleId ? String(entry.roleId) : null,
            commandName: entry.commandName ? normalizeCommandName(entry.commandName) : null,
            action: entry.action,
            success: entry.success !== false,
            reason: entry.reason ? String(entry.reason).slice(0, 500) : null,
            source: entry.source === "dashboard" ? "dashboard" : "discord",
        })
    } catch (error) {
        console.error(`[CustomRoles] audit save failed: ${error.message}`)
        return null
    }
}

async function listCustomRoleAudits(guildId, limit = 25) {
    if (!isMongoConnected()) return []
    return CustomRoleAudit.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(100, Number(limit) || 25)))
        .lean()
}

async function sendCustomRoleLog(guild, entry) {
    try {
        const channelId = getServerConfig(guild.id).config.modLogChannelId
        if (!channelId) return false
        const channel = guild.channels.cache.get(channelId)
        if (!channel?.isTextBased?.()) return false
        const added = entry.action === "add"
        const embed = new EmbedBuilder()
            .setColor(added ? 0x2ECC71 : 0xE67E22)
            .setTitle(added ? "✅ Custom Role Added" : "➖ Custom Role Removed")
            .addFields(
                { name: "Command", value: `\`${entry.commandName}\``, inline: true },
                { name: "Role", value: `<@&${entry.roleId}>`, inline: true },
                { name: "Target", value: `<@${entry.targetId}>`, inline: true },
                { name: "Used by", value: `<@${entry.actorId}>`, inline: true },
            )
            .setTimestamp()
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        return true
    } catch (error) {
        console.error(`[CustomRoles] log send failed: ${error.message}`)
        return false
    }
}

async function saveValidatedConfig(guild, payload, options = {}) {
    const validation = validateConfigForGuild(guild, payload)
    if (!validation.ok) {
        const error = new Error("Custom role configuration is invalid")
        error.code = "VALIDATION_ERROR"
        error.fieldErrors = validation.errors
        throw error
    }
    const saved = await saveCustomRoleConfig(guild.id, validation.config, options)
    await recordCustomRoleAudit({
        guildId: guild.id,
        actorId: options.actorId || guild.ownerId,
        action: "configure",
        success: true,
        reason: options.reason || "Custom role configuration updated",
        source: options.source || "dashboard",
    })
    return saved
}

module.exports = {
    CustomRoleConfig,
    CustomRoleAudit,
    defaultConfig,
    getCustomRoleConfig,
    saveCustomRoleConfig,
    saveValidatedConfig,
    clearCustomRoleCache,
    getReservedCommandNames,
    roleUnavailableReason,
    buildRoleCatalog,
    validateConfigForGuild,
    recordCustomRoleAudit,
    listCustomRoleAudits,
    sendCustomRoleLog,
}
