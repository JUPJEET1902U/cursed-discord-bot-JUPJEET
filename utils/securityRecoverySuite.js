const mongoose = require("mongoose")
const {
    ChannelType,
    PermissionFlagsBits,
} = require("discord.js")
const { createSecurityIncident, SecurityIncident } = require("./securityIncidents")
const { enableEmergencyLockdown, disableEmergencyLockdown } = require("./lockdownState")
const { quarantineMember } = require("./quarantineState")
const { notifyOwner } = require("./securityResponse")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const snapshotSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 120 },
    reason: { type: String, default: "Scheduled security snapshot", maxlength: 500 },
    createdById: { type: String, default: null },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["ready", "restored", "failed"], default: "ready", index: true },
    restoredAt: { type: Date, default: null },
    restoredById: { type: String, default: null },
    restoreSummary: { type: mongoose.Schema.Types.Mixed, default: null },
}, { collection: "securitySnapshots", timestamps: true, minimize: false })
snapshotSchema.index({ guildId: 1, createdAt: -1 })

const botApprovalSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    botId: { type: String, required: true, index: true },
    approvedById: { type: String, required: true },
    note: { type: String, default: null, maxlength: 500 },
    expiresAt: { type: Date, required: true, index: true },
    active: { type: Boolean, default: true, index: true },
    usedAt: { type: Date, default: null },
    usedByInviterId: { type: String, default: null },
}, { collection: "securityBotApprovals", timestamps: true })
botApprovalSchema.index({ guildId: 1, botId: 1, active: 1 })

const incidentModeSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false, index: true },
    reason: { type: String, default: null, maxlength: 1000 },
    activatedById: { type: String, default: null },
    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    lockdownStartedByMode: { type: Boolean, default: false },
    endedAt: { type: Date, default: null },
    endedById: { type: String, default: null },
}, { collection: "securityIncidentModes", timestamps: true })

const SecuritySnapshot = getModel("SecuritySnapshot", snapshotSchema)
const SecurityBotApproval = getModel("SecurityBotApproval", botApprovalSchema)
const SecurityIncidentMode = getModel("SecurityIncidentMode", incidentModeSchema)

const suiteJoinWindows = new Map()
let schedulerStarted = false
let listenersAttached = false

function mongoReady() {
    return mongoose.connection.readyState === 1
}

function safeText(value, fallback = "") {
    return String(value ?? fallback).slice(0, 1000)
}

function serializeOverwrite(overwrite) {
    return {
        id: String(overwrite.id),
        type: Number(overwrite.type),
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
    }
}

function serializeGuild(guild) {
    const roles = [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => a.position - b.position)
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions.bitfield.toString(),
            mentionable: role.mentionable,
            position: role.position,
            unicodeEmoji: role.unicodeEmoji || null,
        }))

    const channels = [...guild.channels.cache.values()]
        .filter(channel => !channel.isThread?.())
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId || null,
            position: channel.rawPosition,
            topic: channel.topic || null,
            nsfw: channel.nsfw === true,
            rateLimitPerUser: Number(channel.rateLimitPerUser || 0),
            bitrate: channel.bitrate || null,
            userLimit: channel.userLimit || null,
            permissionOverwrites: channel.permissionOverwrites?.cache
                ? [...channel.permissionOverwrites.cache.values()].map(serializeOverwrite)
                : [],
        }))

    return {
        version: 1,
        capturedAt: new Date().toISOString(),
        guild: {
            id: guild.id,
            name: guild.name,
            verificationLevel: Number(guild.verificationLevel),
            explicitContentFilter: Number(guild.explicitContentFilter),
            defaultMessageNotifications: Number(guild.defaultMessageNotifications),
            afkTimeout: guild.afkTimeout,
        },
        roles,
        channels,
    }
}

async function pruneSnapshots(guildId, retentionCount) {
    if (!mongoReady()) return
    const keep = Math.max(1, Math.min(30, Number(retentionCount) || 7))
    const stale = await SecuritySnapshot.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .skip(keep)
        .select({ _id: 1 })
        .lean()
    if (stale.length) await SecuritySnapshot.deleteMany({ _id: { $in: stale.map(item => item._id) } })
}

