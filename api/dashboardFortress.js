const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const {
    FORTRESS_MODES,
    CONTAINMENT_ACTIONS,
    JOIN_GATE_ACTIONS,
    AUTOMOD_ACTIONS,
    normalizeFortressConfig,
} = require("../utils/fortressConfig")
const { getSecurityPhase3Config } = require("../utils/securityPhase3Config")
const { getSecurityIncidentStats, listSecurityIncidents } = require("../utils/securityIncidents")
const { getLockdownStatus, enableEmergencyLockdown, disableEmergencyLockdown } = require("../utils/lockdownState")
const { captureGuildSnapshot, listGuildSnapshots, restoreGuildSnapshot } = require("../utils/securitySnapshots")
const { evaluateSecurityHealth } = require("../utils/securityHealth")

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

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isInteger(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max
}

function keysOnly(value, allowed, errors, prefix) {
    if (!isRecord(value)) {
        errors[prefix] = ["Expected an object."]
        return false
    }
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) errors[`${prefix}.${key}`] = ["Unknown field."]
    }
    return true
}

function booleanField(value, path, errors) {
    if (typeof value !== "boolean") errors[path] = ["Expected a boolean."]
}

function integerField(value, min, max, path, errors) {
    if (!isInteger(value, min, max)) errors[path] = [`Use an integer from ${min} to ${max}.`]
}

