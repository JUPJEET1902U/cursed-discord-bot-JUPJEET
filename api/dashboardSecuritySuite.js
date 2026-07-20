const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { normalizeSecurityPhase3Config, SECURITY_ACTIONS } = require("../utils/securityPhase3Config")
const {
    createSecuritySnapshot,
    listSecuritySnapshots,
    restoreSecuritySnapshot,
    approveBot,
    listBotApprovals,
    revokeBotApproval,
    getIncidentModeState,
    setIncidentMode,
    runSecurityHealthAudit,
    buildIncidentReport,
} = require("../utils/securityRecoverySuite")

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
    if (origin && (!dashboardUrl || origin !== dashboardUrl)) return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    if (origin && origin === dashboardUrl) {
        res.set("Access-Control-Allow-Origin", origin)
        res.set("Vary", "Origin")
    }
    next()
}

function getGuildOrResponse(getClient, guildId, res) {
    if (!SNOWFLAKE.test(String(guildId || ""))) {
        res.status(400).json({ error: "Invalid guild ID.", code: "INVALID_GUILD_ID" })
        return null
    }
    const client = getClient()
    if (!client?.isReady()) {
        res.status(503).json({ error: "Bot is not ready.", code: "BOT_NOT_READY" })
        return null
    }
    const guild = client.guilds.cache.get(String(guildId))
    if (!guild) {
        res.status(404).json({ error: "CURSED is not added to this server.", code: "BOT_NOT_IN_GUILD" })
        return null
    }
    return guild
}

function actorFromRequest(req) {
    const id = req.get("x-dashboard-user-id")
    return { id: id && SNOWFLAKE.test(id) ? id : null, tag: "Dashboard security manager" }
}

function ownerOnly(guild, actor, res) {
    if (actor?.id && String(actor.id) === String(guild.ownerId)) return false
    res.status(403).json({ error: "Only the server owner can perform this recovery-suite action.", code: "OWNER_REQUIRED" })
    return true
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validInteger(value, min, max) {
    return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}

function validateSuiteConfig(body) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected an object."] }
    const expected = new Set(["antiRaidAdvanced", "backup", "tamperProtection", "botApprovals", "incidentMode", "staffLimits", "reports"])
    for (const key of Object.keys(body)) if (!expected.has(key)) errors[key] = ["Unknown field."]

    if (!isRecord(body.antiRaidAdvanced)) errors.antiRaidAdvanced = ["Expected advanced anti-raid settings."]
    else {
        for (const key of ["requireAvatar", "suspiciousNameCheck"]) if (typeof body.antiRaidAdvanced[key] !== "boolean") errors[`antiRaidAdvanced.${key}`] = ["Expected a boolean."]
        if (!validInteger(body.antiRaidAdvanced.riskScoreThreshold, 1, 10)) errors["antiRaidAdvanced.riskScoreThreshold"] = ["Use 1 to 10."]
    }

    if (!isRecord(body.backup)) errors.backup = ["Expected backup settings."]
    else {
        for (const key of ["enabled", "restoreServerSettings"]) if (typeof body.backup[key] !== "boolean") errors[`backup.${key}`] = ["Expected a boolean."]
        if (!validInteger(body.backup.intervalHours, 1, 168)) errors["backup.intervalHours"] = ["Use 1 to 168 hours."]
        if (!validInteger(body.backup.retentionCount, 1, 30)) errors["backup.retentionCount"] = ["Use 1 to 30 snapshots."]
    }

    if (!isRecord(body.tamperProtection)) errors.tamperProtection = ["Expected tamper-protection settings."]
    else for (const key of ["enabled", "ownerOnlyDisable", "protectBotRole", "protectQuarantineRole", "autoIncidentMode"]) {
        if (typeof body.tamperProtection[key] !== "boolean") errors[`tamperProtection.${key}`] = ["Expected a boolean."]
    }

    if (!isRecord(body.botApprovals)) errors.botApprovals = ["Expected bot-approval settings."]
    else {
        for (const key of ["enabled", "oneTime"]) if (typeof body.botApprovals[key] !== "boolean") errors[`botApprovals.${key}`] = ["Expected a boolean."]
        if (!validInteger(body.botApprovals.defaultExpiryMinutes, 1, 1440)) errors["botApprovals.defaultExpiryMinutes"] = ["Use 1 to 1440 minutes."]
    }

    if (!isRecord(body.incidentMode)) errors.incidentMode = ["Expected incident-mode settings."]
    else {
        for (const key of ["enabled", "autoLockdown", "strictMessageShield", "blockUnapprovedBots"]) if (typeof body.incidentMode[key] !== "boolean") errors[`incidentMode.${key}`] = ["Expected a boolean."]
        if (!validInteger(body.incidentMode.durationMinutes, 5, 1440)) errors["incidentMode.durationMinutes"] = ["Use 5 to 1440 minutes."]
    }

    if (!isRecord(body.staffLimits)) errors.staffLimits = ["Expected staff-limit settings."]
    else {
        if (typeof body.staffLimits.enabled !== "boolean") errors["staffLimits.enabled"] = ["Expected a boolean."]
        if (!SECURITY_ACTIONS.includes(body.staffLimits.action)) errors["staffLimits.action"] = ["Choose a valid response."]
        if (!validInteger(body.staffLimits.windowSeconds, 10, 300)) errors["staffLimits.windowSeconds"] = ["Use 10 to 300 seconds."]
        const limits = { bans: 50, kicks: 50, channelChanges: 100, roleChanges: 100, webhookChanges: 50 }
        if (!isRecord(body.staffLimits.thresholds)) errors["staffLimits.thresholds"] = ["Expected thresholds."]
        else for (const [key, max] of Object.entries(limits)) if (!validInteger(body.staffLimits.thresholds[key], 1, max)) errors[`staffLimits.thresholds.${key}`] = [`Use 1 to ${max}.`]
    }

    if (!isRecord(body.reports)) errors.reports = ["Expected report settings."]
    else {
        for (const key of ["enabled", "includeAuditDetails"]) if (typeof body.reports[key] !== "boolean") errors[`reports.${key}`] = ["Expected a boolean."]
        if (!validInteger(body.reports.maxTimelineEvents, 10, 200)) errors["reports.maxTimelineEvents"] = ["Use 10 to 200 events."]
    }
    return errors
}