async function createSecuritySnapshot(guild, { reason, actor, retentionCount = 7, name = null } = {}) {
    if (!guild) return { ok: false, error: "Guild unavailable." }
    if (!mongoReady()) return { ok: false, error: "MongoDB is required for persistent security snapshots." }
    const snapshot = serializeGuild(guild)
    const created = await SecuritySnapshot.create({
        guildId: guild.id,
        name: safeText(name || `${guild.name} • ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`, "Security snapshot").slice(0, 120),
        reason: safeText(reason, "Security snapshot"),
        createdById: actor?.id ? String(actor.id) : null,
        snapshot,
    })
    await pruneSnapshots(guild.id, retentionCount)
    return { ok: true, snapshot: summarizeSnapshot(created.toObject()) }
}

function summarizeSnapshot(doc) {
    return {
        id: String(doc._id),
        name: doc.name,
        reason: doc.reason,
        status: doc.status,
        roleCount: doc.snapshot?.roles?.length || 0,
        channelCount: doc.snapshot?.channels?.length || 0,
        createdById: doc.createdById || null,
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        restoredAt: doc.restoredAt ? new Date(doc.restoredAt).toISOString() : null,
    }
}

async function listSecuritySnapshots(guildId, limit = 10) {
    if (!mongoReady()) return []
    const docs = await SecuritySnapshot.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(30, Number(limit) || 10)))
        .lean()
    return docs.map(summarizeSnapshot)
}

function mappedOverwrites(guild, overwrites, roleMap) {
    return (Array.isArray(overwrites) ? overwrites : []).flatMap(overwrite => {
        let id = String(overwrite.id || "")
        if (id === guild.id) id = guild.id
        else if (Number(overwrite.type) === 0) id = roleMap.get(id) || id
        const valid = id === guild.id
            || (Number(overwrite.type) === 0 ? guild.roles.cache.has(id) || [...roleMap.values()].includes(id) : guild.members.cache.has(id))
        if (!valid) return []
        return [{ id, type: Number(overwrite.type), allow: BigInt(overwrite.allow || "0"), deny: BigInt(overwrite.deny || "0") }]
    })
}

function channelOptions(guild, saved, parentId, roleMap, reason) {
    const options = {
        name: saved.name,
        type: saved.type,
        parent: parentId || undefined,
        permissionOverwrites: mappedOverwrites(guild, saved.permissionOverwrites, roleMap),
        reason,
    }
    const textLike = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(saved.type)
    if (textLike) {
        options.topic = saved.topic || undefined
        options.nsfw = saved.nsfw === true
    }
    if ([ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildMedia].includes(saved.type)) options.rateLimitPerUser = saved.rateLimitPerUser || 0
    if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(saved.type)) {
        options.bitrate = saved.bitrate || undefined
        options.userLimit = saved.userLimit || undefined
    }
    return options
}

