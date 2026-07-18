const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const {
    TRUSTED_SCOPES,
    TRUSTED_SUBJECT_TYPES,
    SECURITY_ACTIONS,
    normalizeSecurityPhase3Config,
} = require("../utils/securityPhase3Config")
const {
    listSecurityIncidents,
    getSecurityIncidentStats,
    updateSecurityIncident,
} = require("../utils/securityIncidents")
const {
    quarantineMember,
    releaseQuarantine,
    getActiveQuarantineCount,
    listActiveQuarantines,
} = require("../utils/quarantineState")
const {
    enableEmergencyLockdown,
    disableEmergencyLockdown,
    getLockdownStatus,
} = require("../utils/lockdownState")

const SNOWFLAKE = /^\d{17,20}$/

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function dashboardAuth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    if (!secret) return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    const authorization = req.get("authorization") || ""
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
    if (!safeEqual(provided, secret)) return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    next()
}

function originGuard(req, res, next) {
    res.set("Cache-Control", "no-store")
    const origin = req.get("origin")
    const dashboardUrl = process.env.DASHBOARD_URL
    if (origin && (!dashboardUrl || origin !== dashboardUrl)) {
        return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    }
    if (origin && origin === dashboardUrl) {
        res.set("Access-Control-Allow-Origin", origin)
        res.set("Vary", "Origin")
    }
    next()
}

function getGuildOrResponse(getClient, guildId, res) {
    if (!SNOWFLAKE.test(guildId || "")) {
        res.status(400).json({ error: "Invalid guild ID.", code: "INVALID_GUILD_ID" })
        return null
    }
    const client = getClient()
    if (!client?.isReady()) {
        res.status(503).json({ error: "Bot is not ready.", code: "BOT_NOT_READY" })
        return null
    }
    const guild = client.guilds.cache.get(guildId)
    if (!guild) {
        res.status(404).json({ error: "CURSED is not added to this server.", code: "BOT_NOT_IN_GUILD" })
        return null
    }
    return { client, guild }
}

function textChannels(guild) {
    const me = guild.members.me
    return [...guild.channels.cache.values()]
        .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => {
            const permissions = me ? channel.permissionsFor(me) : null
            return {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                parentId: channel.parentId || null,
                position: channel.rawPosition,
                canView: !permissions || permissions.has(PermissionFlagsBits.ViewChannel),
                canSend: !permissions || permissions.has(PermissionFlagsBits.SendMessages),
                canManageChannel: me?.permissions.has(PermissionFlagsBits.ManageChannels) === true,
            }
        })
        .filter(channel => channel.canView)
}

function selectableRoles(guild) {
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.color,
            position: role.position,
            editable: role.editable,
        }))
}

