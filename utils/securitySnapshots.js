const crypto = require("crypto")
const mongoose = require("mongoose")
const { ChannelType, PermissionsBitField } = require("discord.js")
const { getSecurityPhase3Config } = require("./securityPhase3Config")
const { getFortressConfig } = require("./fortressConfig")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const snapshotSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true },
    reason: { type: String, default: "Security snapshot", maxlength: 500 },
    createdById: { type: String, default: null },
    createdByTag: { type: String, default: "System", maxlength: 256 },
    guildSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    roles: { type: [mongoose.Schema.Types.Mixed], default: [] },
    channels: { type: [mongoose.Schema.Types.Mixed], default: [] },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: "securityGuildSnapshots", timestamps: true, minimize: false })

snapshotSchema.index({ guildId: 1, snapshotId: 1 }, { unique: true })
snapshotSchema.index({ guildId: 1, createdAt: -1 })

const SecurityGuildSnapshot = getModel("SecurityGuildSnapshot", snapshotSchema)
const lastAutomaticCapture = new Map()
let schedulerStarted = false

function mongoReady() {
    return mongoose.connection.readyState === 1
}

function serializeOverwrite(overwrite) {
    return {
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
    }
}

function serializeRole(role) {
    return {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions.bitfield.toString(),
        position: role.position,
        unicodeEmoji: role.unicodeEmoji || null,
        icon: role.iconURL?.({ extension: "png", size: 256 }) || null,
    }
}

function serializeChannel(channel) {
    const data = {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.rawPosition ?? channel.position ?? 0,
        parentId: channel.parentId || null,
        permissionOverwrites: channel.permissionOverwrites
            ? [...channel.permissionOverwrites.cache.values()].map(serializeOverwrite)
            : [],
    }

    if ("topic" in channel) data.topic = channel.topic || null
    if ("nsfw" in channel) data.nsfw = Boolean(channel.nsfw)
    if ("rateLimitPerUser" in channel) data.rateLimitPerUser = channel.rateLimitPerUser || 0
    if ("bitrate" in channel) data.bitrate = channel.bitrate || null
    if ("userLimit" in channel) data.userLimit = channel.userLimit || 0
    if ("rtcRegion" in channel) data.rtcRegion = channel.rtcRegion || null
    if ("videoQualityMode" in channel) data.videoQualityMode = channel.videoQualityMode || null
    if ("defaultAutoArchiveDuration" in channel) data.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration || null
    if ("defaultThreadRateLimitPerUser" in channel) data.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser || 0
    if ("availableTags" in channel) data.availableTags = Array.isArray(channel.availableTags) ? channel.availableTags : []
    if ("defaultReactionEmoji" in channel) data.defaultReactionEmoji = channel.defaultReactionEmoji || null
    if ("defaultSortOrder" in channel) data.defaultSortOrder = channel.defaultSortOrder ?? null
    if ("defaultForumLayout" in channel) data.defaultForumLayout = channel.defaultForumLayout ?? null
    return data
}

function snapshotGuildSettings(guild) {
    return {
        name: guild.name,
        description: guild.description || null,
        verificationLevel: Number(guild.verificationLevel),
        explicitContentFilter: Number(guild.explicitContentFilter),
        defaultMessageNotifications: Number(guild.defaultMessageNotifications),
        afkTimeout: guild.afkTimeout,
        afkChannelId: guild.afkChannelId || null,
        systemChannelId: guild.systemChannelId || null,
        rulesChannelId: guild.rulesChannelId || null,
        publicUpdatesChannelId: guild.publicUpdatesChannelId || null,
        preferredLocale: guild.preferredLocale || null,
    }
}

function snapshotStats(guild, roles, channels) {
    return {
        roleCount: roles.length,
        channelCount: channels.length,
        memberCount: guild.memberCount || 0,
    }
}

async function pruneSnapshots(guildId, maxSnapshots) {
    const keep = Math.max(2, Math.min(25, Number(maxSnapshots) || 10))
    const stale = await SecurityGuildSnapshot.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .skip(keep)
        .select({ _id: 1 })
        .lean()
    if (stale.length) {
        await SecurityGuildSnapshot.deleteMany({ _id: { $in: stale.map(item => item._id) } })
    }
}

