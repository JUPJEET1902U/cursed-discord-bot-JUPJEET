const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const {
    BASE_ROLE_COMMANDS,
    MAX_CUSTOM_COMMANDS,
} = require("../utils/customRolePolicy")
const {
    getCustomRoleConfig,
    saveValidatedConfig,
    buildRoleCatalog,
    listCustomRoleAudits,
} = require("../utils/customRoles")

const SNOWFLAKE = /^\d{17,20}$/

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function auth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    const provided = (req.get("authorization") || "").replace(/^Bearer /, "")
    if (!secret) {
        return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    }
    if (!safeEqual(provided, secret)) {
        return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    }
    next()
}

function origin(req, res, next) {
    res.set("Cache-Control", "no-store")
    const incoming = req.get("origin")
    const dashboard = process.env.DASHBOARD_URL
    if (incoming && (!dashboard || incoming !== dashboard)) {
        return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    }
    next()
}

function guildOr(getClient, guildId, res) {
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
    return guild
}

async function payload(guild) {
    const [config, audits] = await Promise.all([
        getCustomRoleConfig(guild.id, { fresh: true }),
        listCustomRoleAudits(guild.id, 20),
    ])
    return {
        config,
        roles: buildRoleCatalog(guild),
        audits,
        baseSlots: BASE_ROLE_COMMANDS,
        limits: { customCommands: MAX_CUSTOM_COMMANDS },
        guild: { id: guild.id, name: guild.name },
    }
}

function createDashboardCustomRolesRouter(getClient) {
    const router = express.Router()
    router.use(origin, auth, rateLimit({
        windowMs: 60_000,
        limit: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many custom-role dashboard requests.", code: "RATE_LIMITED" },
    }))

    router.get("/guilds/:guildId/custom-roles", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            res.json({ data: await payload(guild) })
        } catch (error) {
            console.error("Custom role dashboard load error:", error.message)
            res.status(500).json({ error: "Could not load custom role settings.", code: "CUSTOM_ROLES_LOAD_FAILED" })
        }
    })

    router.put("/guilds/:guildId/custom-roles", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        const actorId = String(req.get("x-dashboard-user-id") || guild.ownerId)
        if (!SNOWFLAKE.test(actorId)) {
            return res.status(422).json({ error: "Invalid dashboard user ID.", code: "INVALID_ACTOR_ID" })
        }
        try {
            await saveValidatedConfig(guild, req.body || {}, {
                actorId,
                source: "dashboard",
                reason: "Custom role configuration updated from dashboard",
            })
            res.json({ data: await payload(guild) })
        } catch (error) {
            if (error.code === "VALIDATION_ERROR") {
                return res.status(422).json({
                    error: "Custom role configuration is invalid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors: error.fieldErrors || {},
                })
            }
            if (error.code === "MONGO_UNAVAILABLE") {
                return res.status(503).json({ error: "MongoDB is unavailable.", code: "MONGO_UNAVAILABLE" })
            }
            console.error("Custom role dashboard save error:", error.message)
            res.status(500).json({ error: "Could not save custom role settings.", code: "CUSTOM_ROLES_SAVE_FAILED" })
        }
    })

    return router
}

module.exports = {
    createDashboardCustomRolesRouter,
    payload,
}