function permissionState(guild) {
    const me = guild.members.me
    return {
        manageChannels: me?.permissions.has(PermissionFlagsBits.ManageChannels) === true,
        manageRoles: me?.permissions.has(PermissionFlagsBits.ManageRoles) === true,
        viewAuditLog: me?.permissions.has(PermissionFlagsBits.ViewAuditLog) === true,
        moderateMembers: me?.permissions.has(PermissionFlagsBits.ModerateMembers) === true,
        kickMembers: me?.permissions.has(PermissionFlagsBits.KickMembers) === true,
        banMembers: me?.permissions.has(PermissionFlagsBits.BanMembers) === true,
        botHighestRolePosition: me?.roles?.highest?.position || 0,
    }
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validInteger(value, min, max) {
    return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}

function validateConfig(body, guild) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    const expected = new Set(["enabled", "securityLogChannelId", "antiRaid", "antiNuke", "quarantine", "lockdown", "trusted"])
    for (const key of Object.keys(body)) if (!expected.has(key)) errors[key] = ["Unknown field."]
    if (typeof body.enabled !== "boolean") errors.enabled = ["Expected a boolean."]

    const channels = new Set(guild.channels.cache.keys())
    const roles = new Set(guild.roles.cache.keys())
    if (body.securityLogChannelId !== null && !channels.has(String(body.securityLogChannelId))) {
        errors.securityLogChannelId = ["Choose a channel from this server."]
    }

    if (!isRecord(body.antiRaid)) errors.antiRaid = ["Expected anti-raid settings."]
    else {
        if (typeof body.antiRaid.enabled !== "boolean") errors["antiRaid.enabled"] = ["Expected a boolean."]
        if (!validInteger(body.antiRaid.joinThreshold, 3, 100)) errors["antiRaid.joinThreshold"] = ["Use 3 to 100 joins."]
        if (!validInteger(body.antiRaid.windowSeconds, 5, 300)) errors["antiRaid.windowSeconds"] = ["Use 5 to 300 seconds."]
        if (!validInteger(body.antiRaid.minAccountAgeHours, 0, 8760)) errors["antiRaid.minAccountAgeHours"] = ["Use 0 to 8760 hours."]
        if (!SECURITY_ACTIONS.includes(body.antiRaid.action)) errors["antiRaid.action"] = ["Choose alert, quarantine, or lockdown."]
        if (!validInteger(body.antiRaid.activeRaidSeconds, 30, 1800)) errors["antiRaid.activeRaidSeconds"] = ["Use 30 to 1800 seconds."]
    }

    if (!isRecord(body.antiNuke)) errors.antiNuke = ["Expected anti-nuke settings."]
    else {
        if (typeof body.antiNuke.enabled !== "boolean") errors["antiNuke.enabled"] = ["Expected a boolean."]
        if (!SECURITY_ACTIONS.includes(body.antiNuke.action)) errors["antiNuke.action"] = ["Choose alert, quarantine, or lockdown."]
        if (!validInteger(body.antiNuke.windowSeconds, 5, 300)) errors["antiNuke.windowSeconds"] = ["Use 5 to 300 seconds."]
        const thresholdLimits = {
            bans: 50,
            kicks: 50,
            channelDeletes: 25,
            roleDeletes: 25,
            webhookChanges: 25,
            dangerousRoleChanges: 25,
            botAdds: 25,
        }
        if (!isRecord(body.antiNuke.thresholds)) errors["antiNuke.thresholds"] = ["Expected threshold settings."]
        else for (const [key, max] of Object.entries(thresholdLimits)) {
            if (!validInteger(body.antiNuke.thresholds[key], 1, max)) errors[`antiNuke.thresholds.${key}`] = [`Use 1 to ${max}.`]
        }
    }

    if (!isRecord(body.quarantine)) errors.quarantine = ["Expected quarantine settings."]
    else {
        if (typeof body.quarantine.enabled !== "boolean") errors["quarantine.enabled"] = ["Expected a boolean."]
        if (body.quarantine.roleId !== null && !roles.has(String(body.quarantine.roleId))) errors["quarantine.roleId"] = ["Choose a role from this server."]
        if (body.quarantine.channelId !== null && !channels.has(String(body.quarantine.channelId))) errors["quarantine.channelId"] = ["Choose a channel from this server."]
        if (typeof body.quarantine.removeManageableRoles !== "boolean") errors["quarantine.removeManageableRoles"] = ["Expected a boolean."]
    }

    if (!isRecord(body.lockdown)) errors.lockdown = ["Expected lockdown settings."]
    else {
        if (typeof body.lockdown.enabled !== "boolean") errors["lockdown.enabled"] = ["Expected a boolean."]
        if (typeof body.lockdown.raiseVerificationLevel !== "boolean") errors["lockdown.raiseVerificationLevel"] = ["Expected a boolean."]
        if (!Array.isArray(body.lockdown.channelIds) || body.lockdown.channelIds.length > 200 || body.lockdown.channelIds.some(id => !channels.has(String(id)))) {
            errors["lockdown.channelIds"] = ["Choose up to 200 text channels from this server."]
        }
    }

    if (!isRecord(body.trusted)) errors.trusted = ["Expected trusted-subject settings."]
    else {
        if (typeof body.trusted.enabled !== "boolean") errors["trusted.enabled"] = ["Expected a boolean."]
        if (!Array.isArray(body.trusted.entries) || body.trusted.entries.length > 200) errors["trusted.entries"] = ["Use up to 200 trusted entries."]
        else body.trusted.entries.forEach((entry, index) => {
            if (!isRecord(entry)) { errors[`trusted.entries.${index}`] = ["Expected an entry object."]; return }
            if (!TRUSTED_SUBJECT_TYPES.includes(entry.subjectType)) errors[`trusted.entries.${index}.subjectType`] = ["Invalid subject type."]
            if (!SNOWFLAKE.test(String(entry.subjectId || ""))) errors[`trusted.entries.${index}.subjectId`] = ["Enter a valid Discord ID."]
            if (entry.subjectType === "role" && !roles.has(String(entry.subjectId))) errors[`trusted.entries.${index}.subjectId`] = ["Choose a role from this server."]
            if (entry.subjectType === "channel" && !channels.has(String(entry.subjectId))) errors[`trusted.entries.${index}.subjectId`] = ["Choose a channel from this server."]
            if (!Array.isArray(entry.scopes) || entry.scopes.some(scope => !TRUSTED_SCOPES.includes(scope))) errors[`trusted.entries.${index}.scopes`] = ["Choose valid trust scopes."]
        })
    }
    return errors
}

function actorFromRequest(req) {
    const id = req.get("x-dashboard-user-id")
    return { id: id && SNOWFLAKE.test(id) ? id : null, tag: "Dashboard manager" }
}

function serializeIncident(doc) {
    return {
        id: doc._id ? String(doc._id) : null,
        type: doc.type,
        severity: doc.severity,
        executorId: doc.executorId || null,
        executorTag: doc.executorTag || "Unknown executor",
        targetId: doc.targetId || null,
        targetTag: doc.targetTag || null,
        actionTaken: doc.actionTaken || "alert",
        status: doc.status || "open",
        details: doc.details || {},
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        resolvedAt: doc.resolvedAt ? new Date(doc.resolvedAt).toISOString() : null,
        resolutionNote: doc.resolutionNote || null,
    }
}

