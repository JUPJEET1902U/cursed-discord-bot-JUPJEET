const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { getGuildConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const {
    DEFAULT_PREFIX,
    LEGACY_PREFIX,
    MAX_PREFIX_LENGTH,
    getConfiguredPrefix,
    isValidPrefix,
    normalizePrefix,
} = require("../utils/prefix")

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
    return guild
}

function prefixPayload(guildId) {
    const prefix = getConfiguredPrefix(getGuildConfig(guildId))
    return {
        prefix,
        defaultPrefix: DEFAULT_PREFIX,
        legacyPrefix: LEGACY_PREFIX,
        maxLength: MAX_PREFIX_LENGTH,
        aliases: [...new Set([prefix, DEFAULT_PREFIX, LEGACY_PREFIX])],
        examples: {
            ban: `${prefix}ban @user reason`,
            kick: `${prefix}kick @user reason`,
            warn: `${prefix}warn @user reason`,
            timeout: `${prefix}timeout @user 10m reason`,
            purge: `${prefix}purge 10`,
            help: `${prefix}help`,
        },
    }
}

function createDashboardPrefixRouter(getClient) {
    const router = express.Router()
    const readLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false })
    const writeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false })

    router.get("/guilds/:guildId/prefix", originGuard, readLimiter, dashboardAuth, (req, res) => {
        const guild = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!guild) return
        res.json({ data: prefixPayload(guild.id) })
    })

    router.put("/guilds/:guildId/prefix", originGuard, writeLimiter, dashboardAuth, async (req, res) => {
        const guild = getGuildOrResponse(getClient, req.params.guildId, res)
        if (!guild) return
        const requested = req.body?.prefix
        if (!isValidPrefix(requested)) {
            return res.status(422).json({
                error: "Prefix settings are not valid.",
                code: "VALIDATION_ERROR",
                fieldErrors: {
                    prefix: [`Use 1 to ${MAX_PREFIX_LENGTH} characters without spaces, slashes, mentions, or backticks.`],
                },
            })
        }

        try {
            await updateGuildConfigAndWait(guild.id, { commandPrefix: normalizePrefix(requested) })
            res.json({ data: prefixPayload(guild.id) })
        } catch (error) {
            const unavailable = error?.code === "MONGO_UNAVAILABLE"
            res.status(unavailable ? 503 : 500).json({
                error: unavailable ? "MongoDB is unavailable. Try again shortly." : "Could not save the command prefix.",
                code: error?.code || "PREFIX_SAVE_FAILED",
            })
        }
    })

    return router
}

module.exports = { createDashboardPrefixRouter, prefixPayload }
