const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const {
    PLAN_LIMITS,
    isBotOwnerId,
    getPaymentSettings,
    updatePaymentSettings,
    grantPremiumUser,
    revokePremiumUser,
    listPremiumUsers,
} = require("../utils/premium")

const SNOWFLAKE = /^\d{17,20}$/

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function dashboardAuth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    const authorization = req.get("authorization") || ""
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
    if (!secret) return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    if (!safeEqual(provided, secret)) return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    next()
}

function ownerAuth(req, res, next) {
    const actorId = req.get("x-dashboard-user-id") || ""
    if (!isBotOwnerId(actorId)) {
        return res.status(403).json({ error: "Only the CURSED bot owner can manage Premium.", code: "BOT_OWNER_REQUIRED" })
    }
    req.dashboardOwnerId = actorId
    next()
}

function originGuard(req, res, next) {
    res.set("Cache-Control", "no-store")
    const origin = req.get("origin")
    const dashboardUrl = process.env.DASHBOARD_URL
    if (origin && (!dashboardUrl || origin !== dashboardUrl)) {
        return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    }
    next()
}

function validUrlOrEmpty(value) {
    if (value == null || value === "") return true
    try {
        return ["http:", "https:"].includes(new URL(String(value)).protocol)
    } catch {
        return false
    }
}

function validateSettings(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return { body: ["Expected a JSON object."] }
    const errors = {}
    if (typeof body.enabled !== "boolean") errors.enabled = ["Expected a boolean."]
    if (typeof body.currency !== "string" || !/^[A-Za-z]{3,8}$/.test(body.currency)) errors.currency = ["Use a 3-8 letter currency code."]
    if (typeof body.monthlyPrice !== "string" || !/^\d+(?:[.,]\d{1,2})?$/.test(body.monthlyPrice)) errors.monthlyPrice = ["Enter a valid monthly price."]
    if (typeof body.headline !== "string" || !body.headline.trim() || body.headline.length > 120) errors.headline = ["Headline is required and must be 120 characters or fewer."]
    if (typeof body.instructions !== "string" || body.instructions.length > 1000) errors.instructions = ["Instructions must be 1000 characters or fewer."]
    if (!body.links || typeof body.links !== "object" || Array.isArray(body.links)) errors.links = ["Payment links are required."]
    else for (const key of ["kofi", "patreon", "bmc", "checkout"]) {
        if (!validUrlOrEmpty(body.links[key])) errors[`links.${key}`] = ["Enter a valid http(s) URL or leave it empty."]
    }
    return errors
}

function assignableRoles(guild) {
    const me = guild.members.me
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return []
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed && role.position < me.roles.highest.position)
        .sort((a, b) => b.position - a.position)
        .map(role => ({ id: role.id, name: role.name, color: role.color, position: role.position }))
}

function guildSummary(guild) {
    const config = getServerConfig(guild.id).config
    return {
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ extension: "png", size: 128 }),
        premiumRoleId: config.premiumRoleId || null,
        roles: assignableRoles(guild),
    }
}

function payload(client) {
    return {
        settings: getPaymentSettings(),
        accounts: listPremiumUsers(),
        plans: PLAN_LIMITS,
        guilds: client?.isReady()
            ? [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name)).map(guildSummary)
            : [],
    }
}

function createDashboardPremiumRouter(getClient) {
    const router = express.Router()
    router.use(originGuard)
    router.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }))
    router.use(dashboardAuth)
    router.use(ownerAuth)

    router.get("/owner/premium", (req, res) => {
        res.json({ data: payload(getClient()) })
    })

    router.put("/owner/premium/settings", async (req, res) => {
        const fieldErrors = validateSettings(req.body)
        if (Object.keys(fieldErrors).length) {
            return res.status(422).json({ error: "Payment settings are not valid.", code: "VALIDATION_ERROR", fieldErrors })
        }
        try {
            await updatePaymentSettings(req.body, req.dashboardOwnerId)
            res.json({ data: payload(getClient()) })
        } catch {
            res.status(500).json({ error: "Could not save Premium payment settings.", code: "PREMIUM_SETTINGS_SAVE_FAILED" })
        }
    })

    router.post("/owner/premium/accounts", async (req, res) => {
        const userId = String(req.body?.userId || "")
        if (!SNOWFLAKE.test(userId)) return res.status(422).json({ error: "Enter a valid Discord user ID.", code: "VALIDATION_ERROR" })
        const days = req.body?.days == null || req.body.days === "" ? null : Number(req.body.days)
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
            return res.status(422).json({ error: "Days must be a whole number from 1 to 3650.", code: "VALIDATION_ERROR" })
        }
        try {
            await grantPremiumUser(userId, {
                client: getClient(),
                grantedBy: req.dashboardOwnerId,
                source: "owner-dashboard",
                note: String(req.body?.note || "").slice(0, 500),
                expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
            })
            res.json({ data: payload(getClient()) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: "PREMIUM_GRANT_FAILED" })
        }
    })

    router.delete("/owner/premium/accounts/:userId", async (req, res) => {
        if (!SNOWFLAKE.test(req.params.userId || "")) return res.status(422).json({ error: "Invalid Discord user ID.", code: "VALIDATION_ERROR" })
        try {
            await revokePremiumUser(req.params.userId, { client: getClient() })
            res.json({ data: payload(getClient()) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: "PREMIUM_REVOKE_FAILED" })
        }
    })

    router.put("/owner/premium/guilds/:guildId/role", async (req, res) => {
        const client = getClient()
        const guild = client?.guilds.cache.get(req.params.guildId)
        if (!guild) return res.status(404).json({ error: "CURSED is not in that server.", code: "BOT_NOT_IN_GUILD" })
        const roleId = req.body?.roleId == null || req.body.roleId === "" ? null : String(req.body.roleId)
        if (roleId && !assignableRoles(guild).some(role => role.id === roleId)) {
            return res.status(422).json({ error: "Choose a role CURSED can assign.", code: "ROLE_UNAVAILABLE" })
        }
        try {
            await updateGuildConfigAndWait(guild.id, { premiumRoleId: roleId })
            res.json({ data: payload(client) })
        } catch (err) {
            res.status(err.code === "MONGO_UNAVAILABLE" ? 503 : 500).json({ error: err.message, code: err.code || "PREMIUM_ROLE_SAVE_FAILED" })
        }
    })

    return router
}

module.exports = { createDashboardPremiumRouter, validateSettings }