async function restoreSecuritySnapshot(guild, snapshotId, { reason, actor, restoreServerSettings = true } = {}) {
    if (!guild) return { ok: false, error: "Guild unavailable." }
    if (!mongoReady() || !mongoose.isValidObjectId(snapshotId)) return { ok: false, error: "Snapshot unavailable." }
    const doc = await SecuritySnapshot.findOne({ _id: snapshotId, guildId: guild.id })
    if (!doc) return { ok: false, error: "Snapshot not found for this server." }

    const snapshot = doc.snapshot || {}
    const result = { ok: true, rolesCreated: 0, channelsCreated: 0, rolesMatched: 0, channelsMatched: 0, settingsRestored: false, errors: [] }
    const roleMap = new Map()
    const channelMap = new Map()
    const reasonText = safeText(reason, "CURSED security recovery")

    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        for (const saved of Array.isArray(snapshot.roles) ? snapshot.roles : []) {
            const existing = guild.roles.cache.get(saved.id)
                || [...guild.roles.cache.values()].find(role => !role.managed && role.name === saved.name)
            if (existing) {
                roleMap.set(saved.id, existing.id)
                result.rolesMatched += 1
                continue
            }
            try {
                const created = await guild.roles.create({
                    name: saved.name,
                    color: saved.color,
                    hoist: saved.hoist === true,
                    permissions: BigInt(saved.permissions || "0"),
                    mentionable: saved.mentionable === true,
                    unicodeEmoji: saved.unicodeEmoji || undefined,
                    reason: reasonText,
                })
                const highest = Math.max(1, guild.members.me.roles.highest.position - 1)
                if (Number.isInteger(saved.position)) await created.setPosition(Math.min(saved.position, highest)).catch(() => {})
                roleMap.set(saved.id, created.id)
                result.rolesCreated += 1
            } catch (err) {
                result.errors.push(`Role ${saved.name}: ${err.message}`)
            }
        }
    } else {
        result.errors.push("Manage Roles permission is missing.")
    }

    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        const savedChannels = Array.isArray(snapshot.channels) ? snapshot.channels : []
        const ordered = [
            ...savedChannels.filter(channel => channel.type === ChannelType.GuildCategory),
            ...savedChannels.filter(channel => channel.type !== ChannelType.GuildCategory),
        ]
        for (const saved of ordered) {
            const existing = guild.channels.cache.get(saved.id)
                || [...guild.channels.cache.values()].find(channel => channel.type === saved.type && channel.name === saved.name)
            if (existing) {
                channelMap.set(saved.id, existing.id)
                result.channelsMatched += 1
                continue
            }
            const parentId = saved.parentId ? channelMap.get(saved.parentId) || (guild.channels.cache.has(saved.parentId) ? saved.parentId : null) : null
            try {
                const created = await guild.channels.create(channelOptions(guild, saved, parentId, roleMap, reasonText))
                if (Number.isInteger(saved.position)) await created.setPosition(saved.position).catch(() => {})
                channelMap.set(saved.id, created.id)
                result.channelsCreated += 1
            } catch (err) {
                result.errors.push(`Channel ${saved.name}: ${err.message}`)
            }
        }
    } else {
        result.errors.push("Manage Channels permission is missing.")
    }

    if (restoreServerSettings && guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) && snapshot.guild) {
        try {
            await guild.edit({
                verificationLevel: snapshot.guild.verificationLevel,
                explicitContentFilter: snapshot.guild.explicitContentFilter,
                defaultMessageNotifications: snapshot.guild.defaultMessageNotifications,
                afkTimeout: snapshot.guild.afkTimeout,
                reason: reasonText,
            })
            result.settingsRestored = true
        } catch (err) {
            result.errors.push(`Server settings: ${err.message}`)
        }
    }

    result.ok = result.rolesCreated > 0 || result.channelsCreated > 0 || result.settingsRestored || result.errors.length === 0
    doc.status = result.ok ? "restored" : "failed"
    doc.restoredAt = new Date()
    doc.restoredById = actor?.id ? String(actor.id) : null
    doc.restoreSummary = result
    await doc.save()

    await createSecurityIncident({
        guildId: guild.id,
        type: "SECURITY_SNAPSHOT_RESTORE",
        severity: result.errors.length ? "high" : "medium",
        executorId: actor?.id || null,
        executorTag: actor?.tag || "Security manager",
        targetId: String(doc._id),
        targetTag: doc.name,
        actionTaken: result.ok ? "restore" : "restore failed",
        details: { summary: `Security snapshot restoration completed with ${result.rolesCreated} role(s) and ${result.channelsCreated} channel(s) recreated.`, ...result },
    })
    return { ...result, snapshot: summarizeSnapshot(doc.toObject()) }
}