function suiteConfig(config) {
    return {
        antiRaidAdvanced: {
            requireAvatar: config.antiRaid.requireAvatar,
            suspiciousNameCheck: config.antiRaid.suspiciousNameCheck,
            riskScoreThreshold: config.antiRaid.riskScoreThreshold,
        },
        backup: config.backup,
        tamperProtection: config.tamperProtection,
        botApprovals: config.botApprovals,
        incidentMode: config.incidentMode,
        staffLimits: config.staffLimits,
        reports: config.reports,
    }
}

async function payloadForGuild(guild) {
    const config = normalizeSecurityPhase3Config(getServerConfig(guild.id).config)
    const [snapshots, approvals, incidentMode, health] = await Promise.all([
        listSecuritySnapshots(guild.id, 10),
        listBotApprovals(guild.id, 25),
        getIncidentModeState(guild.id),
        runSecurityHealthAudit(guild, config),
    ])
    return { config: suiteConfig(config), snapshots, approvals, incidentMode, health }
}

async function performAction(guild, config, body, actor) {
    const action = String(body?.action || "")
    const reason = String(body?.reason || "Dashboard security action").slice(0, 1000)
    if (action === "backup-create") return createSecuritySnapshot(guild, { reason, actor, retentionCount: config.backup.retentionCount })
    if (action === "backup-restore") return restoreSecuritySnapshot(guild, String(body?.snapshotId || ""), { reason, actor, restoreServerSettings: config.backup.restoreServerSettings })
    if (action === "approval-add") return approveBot(guild.id, String(body?.botId || ""), { actor, expiresMinutes: body?.expiresMinutes || config.botApprovals.defaultExpiryMinutes, note: body?.note || null })
    if (action === "approval-revoke") return revokeBotApproval(guild.id, String(body?.approvalId || ""))
    if (action === "incident-enable" || action === "incident-disable") return setIncidentMode(guild, action === "incident-enable", config, { reason, actor, durationMinutes: body?.durationMinutes || config.incidentMode.durationMinutes })
    if (action === "security-audit") return { ok: true, health: await runSecurityHealthAudit(guild, config) }
    if (action === "incident-report") return buildIncidentReport(guild.id, body?.incidentId || null, config.reports.maxTimelineEvents)
    return { ok: false, error: "Unknown recovery-suite action." }
}

function createDashboardSecuritySuiteRouter(getClient) {
    const router = express.Router()
    router.use(originGuard)
    router.use(dashboardAuth)
    router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }))

    router.get("/guilds/:guildId/security-suite", async (req, res) => {
        const guild = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            res.json({ data: await payloadForGuild(guild) })
        } catch (err) {
            console.error("Dashboard security suite GET error:", err.message)
            res.status(500).json({ error: "Could not load the Security Recovery Suite.", code: "SECURITY_SUITE_LOAD_FAILED" })
        }
    })

    router.put("/guilds/:guildId/security-suite", async (req, res) => {
        const guild = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!guild) return
        const actor = actorFromRequest(req)
        if (ownerOnly(guild, actor, res)) return
        const errors = validateSuiteConfig(req.body)
        if (Object.keys(errors).length) return res.status(400).json({ error: "Validation failed.", code: "VALIDATION_ERROR", fields: errors })
        try {
            const current = normalizeSecurityPhase3Config(getServerConfig(guild.id).config)
            const merged = normalizeSecurityPhase3Config({
                ...current,
                antiRaid: { ...current.antiRaid, ...req.body.antiRaidAdvanced },
                backup: req.body.backup,
                tamperProtection: req.body.tamperProtection,
                botApprovals: req.body.botApprovals,
                incidentMode: req.body.incidentMode,
                staffLimits: req.body.staffLimits,
                reports: req.body.reports,
            })
            await updateGuildConfigAndWait(guild.id, { securityPhase3: merged })
            res.json({ data: await payloadForGuild(guild) })
        } catch (err) {
            console.error("Dashboard security suite PUT error:", err.message)
            res.status(err.code === "MONGO_UNAVAILABLE" ? 503 : 500).json({ error: "Could not save recovery-suite settings.", code: err.code || "SECURITY_SUITE_SAVE_FAILED" })
        }
    })

    router.post("/guilds/:guildId/security-suite/actions", async (req, res) => {
        const guild = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!guild) return
        const actor = actorFromRequest(req)
        if (ownerOnly(guild, actor, res)) return
        try {
            const config = normalizeSecurityPhase3Config(getServerConfig(guild.id).config)
            const result = await performAction(guild, config, req.body, actor)
            if (!result.ok) return res.status(400).json({ error: result.error || "Recovery-suite action failed.", code: "SECURITY_SUITE_ACTION_FAILED" })
            res.json({ data: { result, data: await payloadForGuild(guild) } })
        } catch (err) {
            console.error("Dashboard security suite action error:", err.message)
            res.status(500).json({ error: "Recovery-suite action failed safely.", code: "SECURITY_SUITE_ACTION_FAILED" })
        }
    })

    return router
}

module.exports = {
    createDashboardSecuritySuiteRouter,
    validateSuiteConfig,
    payloadForGuild,
    performAction,
}