function validateFortressConfig(body) {
    const errors = {}
    if (!keysOnly(body, ["enabled", "mode", "notifyOwner", "auditRetryCount", "auditRetryDelayMs", "heat", "response", "rollback", "panic", "backups", "joinGate", "automod"], errors, "config")) return errors
    booleanField(body.enabled, "enabled", errors)
    if (!FORTRESS_MODES.includes(body.mode)) errors.mode = ["Choose balanced, strict, or custom."]
    booleanField(body.notifyOwner, "notifyOwner", errors)
    integerField(body.auditRetryCount, 1, 6, "auditRetryCount", errors)
    integerField(body.auditRetryDelayMs, 100, 2000, "auditRetryDelayMs", errors)

    if (keysOnly(body.heat, ["enabled", "threshold", "windowSeconds", "decaySeconds", "panicThreshold"], errors, "heat")) {
        booleanField(body.heat.enabled, "heat.enabled", errors)
        integerField(body.heat.threshold, 3, 100, "heat.threshold", errors)
        integerField(body.heat.windowSeconds, 5, 300, "heat.windowSeconds", errors)
        integerField(body.heat.decaySeconds, 10, 900, "heat.decaySeconds", errors)
        integerField(body.heat.panicThreshold, 5, 150, "heat.panicThreshold", errors)
    }

    if (keysOnly(body.response, ["neutralizeFirst", "order", "timeoutMinutes", "continueAfterContainment"], errors, "response")) {
        booleanField(body.response.neutralizeFirst, "response.neutralizeFirst", errors)
        booleanField(body.response.continueAfterContainment, "response.continueAfterContainment", errors)
        integerField(body.response.timeoutMinutes, 1, 40320, "response.timeoutMinutes", errors)
        if (!Array.isArray(body.response.order) || body.response.order.length < 1 || body.response.order.length > CONTAINMENT_ACTIONS.length || body.response.order.some(item => !CONTAINMENT_ACTIONS.includes(item))) {
            errors["response.order"] = ["Choose one or more valid containment actions."]
        }
    }

    const rollbackKeys = ["enabled", "recreateDeletedChannels", "recreateDeletedRoles", "revertChannelUpdates", "revertRoleUpdates", "removeUnauthorizedChannels", "removeUnauthorizedRoles", "removeUnauthorizedBots", "removeUnauthorizedWebhooks", "unbanVictims", "restoreRoleAssignments"]
    if (keysOnly(body.rollback, rollbackKeys, errors, "rollback")) {
        for (const key of rollbackKeys) booleanField(body.rollback[key], `rollback.${key}`, errors)
    }

    if (keysOnly(body.panic, ["enabled", "lockdownOnTrigger", "autoReleaseMinutes", "triggerOnCritical"], errors, "panic")) {
        booleanField(body.panic.enabled, "panic.enabled", errors)
        booleanField(body.panic.lockdownOnTrigger, "panic.lockdownOnTrigger", errors)
        booleanField(body.panic.triggerOnCritical, "panic.triggerOnCritical", errors)
        integerField(body.panic.autoReleaseMinutes, 0, 1440, "panic.autoReleaseMinutes", errors)
    }

    if (keysOnly(body.backups, ["enabled", "intervalMinutes", "maxSnapshots", "autoRestoreOnPanic"], errors, "backups")) {
        booleanField(body.backups.enabled, "backups.enabled", errors)
        booleanField(body.backups.autoRestoreOnPanic, "backups.autoRestoreOnPanic", errors)
        integerField(body.backups.intervalMinutes, 30, 1440, "backups.intervalMinutes", errors)
        integerField(body.backups.maxSnapshots, 2, 25, "backups.maxSnapshots", errors)
    }

    if (keysOnly(body.joinGate, ["enabled", "action", "minimumScore", "onlyDuringRaid", "noAvatar", "noAvatarScore", "accountAgeHours", "newAccountScore", "advertisingName", "advertisingNameScore", "usernamePatterns", "usernamePatternScore", "unverifiedBots", "unauthorizedBots"], errors, "joinGate")) {
        booleanField(body.joinGate.enabled, "joinGate.enabled", errors)
        if (!JOIN_GATE_ACTIONS.includes(body.joinGate.action)) errors["joinGate.action"] = ["Choose a valid Join Gate action."]
        integerField(body.joinGate.minimumScore, 1, 25, "joinGate.minimumScore", errors)
        integerField(body.joinGate.noAvatarScore, 0, 10, "joinGate.noAvatarScore", errors)
        integerField(body.joinGate.accountAgeHours, 0, 8760, "joinGate.accountAgeHours", errors)
        integerField(body.joinGate.newAccountScore, 0, 10, "joinGate.newAccountScore", errors)
        integerField(body.joinGate.advertisingNameScore, 0, 10, "joinGate.advertisingNameScore", errors)
        integerField(body.joinGate.usernamePatternScore, 0, 10, "joinGate.usernamePatternScore", errors)
        for (const key of ["onlyDuringRaid", "noAvatar", "advertisingName", "unverifiedBots", "unauthorizedBots"]) booleanField(body.joinGate[key], `joinGate.${key}`, errors)
        if (!Array.isArray(body.joinGate.usernamePatterns) || body.joinGate.usernamePatterns.length > 50 || body.joinGate.usernamePatterns.some(item => typeof item !== "string" || item.length > 80)) {
            errors["joinGate.usernamePatterns"] = ["Use up to 50 patterns of at most 80 characters."]
        }
    }

    const automod = body.automod
    if (keysOnly(automod, ["enabled", "dryRun", "deleteViolations", "decaySeconds", "duplicateWindowSeconds", "filters", "limits", "heat", "actions"], errors, "automod")) {
        booleanField(automod.enabled, "automod.enabled", errors)
        booleanField(automod.dryRun, "automod.dryRun", errors)
        booleanField(automod.deleteViolations, "automod.deleteViolations", errors)
        integerField(automod.decaySeconds, 10, 600, "automod.decaySeconds", errors)
        integerField(automod.duplicateWindowSeconds, 5, 300, "automod.duplicateWindowSeconds", errors)
        const filterKeys = ["rapidSpam", "duplicateSpam", "mentionSpam", "capsSpam", "emojiSpam", "newlineSpam", "zalgo", "attachmentSpam", "links", "invites"]
        if (keysOnly(automod.filters, filterKeys, errors, "automod.filters")) for (const key of filterKeys) booleanField(automod.filters[key], `automod.filters.${key}`, errors)
        const limitRanges = { messages: [3, 30], messageWindowSeconds: [2, 60], duplicates: [2, 10], mentions: [2, 50], capsPercent: [50, 100], emojis: [3, 100], newlines: [3, 100], attachments: [2, 10] }
        if (keysOnly(automod.limits, Object.keys(limitRanges), errors, "automod.limits")) for (const [key, [min, max]] of Object.entries(limitRanges)) integerField(automod.limits[key], min, max, `automod.limits.${key}`, errors)
        const heatKeys = ["rapidSpam", "duplicateSpam", "mentionSpam", "capsSpam", "emojiSpam", "newlineSpam", "zalgo", "attachmentSpam", "link", "invite"]
        if (keysOnly(automod.heat, heatKeys, errors, "automod.heat")) for (const key of heatKeys) integerField(automod.heat[key], 0, 25, `automod.heat.${key}`, errors)
        if (!Array.isArray(automod.actions) || automod.actions.length < 1 || automod.actions.length > 10) errors["automod.actions"] = ["Use 1 to 10 escalation actions."]
        else automod.actions.forEach((item, index) => {
            if (!isRecord(item)) { errors[`automod.actions.${index}`] = ["Expected an action object."]; return }
            if (!AUTOMOD_ACTIONS.includes(item.action)) errors[`automod.actions.${index}.action`] = ["Invalid AutoMod action."]
            integerField(item.heat, 1, 100, `automod.actions.${index}.heat`, errors)
            if (item.action === "timeout") integerField(item.durationMinutes, 1, 40320, `automod.actions.${index}.durationMinutes`, errors)
            else if (item.durationMinutes !== null) errors[`automod.actions.${index}.durationMinutes`] = ["Only timeout actions use a duration."]
        })
    }

    return errors
}

function actorFromRequest(req) {
    const id = req.get("x-dashboard-user-id")
    return { id: id && SNOWFLAKE.test(id) ? id : null, tag: "Dashboard manager" }
}

function serializeSnapshot(item) {
    return {
        snapshotId: item.snapshotId,
        reason: item.reason,
        createdByTag: item.createdByTag,
        createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        roleCount: item.stats?.roleCount || item.roles?.length || 0,
        channelCount: item.stats?.channelCount || item.channels?.length || 0,
    }
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
    }
}