async function captureGuildSnapshot(guild, { reason = "Security snapshot", actor = null, maxSnapshots = null } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so a durable snapshot could not be created." }
    if (!guild) return { ok: false, error: "Guild is unavailable." }

    const roles = [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => a.position - b.position)
        .map(serializeRole)

    const channels = [...guild.channels.cache.values()]
        .filter(channel => !channel.isThread?.())
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map(serializeChannel)

    const doc = await SecurityGuildSnapshot.create({
        guildId: guild.id,
        snapshotId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        reason: String(reason).slice(0, 500),
        createdById: actor?.id ? String(actor.id) : null,
        createdByTag: String(actor?.tag || actor?.username || "System").slice(0, 256),
        guildSettings: snapshotGuildSettings(guild),
        roles,
        channels,
        stats: snapshotStats(guild, roles, channels),
    })

    const fortress = getFortressConfig(guild.id)
    await pruneSnapshots(guild.id, maxSnapshots || fortress.backups.maxSnapshots)
    return { ok: true, snapshot: doc.toObject() }
}

async function listGuildSnapshots(guildId, limit = 10) {
    if (!mongoReady()) return []
    return SecurityGuildSnapshot.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(25, Number(limit) || 10)))
        .lean()
}

async function getGuildSnapshot(guildId, snapshotId) {
    if (!mongoReady()) return null
    return SecurityGuildSnapshot.findOne({ guildId: String(guildId), snapshotId: String(snapshotId) }).lean()
}

function deserializeOverwrites(overwrites, roleIdMap, channelIdMap) {
    return (overwrites || []).map(item => ({
        id: roleIdMap.get(item.id) || channelIdMap.get(item.id) || item.id,
        type: item.type,
        allow: new PermissionsBitField(BigInt(item.allow || "0")),
        deny: new PermissionsBitField(BigInt(item.deny || "0")),
    }))
}

function supportedChannelType(type) {
    return [
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildCategory,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
    ].includes(type)
}

async function restoreGuildSettings(guild, settings, reason, warnings) {
    if (!settings || typeof settings !== "object") return
    const edits = {}
    if (Number.isFinite(settings.verificationLevel)) edits.verificationLevel = settings.verificationLevel
    if (Number.isFinite(settings.explicitContentFilter)) edits.explicitContentFilter = settings.explicitContentFilter
    if (Number.isFinite(settings.defaultMessageNotifications)) edits.defaultMessageNotifications = settings.defaultMessageNotifications
    if (Number.isFinite(settings.afkTimeout)) edits.afkTimeout = settings.afkTimeout
    if (settings.description !== undefined) edits.description = settings.description
    if (settings.preferredLocale) edits.preferredLocale = settings.preferredLocale
    try {
        if (Object.keys(edits).length) await guild.edit(edits, reason)
    } catch (err) {
        warnings.push(`Guild settings: ${err.message}`)
    }
}