async function approveBot(guildId, botId, { actor, expiresMinutes = 15, note = null } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is required for bot approvals." }
    if (!/^\d{17,20}$/.test(String(botId || ""))) return { ok: false, error: "Enter a valid bot ID." }
    const minutes = Math.max(1, Math.min(1440, Number(expiresMinutes) || 15))
    await SecurityBotApproval.updateMany({ guildId: String(guildId), botId: String(botId), active: true }, { $set: { active: false } })
    const doc = await SecurityBotApproval.create({
        guildId: String(guildId),
        botId: String(botId),
        approvedById: String(actor?.id || "unknown"),
        note: note ? safeText(note).slice(0, 500) : null,
        expiresAt: new Date(Date.now() + minutes * 60_000),
    })
    return { ok: true, approval: serializeApproval(doc.toObject()) }
}

function serializeApproval(doc) {
    return {
        id: String(doc._id),
        botId: doc.botId,
        approvedById: doc.approvedById,
        note: doc.note || null,
        active: doc.active === true && new Date(doc.expiresAt).getTime() > Date.now(),
        expiresAt: new Date(doc.expiresAt).toISOString(),
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        usedAt: doc.usedAt ? new Date(doc.usedAt).toISOString() : null,
        usedByInviterId: doc.usedByInviterId || null,
    }
}

async function listBotApprovals(guildId, limit = 25) {
    if (!mongoReady()) return []
    await SecurityBotApproval.updateMany({ guildId: String(guildId), active: true, expiresAt: { $lte: new Date() } }, { $set: { active: false } })
    const docs = await SecurityBotApproval.find({ guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(100, Number(limit) || 25)))
        .lean()
    return docs.map(serializeApproval)
}

async function revokeBotApproval(guildId, approvalId) {
    if (!mongoReady() || !mongoose.isValidObjectId(approvalId)) return { ok: false, error: "Approval not found." }
    const doc = await SecurityBotApproval.findOneAndUpdate(
        { _id: approvalId, guildId: String(guildId) },
        { $set: { active: false } },
        { new: true }
    ).lean()
    return doc ? { ok: true, approval: serializeApproval(doc) } : { ok: false, error: "Approval not found." }
}

async function consumeBotApproval(guildId, botId, inviterId = null) {
    if (!mongoReady()) return null
    const doc = await SecurityBotApproval.findOneAndUpdate(
        { guildId: String(guildId), botId: String(botId), active: true, expiresAt: { $gt: new Date() } },
        { $set: { active: false, usedAt: new Date(), usedByInviterId: inviterId ? String(inviterId) : null } },
        { new: true, sort: { createdAt: -1 } }
    ).lean()
    return doc ? serializeApproval(doc) : null
}

function serializeIncidentMode(doc) {
    const active = doc?.active === true && (!doc.expiresAt || new Date(doc.expiresAt).getTime() > Date.now())
    return {
        available: mongoReady(),
        active,
        reason: doc?.reason || null,
        activatedById: doc?.activatedById || null,
        activatedAt: doc?.activatedAt ? new Date(doc.activatedAt).toISOString() : null,
        expiresAt: doc?.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
        lockdownStartedByMode: doc?.lockdownStartedByMode === true,
    }
}

async function getIncidentModeState(guildId) {
    if (!mongoReady()) return serializeIncidentMode(null)
    const doc = await SecurityIncidentMode.findOne({ guildId: String(guildId) }).lean()
    if (doc?.active && doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now()) {
        await SecurityIncidentMode.updateOne({ guildId: String(guildId) }, { $set: { active: false, endedAt: new Date(), endedById: "system-expiry" } })
        doc.active = false
    }
    return serializeIncidentMode(doc)
}