async function fortressPayload(guild) {
    const fortress = normalizeFortressConfig(getServerConfig(guild.id).config)
    const security = getSecurityPhase3Config(guild.id)
    const [health, snapshots, incidents, stats, lockdown] = await Promise.all([
        evaluateSecurityHealth(guild),
        listGuildSnapshots(guild.id, fortress.backups.maxSnapshots),
        listSecurityIncidents(guild.id, { limit: 30 }),
        getSecurityIncidentStats(guild.id),
        getLockdownStatus(guild.id),
    ])
    return {
        config: fortress,
        core: {
            enabled: security.enabled,
            antiNukeEnabled: security.antiNuke.enabled,
            antiRaidEnabled: security.antiRaid.enabled,
            quarantineEnabled: security.quarantine.enabled,
            quarantineReady: Boolean(security.quarantine.roleId),
            lockdownEnabled: security.lockdown.enabled,
            securityLogChannelId: security.securityLogChannelId,
        },
        health,
        snapshots: snapshots.map(serializeSnapshot),
        incidents: incidents.map(serializeIncident),
        stats,
        lockdown: {
            active: lockdown.active === true,
            status: lockdown.status || "inactive",
            channelCount: lockdown.snapshots?.length || 0,
            activatedAt: lockdown.activatedAt ? new Date(lockdown.activatedAt).toISOString() : null,
        },
        mongoConnected: mongoose.connection.readyState === 1,
        options: {
            modes: FORTRESS_MODES,
            containmentActions: CONTAINMENT_ACTIONS,
            joinGateActions: JOIN_GATE_ACTIONS,
            automodActions: AUTOMOD_ACTIONS,
        },
    }
}

async function performAction(guild, body, actor) {
    const action = String(body?.action || "")
    const fortress = normalizeFortressConfig(getServerConfig(guild.id).config)
    const security = getSecurityPhase3Config(guild.id)
    const reason = String(body?.reason || "Dashboard Fortress action").slice(0, 1000)

    if (action === "panic-enable") {
        let snapshot = null
        if (fortress.backups.enabled) snapshot = await captureGuildSnapshot(guild, { reason: `Pre-panic: ${reason}`, actor, maxSnapshots: fortress.backups.maxSnapshots })
        const lockdown = await enableEmergencyLockdown(guild, security, { reason, actor })
        return { ok: lockdown.ok, lockdown, snapshot: snapshot?.ok ? serializeSnapshot(snapshot.snapshot) : null, error: lockdown.error }
    }
    if (action === "panic-disable") return disableEmergencyLockdown(guild, { reason, actor })
    if (action === "snapshot-create") return captureGuildSnapshot(guild, { reason, actor, maxSnapshots: fortress.backups.maxSnapshots })
    if (action === "snapshot-restore") {
        const snapshotId = String(body?.snapshotId || "").trim()
        if (!/^[a-f0-9]{8,32}$/i.test(snapshotId)) return { ok: false, error: "Enter a valid snapshot ID." }
        if (body?.confirm !== true) return { ok: false, error: "Snapshot restore requires explicit confirmation." }
        return restoreGuildSnapshot(guild, snapshotId, { reason, actor })
    }
    return { ok: false, error: "Unknown Fortress action." }
}

function createDashboardFortressRouter(getClient) {
    const router = express.Router()
    router.use(originGuard)
    router.use(dashboardAuth)
    router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }))

    router.get("/guilds/:guildId/fortress", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        try {
            res.json({ data: await fortressPayload(resolved.guild) })
        } catch (err) {
            console.error("Dashboard Fortress GET error:", err.message)
            res.status(500).json({ error: "Could not load CURSED Fortress.", code: "FORTRESS_LOAD_FAILED" })
        }
    })

    router.put("/guilds/:guildId/fortress", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        const errors = validateFortressConfig(req.body)
        if (Object.keys(errors).length) return res.status(400).json({ error: "Validation failed.", code: "VALIDATION_ERROR", fields: errors })
        try {
            const config = normalizeFortressConfig(req.body)
            await updateGuildConfigAndWait(resolved.guild.id, { securityFortress: config })
            res.json({ data: await fortressPayload(resolved.guild) })
        } catch (err) {
            console.error("Dashboard Fortress PUT error:", err.message)
            res.status(err.code === "MONGO_UNAVAILABLE" ? 503 : 500).json({ error: "Could not save CURSED Fortress settings.", code: err.code || "FORTRESS_SAVE_FAILED" })
        }
    })

    router.post("/guilds/:guildId/fortress/actions", async (req, res) => {
        const resolved = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!resolved) return
        try {
            const result = await performAction(resolved.guild, req.body, actorFromRequest(req))
            if (!result.ok) return res.status(400).json({ error: result.error || "Fortress action failed.", code: "FORTRESS_ACTION_FAILED" })
            res.json({ data: { result, data: await fortressPayload(resolved.guild) } })
        } catch (err) {
            console.error("Dashboard Fortress action error:", err.message)
            res.status(500).json({ error: "Fortress action failed safely.", code: "FORTRESS_ACTION_FAILED" })
        }
    })

    return router
}

module.exports = {
    createDashboardFortressRouter,
    validateFortressConfig,
    fortressPayload,
}