async function restoreGuildSnapshot(guild, snapshotId, { reason = "Security snapshot restore", actor = null } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so snapshot restore cannot run safely." }
    if (!guild) return { ok: false, error: "Guild is unavailable." }
    const snapshot = await getGuildSnapshot(guild.id, snapshotId)
    if (!snapshot) return { ok: false, error: "Snapshot not found for this server." }

    const auditReason = `${String(reason).slice(0, 400)} • ${actor?.tag || actor?.username || "System"}`.slice(0, 512)
    const warnings = []
    const roleIdMap = new Map()
    const channelIdMap = new Map()
    let rolesCreated = 0
    let channelsCreated = 0

    for (const saved of [...(snapshot.roles || [])].sort((a, b) => a.position - b.position)) {
        if (guild.roles.cache.has(saved.id)) {
            roleIdMap.set(saved.id, saved.id)
            continue
        }
        try {
            const role = await guild.roles.create({
                name: saved.name,
                color: saved.color || 0,
                hoist: Boolean(saved.hoist),
                mentionable: Boolean(saved.mentionable),
                permissions: new PermissionsBitField(BigInt(saved.permissions || "0")),
                reason: auditReason,
            })
            roleIdMap.set(saved.id, role.id)
            rolesCreated += 1
            await role.setPosition(Math.min(saved.position || 1, guild.roles.cache.size - 1), { reason: auditReason }).catch(() => {})
        } catch (err) {
            warnings.push(`Role ${saved.name}: ${err.message}`)
        }
    }

    const savedChannels = (snapshot.channels || []).filter(item => supportedChannelType(item.type))
    const ordered = [
        ...savedChannels.filter(item => item.type === ChannelType.GuildCategory),
        ...savedChannels.filter(item => item.type !== ChannelType.GuildCategory),
    ]

    for (const saved of ordered) {
        if (guild.channels.cache.has(saved.id)) {
            channelIdMap.set(saved.id, saved.id)
            continue
        }
        try {
            const options = {
                name: saved.name,
                type: saved.type,
                reason: auditReason,
                permissionOverwrites: deserializeOverwrites(saved.permissionOverwrites, roleIdMap, channelIdMap),
            }
            const parentId = saved.parentId ? (channelIdMap.get(saved.parentId) || saved.parentId) : null
            if (parentId && guild.channels.cache.has(parentId)) options.parent = parentId
            if (saved.topic !== undefined && saved.type !== ChannelType.GuildCategory) options.topic = saved.topic
            if (saved.nsfw !== undefined) options.nsfw = saved.nsfw
            if (saved.rateLimitPerUser !== undefined) options.rateLimitPerUser = saved.rateLimitPerUser
            if (saved.bitrate) options.bitrate = saved.bitrate
            if (saved.userLimit !== undefined) options.userLimit = saved.userLimit
            if (saved.rtcRegion !== undefined) options.rtcRegion = saved.rtcRegion
            if (saved.videoQualityMode) options.videoQualityMode = saved.videoQualityMode
            if (saved.defaultAutoArchiveDuration) options.defaultAutoArchiveDuration = saved.defaultAutoArchiveDuration
            if (saved.defaultThreadRateLimitPerUser !== undefined) options.defaultThreadRateLimitPerUser = saved.defaultThreadRateLimitPerUser
            if (Array.isArray(saved.availableTags)) options.availableTags = saved.availableTags
            if (saved.defaultReactionEmoji) options.defaultReactionEmoji = saved.defaultReactionEmoji
            if (saved.defaultSortOrder !== undefined) options.defaultSortOrder = saved.defaultSortOrder
            if (saved.defaultForumLayout !== undefined) options.defaultForumLayout = saved.defaultForumLayout

            const channel = await guild.channels.create(options)
            channelIdMap.set(saved.id, channel.id)
            channelsCreated += 1
            await channel.setPosition(saved.position || 0, { reason: auditReason }).catch(() => {})
        } catch (err) {
            warnings.push(`Channel ${saved.name}: ${err.message}`)
        }
    }

    await restoreGuildSettings(guild, snapshot.guildSettings, auditReason, warnings)

    return {
        ok: true,
        snapshot,
        rolesCreated,
        channelsCreated,
        warnings,
        limitations: [
            "Discord does not allow restoration of deleted message history.",
            "Member role assignments can only be restored when separate role-assignment evidence exists.",
            "Integration-managed roles, webhooks, invites, and third-party app state are not recreated by a structural snapshot.",
        ],
    }
}

function startSnapshotScheduler(client) {
    if (schedulerStarted || !client) return
    schedulerStarted = true
    const interval = setInterval(async () => {
        if (!mongoReady() || !client.isReady?.()) return
        for (const guild of client.guilds.cache.values()) {
            try {
                const security = getSecurityPhase3Config(guild.id)
                const fortress = getFortressConfig(guild.id)
                if (!security.enabled || !fortress.enabled || !fortress.backups.enabled) continue
                const intervalMs = fortress.backups.intervalMinutes * 60_000
                const last = lastAutomaticCapture.get(guild.id) || 0
                if (Date.now() - last < intervalMs) continue
                const latest = await SecurityGuildSnapshot.findOne({ guildId: guild.id }).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean()
                if (latest?.createdAt && Date.now() - new Date(latest.createdAt).getTime() < intervalMs) {
                    lastAutomaticCapture.set(guild.id, new Date(latest.createdAt).getTime())
                    continue
                }
                const result = await captureGuildSnapshot(guild, {
                    reason: "Automatic Fortress snapshot",
                    actor: { id: client.user.id, tag: "CURSED Fortress" },
                    maxSnapshots: fortress.backups.maxSnapshots,
                })
                if (result.ok) lastAutomaticCapture.set(guild.id, Date.now())
            } catch (err) {
                console.error(`[FortressSnapshots:${guild.id}]`, err.message)
            }
        }
    }, 15 * 60_000)
    interval.unref?.()
}

module.exports = {
    SecurityGuildSnapshot,
    captureGuildSnapshot,
    listGuildSnapshots,
    getGuildSnapshot,
    restoreGuildSnapshot,
    startSnapshotScheduler,
    serializeRole,
    serializeChannel,
}