async function setIncidentMode(guild, active, config, { reason, actor, durationMinutes = null } = {}) {
    if (!guild) return { ok: false, error: "Guild unavailable." }
    if (!mongoReady()) return { ok: false, error: "MongoDB is required for incident mode." }
    const existing = await SecurityIncidentMode.findOne({ guildId: guild.id })
    if (!active) {
        const shouldUnlock = existing?.lockdownStartedByMode === true
        if (shouldUnlock) await disableEmergencyLockdown(guild, { reason: safeText(reason, "Incident mode ended"), actor }).catch(() => {})
        const doc = await SecurityIncidentMode.findOneAndUpdate(
            { guildId: guild.id },
            { $set: { active: false, endedAt: new Date(), endedById: actor?.id || null, lockdownStartedByMode: false } },
            { new: true, upsert: true }
        ).lean()
        return { ok: true, mode: serializeIncidentMode(doc) }
    }

    const minutes = Math.max(5, Math.min(1440, Number(durationMinutes) || Number(config?.incidentMode?.durationMinutes) || 30))
    let lockdownStartedByMode = false
    if (config?.incidentMode?.autoLockdown !== false && config?.lockdown?.enabled !== false) {
        const lockdown = await enableEmergencyLockdown(guild, config, { reason: safeText(reason, "Security incident mode"), actor }).catch(err => ({ ok: false, error: err.message }))
        lockdownStartedByMode = lockdown.ok === true
    }
    const doc = await SecurityIncidentMode.findOneAndUpdate(
        { guildId: guild.id },
        { $set: {
            active: true,
            reason: safeText(reason, "Security incident mode"),
            activatedById: actor?.id || null,
            activatedAt: new Date(),
            expiresAt: new Date(Date.now() + minutes * 60_000),
            lockdownStartedByMode,
            endedAt: null,
            endedById: null,
        } },
        { new: true, upsert: true }
    ).lean()
    await createSecurityIncident({
        guildId: guild.id,
        type: "INCIDENT_MODE_ENABLED",
        severity: "critical",
        executorId: actor?.id || null,
        executorTag: actor?.tag || "CURSED Security",
        targetId: guild.id,
        targetTag: guild.name,
        actionTaken: lockdownStartedByMode ? "incident mode + lockdown" : "incident mode",
        details: { summary: `Incident mode enabled for ${minutes} minute(s).`, reason: safeText(reason) },
    })
    return { ok: true, mode: serializeIncidentMode(doc) }
}

function permissionAudit(guild) {
    const me = guild.members.me
    const required = [
        ["View Audit Log", PermissionFlagsBits.ViewAuditLog],
        ["Manage Roles", PermissionFlagsBits.ManageRoles],
        ["Manage Channels", PermissionFlagsBits.ManageChannels],
        ["Manage Webhooks", PermissionFlagsBits.ManageWebhooks],
        ["Manage Messages", PermissionFlagsBits.ManageMessages],
        ["Moderate Members", PermissionFlagsBits.ModerateMembers],
        ["Kick Members", PermissionFlagsBits.KickMembers],
        ["Ban Members", PermissionFlagsBits.BanMembers],
    ]
    return required.map(([name, permission]) => ({ name, ready: me?.permissions.has(permission) === true }))
}

async function runSecurityHealthAudit(guild, config) {
    if (!guild) return { score: 0, grade: "F", issues: ["Guild unavailable."], recommendations: [] }
    let score = 100
    const issues = []
    const recommendations = []
    const permissions = permissionAudit(guild)
    for (const item of permissions) {
        if (!item.ready) { score -= 8; issues.push(`CURSED is missing ${item.name}.`) }
    }
    if (!config.enabled) { score -= 25; issues.push("Server Protection is disabled.") }
    if (!config.antiNuke.enabled) { score -= 20; issues.push("Anti-nuke is disabled.") }
    if (!config.antiRaid.enabled) { score -= 8; recommendations.push("Enable anti-raid for join-wave containment.") }
    if (!config.securityLogChannelId) { score -= 5; issues.push("No security log channel is configured.") }
    if (!config.quarantine.roleId) { score -= 5; recommendations.push("Configure a quarantine role.") }
    if (!config.backup?.enabled) { score -= 8; recommendations.push("Enable automatic security snapshots.") }
    if (!config.tamperProtection?.enabled) { score -= 10; issues.push("Tamper protection is disabled.") }

    const mePosition = guild.members.me?.roles.highest.position || 0
    const dangerousAbove = [...guild.roles.cache.values()].filter(role => (
        role.id !== guild.id
        && role.position >= mePosition
        && (role.permissions.has(PermissionFlagsBits.Administrator)
            || role.permissions.has(PermissionFlagsBits.ManageRoles)
            || role.permissions.has(PermissionFlagsBits.ManageChannels))
    ))
    if (dangerousAbove.length) {
        score -= Math.min(20, dangerousAbove.length * 5)
        issues.push(`${dangerousAbove.length} dangerous role(s) are equal to or above CURSED.`)
    }

    const adminBots = [...guild.members.cache.values()].filter(member => member.user.bot && member.id !== guild.members.me?.id && member.permissions.has(PermissionFlagsBits.Administrator))
    if (adminBots.length) {
        score -= Math.min(15, adminBots.length * 3)
        recommendations.push(`Review ${adminBots.length} other bot(s) with Administrator.`)
    }
    score = Math.max(0, Math.min(100, score))
    const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F"
    return {
        score,
        grade,
        issues,
        recommendations,
        permissions,
        dangerousRolesAboveBot: dangerousAbove.map(role => ({ id: role.id, name: role.name, position: role.position })),
        administratorBots: adminBots.map(member => ({ id: member.id, tag: member.user.tag || member.user.username })),
        checkedAt: new Date().toISOString(),
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[character]))
}