async function payloadForGuild(guild) {
    const config = normalizeSecurityPhase3Config(getServerConfig(guild.id).config)
    const [incidents, stats, lockdown, quarantineCount, quarantines] = await Promise.all([
        listSecurityIncidents(guild.id, { limit: 50 }),
        getSecurityIncidentStats(guild.id),
        getLockdownStatus(guild.id),
        getActiveQuarantineCount(guild.id),
        listActiveQuarantines(guild.id, 25),
    ])
    return {
        config,
        channels: textChannels(guild),
        roles: selectableRoles(guild),
        botPermissions: permissionState(guild),
        stats,
        incidents: incidents.map(serializeIncident),
        lockdown: {
            available: lockdown.available !== false,
            active: lockdown.active === true,
            status: lockdown.status || "inactive",
            channelCount: lockdown.snapshots?.length || 0,
            activatedAt: lockdown.activatedAt ? new Date(lockdown.activatedAt).toISOString() : null,
            missingChannelIds: lockdown.missingChannelIds || [],
        },
        quarantineCount,
        quarantines: quarantines.map(item => ({
            userId: item.userId,
            userTag: item.userTag,
            roleId: item.quarantineRoleId,
            reason: item.reason,
            updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
        })),
        mongoConnected: mongoose.connection.readyState === 1,
        trustedScopes: TRUSTED_SCOPES,
    }
}

async function performAction(guild, config, body, actor) {
    const action = body?.action
    const reason = String(body?.reason || "Dashboard security action").slice(0, 1000)
    if (action === "lockdown-enable") return enableEmergencyLockdown(guild, config, { reason, actor })
    if (action === "lockdown-disable") return disableEmergencyLockdown(guild, { reason, actor })
    if (["quarantine", "unquarantine"].includes(action)) {
        const userId = String(body?.userId || "")
        if (!SNOWFLAKE.test(userId)) return { ok: false, error: "Enter a valid Discord user ID." }
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null)
        if (!member) return { ok: false, error: "That member is not currently in the server." }
        if (member.id === guild.ownerId || member.id === guild.members.me?.id) return { ok: false, error: "That member cannot be targeted." }
        return action === "quarantine"
            ? quarantineMember(guild, member, config, { reason, moderator: actor })
            : releaseQuarantine(guild, member, { reason, moderator: actor })
    }
    return { ok: false, error: "Unknown security action." }
}

function createDashboardSecurityRouter(getClient) {
    const router = express.Router()
    router.use(originGuard)
    router.use(dashboardAuth)
    router.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }))

    router.get("/guilds/:guildId/security", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        try {
            res.json({ data: await payloadForGuild(resolved.guild) })
        } catch (err) {
            console.error("Dashboard security GET error:", err.message)
            res.status(500).json({ error: "Could not load Server Protection.", code: "SECURITY_LOAD_FAILED" })
        }
    })

    router.put("/guilds/:guildId/security", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        const errors = validateConfig(req.body, resolved.guild)
        if (Object.keys(errors).length) return res.status(400).json({ error: "Validation failed.", code: "VALIDATION_ERROR", fields: errors })
        try {
            const config = normalizeSecurityPhase3Config(req.body)
            await updateGuildConfigAndWait(resolved.guild.id, { securityPhase3: config })
            res.json({ data: await payloadForGuild(resolved.guild) })
        } catch (err) {
            console.error("Dashboard security PUT error:", err.message)
            res.status(err.code === "MONGO_UNAVAILABLE" ? 503 : 500).json({ error: "Could not save Server Protection settings.", code: err.code || "SECURITY_SAVE_FAILED" })
        }
    })

    router.post("/guilds/:guildId/security/actions", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        try {
            const config = normalizeSecurityPhase3Config(getServerConfig(resolved.guild.id).config)
            const result = await performAction(resolved.guild, config, req.body, actorFromRequest(req))
            if (!result.ok) return res.status(400).json({ error: result.error || "Security action failed.", code: "SECURITY_ACTION_FAILED" })
            res.json({ data: { result, data: await payloadForGuild(resolved.guild) } })
        } catch (err) {
            console.error("Dashboard security action error:", err.message)
            res.status(500).json({ error: "Security action failed safely.", code: "SECURITY_ACTION_FAILED" })
        }
    })

    router.patch("/guilds/:guildId/security/incidents/:incidentId", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        const action = String(req.body?.action || "")
        const note = req.body?.note == null ? null : String(req.body.note).trim()
        if (!["resolve", "ignore", "reopen"].includes(action) || (note && note.length > 2000)) {
            return res.status(400).json({ error: "Invalid incident update.", code: "VALIDATION_ERROR" })
        }
        const incident = await updateSecurityIncident(resolved.guild.id, req.params.incidentId, { action, note }, actorFromRequest(req))
        if (!incident) return res.status(404).json({ error: "Incident not found.", code: "INCIDENT_NOT_FOUND" })
        res.json({ data: { incident: serializeIncident(incident), stats: await getSecurityIncidentStats(resolved.guild.id) } })
    })

    return router
}

module.exports = {
    createDashboardSecurityRouter,
    validateConfig,
    payloadForGuild,
}