async function buildIncidentReport(guildId, incidentId = null, limit = 50) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is required for incident reports." }
    let focus = null
    if (incidentId && mongoose.isValidObjectId(incidentId)) focus = await SecurityIncident.findOne({ _id: incidentId, guildId: String(guildId) }).lean()
    const query = { guildId: String(guildId) }
    if (focus?.createdAt) {
        const centre = new Date(focus.createdAt).getTime()
        query.createdAt = { $gte: new Date(centre - 10 * 60_000), $lte: new Date(centre + 10 * 60_000) }
    }
    const incidents = await SecurityIncident.find(query).sort({ createdAt: 1 }).limit(Math.max(1, Math.min(200, Number(limit) || 50))).lean()
    const report = {
        guildId: String(guildId),
        generatedAt: new Date().toISOString(),
        focusIncidentId: focus ? String(focus._id) : null,
        incidentCount: incidents.length,
        incidents: incidents.map(item => ({
            id: String(item._id),
            type: item.type,
            severity: item.severity,
            executorId: item.executorId,
            executorTag: item.executorTag,
            targetId: item.targetId,
            targetTag: item.targetTag,
            actionTaken: item.actionTaken,
            status: item.status,
            details: item.details || {},
            createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        })),
    }
    const rows = report.incidents.map(item => `<tr><td>${escapeHtml(item.createdAt)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.executorTag)}</td><td>${escapeHtml(item.targetTag || item.targetId || "—")}</td><td>${escapeHtml(item.actionTaken)}</td><td>${escapeHtml(item.details?.summary || "")}</td></tr>`).join("")
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>CURSED Security Incident Report</title><style>body{font-family:Inter,Arial,sans-serif;background:#09080f;color:#eee;padding:32px}h1{color:#b46cff}.card{background:#15121e;border:1px solid #302640;border-radius:14px;padding:20px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #302640;padding:10px;text-align:left;vertical-align:top}th{color:#cdb9e8}</style></head><body><h1>CURSED Security Incident Report</h1><div class="card"><b>Server:</b> ${escapeHtml(guildId)}<br><b>Generated:</b> ${escapeHtml(report.generatedAt)}<br><b>Incidents:</b> ${report.incidentCount}</div><div class="card"><table><thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Executor</th><th>Target</th><th>Response</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`
    return { ok: true, report, html }
}

function suspiciousUsername(username) {
    const value = String(username || "").toLowerCase()
    return /(discord\s*nitro|free\s*nitro|steam\s*gift|airdrop|crypto|support\s*team|moderator\s*team|admin\s*team)/i.test(value)
        || /[a-z0-9]{18,}/i.test(value)
}

function joinRisk(member, config, incidentMode) {
    const raid = config.antiRaid
    const accountAgeHours = Math.floor((Date.now() - member.user.createdTimestamp) / 3_600_000)
    let score = 0
    const signals = []
    if (accountAgeHours < raid.minAccountAgeHours) { score += 2; signals.push(`account age ${accountAgeHours}h`) }
    if (raid.requireAvatar && !member.user.avatar) { score += 1; signals.push("no custom avatar") }
    if (raid.suspiciousNameCheck && suspiciousUsername(member.user.username)) { score += 2; signals.push("suspicious username") }
    if (incidentMode.active) { score += 2; signals.push("incident mode active") }
    return { score, signals, accountAgeHours }
}

async function processAdvancedJoin(member) {
    if (!member?.guild || member.user?.bot) return false
    const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
    const config = getSecurityPhase3Config(member.guild.id)
    if (!config.enabled || !config.antiRaid.enabled) return false
    if (isTrustedForScope({ guildId: member.guild.id, member, userId: member.id, isBot: false, scope: "antiRaid" })) return false
    const mode = await getIncidentModeState(member.guild.id)
    const windowMs = config.antiRaid.windowSeconds * 1000
    const times = (suiteJoinWindows.get(member.guild.id) || []).filter(timestamp => timestamp > Date.now() - windowMs)
    times.push(Date.now())
    suiteJoinWindows.set(member.guild.id, times)
    const thresholdReached = times.length >= config.antiRaid.joinThreshold
    const risk = joinRisk(member, config, mode)
    if (!thresholdReached && risk.score < config.antiRaid.riskScoreThreshold) return false
    const result = await quarantineMember(member.guild, member, config, {
        reason: `Advanced anti-raid verification: ${risk.signals.join(", ") || `${times.length} joins`}`,
        moderator: { id: member.guild.members.me?.id, tag: "CURSED Join Gate" },
    }).catch(err => ({ ok: false, error: err.message }))
    await createSecurityIncident({
        guildId: member.guild.id,
        type: "ADVANCED_ANTI_RAID",
        severity: thresholdReached || mode.active ? "critical" : "high",
        executorId: null,
        executorTag: "CURSED Join Gate",
        targetId: member.id,
        targetTag: member.user.tag || member.user.username,
        actionTaken: result.ok ? "quarantine" : "alert",
        details: { summary: `Join Gate risk score ${risk.score}; ${times.length} joins in ${config.antiRaid.windowSeconds}s.`, ...risk, joins: times.length, response: result },
    })
    return result.ok
}

async function recordTamper(guild, type, summary, executor = null, config = null) {
    await createSecurityIncident({
        guildId: guild.id,
        type,
        severity: "critical",
        executorId: executor?.id || null,
        executorTag: executor?.tag || executor?.username || "Unknown executor",
        targetId: guild.members.me?.id || guild.id,
        targetTag: "CURSED protection state",
        actionTaken: "owner alerted",
        details: { summary },
    })
    await notifyOwner(guild, { content: `🚨 **CURSED security tamper warning**\n${summary}\nReview the Server Protection dashboard and Discord Audit Log immediately.`, allowedMentions: { parse: [] } })
    if (config?.tamperProtection?.autoIncidentMode !== false) {
        await setIncidentMode(guild, true, config, { reason: summary, actor: { id: guild.members.me?.id, tag: "CURSED Tamper Protection" } }).catch(() => {})
    }
}

async function latestAuditExecutor(guild, type, targetId) {
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 6 })
        const entry = [...logs.entries.values()]
            .filter(item => Date.now() - item.createdTimestamp < 20_000)
            .find(item => !targetId || String(item.targetId || item.target?.id || "") === String(targetId))
        return entry?.executor || null
    } catch { return null }
}

function attachSecurityRecoveryListeners(client) {
    if (listenersAttached || !client) return
    listenersAttached = true
    const { Events, AuditLogEvent } = require("discord.js")

    client.on(Events.GuildMemberAdd, member => {
        processAdvancedJoin(member).catch(err => console.error("Advanced anti-raid error:", err.message))
    })

    client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
        const { getSecurityPhase3Config } = require("./securityPhase3Config")
        const config = getSecurityPhase3Config(newRole.guild.id)
        if (!config.enabled || !config.tamperProtection.enabled) return
        const me = newRole.guild.members.me
        const protectedRole = newRole.id === me?.roles.highest.id || newRole.id === config.quarantine.roleId
        if (!protectedRole) return
        const changed = oldRole.permissions.bitfield !== newRole.permissions.bitfield
            || oldRole.position !== newRole.position
            || oldRole.name !== newRole.name
        if (!changed) return
        const executor = await latestAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id)
        if (executor?.id === me?.id || executor?.id === newRole.guild.ownerId) return
        await recordTamper(newRole.guild, "SECURITY_ROLE_TAMPER", `Protected role **${newRole.name}** was modified.`, executor, config)
    })

    client.on(Events.GuildRoleDelete, async role => {
        const { getSecurityPhase3Config } = require("./securityPhase3Config")
        const config = getSecurityPhase3Config(role.guild.id)
        if (!config.enabled || !config.tamperProtection.enabled || role.id !== config.quarantine.roleId) return
        const executor = await latestAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id)
        await recordTamper(role.guild, "QUARANTINE_ROLE_DELETED", `The configured quarantine role **${role.name}** was deleted.`, executor, config)
    })

    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        if (newMember.id !== newMember.guild.members.me?.id) return
        const { getSecurityPhase3Config } = require("./securityPhase3Config")
        const config = getSecurityPhase3Config(newMember.guild.id)
        if (!config.enabled || !config.tamperProtection.enabled) return
        const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))
        if (!removed.size) return
        await recordTamper(newMember.guild, "CURSED_ROLE_REMOVED", `CURSED lost ${removed.size} role(s). Protection permissions may have been reduced.`, null, config)
    })
}

async function runScheduledMaintenance(client) {
    if (!client?.isReady()) return
    const { getSecurityPhase3Config } = require("./securityPhase3Config")
    for (const guild of client.guilds.cache.values()) {
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled) continue
        if (config.backup.enabled && mongoReady()) {
            const latest = await SecuritySnapshot.findOne({ guildId: guild.id }).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean()
            const intervalMs = config.backup.intervalHours * 3_600_000
            if (!latest?.createdAt || Date.now() - new Date(latest.createdAt).getTime() >= intervalMs) {
                await createSecuritySnapshot(guild, {
                    reason: "Scheduled automatic security snapshot",
                    actor: { id: guild.members.me?.id, tag: "CURSED Backup Scheduler" },
                    retentionCount: config.backup.retentionCount,
                }).catch(err => console.error("Security snapshot scheduler error:", err.message))
            }
        }
        const mode = await getIncidentModeState(guild.id)
        if (!mode.active && mode.lockdownStartedByMode) {
            await setIncidentMode(guild, false, config, { reason: "Incident mode expired", actor: { id: guild.members.me?.id, tag: "CURSED Incident Scheduler" } }).catch(() => {})
        }
    }
}

function startSecurityRecoveryScheduler(client) {
    if (schedulerStarted || !client) return
    schedulerStarted = true
    const timer = setInterval(() => runScheduledMaintenance(client).catch(err => console.error("Security recovery scheduler error:", err.message)), 15 * 60_000)
    timer.unref?.()
    setTimeout(() => runScheduledMaintenance(client).catch(() => {}), 60_000).unref?.()
}

module.exports = {
    SecuritySnapshot,
    SecurityBotApproval,
    SecurityIncidentMode,
    createSecuritySnapshot,
    listSecuritySnapshots,
    restoreSecuritySnapshot,
    approveBot,
    listBotApprovals,
    revokeBotApproval,
    consumeBotApproval,
    getIncidentModeState,
    setIncidentMode,
    runSecurityHealthAudit,
    buildIncidentReport,
    attachSecurityRecoveryListeners,
    startSecurityRecoveryScheduler,
    processAdvancedJoin,
    joinRisk,
}