const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getGuildConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { isGuildPremium, getGuildPlanLimits } = require("../utils/premium")

const SNOWFLAKE = /^\d{17,20}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const THEMES = new Set(["classic", "midnight", "neon"])
const WELCOME_FIELDS = new Set([
    "welcomeEnabled", "welcomeChannelId", "welcomeMessage", "welcomeUseAI",
    "welcomeColor", "welcomeThumbnail", "welcomeImageUrl", "welcomeFooter",
    "welcomeCardEnabled", "welcomeCardTheme", "welcomeCardBackground",
    "welcomeAccentColor", "welcomeMediaUrl",
])

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

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isHttpUrl(value) {
    if (value === null || value === "") return true
    try {
        const url = new URL(String(value))
        return ["http:", "https:"].includes(url.protocol) && String(value).length <= 2048
    } catch {
        return false
    }
}

function usableWelcomeChannels(guild) {
    const me = guild.members.me
    if (!me) return []
    return [...guild.channels.cache.values()]
        .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .filter(channel => {
            const permissions = channel.permissionsFor(me)
            return permissions?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
            ]) === true
        })
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId || null,
            position: channel.rawPosition,
        }))
}

function premiumSafeWelcome(config, guild) {
    const premium = isGuildPremium(guild)
    return {
        welcomeEnabled: config.welcomeEnabled !== false,
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage: config.welcomeMessage || null,
        welcomeUseAI: config.welcomeUseAI === true,
        welcomeColor: config.welcomeColor || null,
        welcomeThumbnail: config.welcomeThumbnail !== false,
        welcomeImageUrl: config.welcomeImageUrl || null,
        welcomeFooter: config.welcomeFooter || null,
        welcomeCardEnabled: premium && config.welcomeCardEnabled !== false,
        welcomeCardTheme: premium && THEMES.has(config.welcomeCardTheme) ? config.welcomeCardTheme : "classic",
        welcomeCardBackground: premium ? config.welcomeCardBackground || null : null,
        welcomeAccentColor: premium ? config.welcomeAccentColor || null : null,
        welcomeMediaUrl: premium ? config.welcomeMediaUrl || null : null,
    }
}

function validateWelcome(body) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    for (const key of Object.keys(body)) if (!WELCOME_FIELDS.has(key)) errors[key] = ["Unknown field."]
    for (const field of WELCOME_FIELDS) if (!(field in body)) errors[field] = ["This field is required."]

    if (typeof body.welcomeEnabled !== "boolean") errors.welcomeEnabled = ["Expected a boolean."]
    if (body.welcomeEnabled && !body.welcomeChannelId) errors.welcomeChannelId = ["Choose a welcome channel before enabling welcome messages."]
    if (body.welcomeChannelId !== null && !SNOWFLAKE.test(body.welcomeChannelId || "")) errors.welcomeChannelId = ["Invalid channel ID."]
    if (body.welcomeMessage !== null && (typeof body.welcomeMessage !== "string" || body.welcomeMessage.length > 2000)) errors.welcomeMessage = ["Message must be 2000 characters or fewer."]
    if (typeof body.welcomeUseAI !== "boolean") errors.welcomeUseAI = ["Expected a boolean."]
    if (body.welcomeColor !== null && (typeof body.welcomeColor !== "string" || !HEX_COLOR.test(body.welcomeColor))) errors.welcomeColor = ["Expected a six-digit hex color."]
    if (typeof body.welcomeThumbnail !== "boolean") errors.welcomeThumbnail = ["Expected a boolean."]
    if (!isHttpUrl(body.welcomeImageUrl)) errors.welcomeImageUrl = ["Expected a valid http(s) URL."]
    if (body.welcomeFooter !== null && (typeof body.welcomeFooter !== "string" || body.welcomeFooter.length > 2048)) errors.welcomeFooter = ["Footer must be 2048 characters or fewer."]
    if (typeof body.welcomeCardEnabled !== "boolean") errors.welcomeCardEnabled = ["Expected a boolean."]
    if (!THEMES.has(body.welcomeCardTheme)) errors.welcomeCardTheme = ["Choose classic, midnight, or neon."]
    if (!isHttpUrl(body.welcomeCardBackground)) errors.welcomeCardBackground = ["Expected a valid http(s) URL."]
    if (body.welcomeAccentColor !== null && (typeof body.welcomeAccentColor !== "string" || !HEX_COLOR.test(body.welcomeAccentColor))) errors.welcomeAccentColor = ["Expected a six-digit hex color."]
    if (!isHttpUrl(body.welcomeMediaUrl)) errors.welcomeMediaUrl = ["Expected a valid http(s) URL."]
    return errors
}

function planPayload(guild) {
    const limits = getGuildPlanLimits(guild)
    return {
        plan: isGuildPremium(guild) ? "premium" : "free",
        planLimits: {
            welcomeCard: limits.welcomeCard,
            customBackground: limits.welcomeCustomBackground,
            themes: limits.welcomeThemes,
        },
    }
}

function createDashboardWelcomeRouter(getClient) {
    const router = express.Router()
    const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 180, standardHeaders: true, legacyHeaders: false })
    const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false })

    router.use((req, res, next) => {
        res.set("Cache-Control", "no-store")
        const origin = req.get("origin")
        const dashboardUrl = process.env.DASHBOARD_URL
        if (origin && (!dashboardUrl || origin !== dashboardUrl)) return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
        if (origin && origin === dashboardUrl) {
            res.set("Access-Control-Allow-Origin", origin)
            res.set("Vary", "Origin")
        }
        next()
    })
    router.use(readLimiter)
    router.use(dashboardAuth)

    router.get("/guilds/:guildId/welcome", (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            res.json({
                data: {
                    config: premiumSafeWelcome(getGuildConfig(guild.id), guild),
                    channels: usableWelcomeChannels(guild),
                    ...planPayload(guild),
                },
            })
        } catch (err) { next(err) }
    })

    router.put("/guilds/:guildId/welcome", writeLimiter, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const fieldErrors = validateWelcome(req.body)
            if (Object.keys(fieldErrors).length > 0) {
                return res.status(422).json({ error: "Welcome settings are not valid.", code: "VALIDATION_ERROR", fieldErrors })
            }

            if (req.body.welcomeChannelId) {
                const channel = usableWelcomeChannels(guild).find(item => item.id === req.body.welcomeChannelId)
                if (!channel) {
                    return res.status(422).json({
                        error: "CURSED cannot use that welcome channel.",
                        code: "CHANNEL_UNAVAILABLE",
                        fieldErrors: { welcomeChannelId: ["Choose a channel where CURSED can view, send, and embed links."] },
                    })
                }
            }

            const premium = isGuildPremium(guild)
            const updates = premium ? req.body : {
                ...req.body,
                welcomeCardEnabled: false,
                welcomeCardTheme: "classic",
                welcomeCardBackground: null,
                welcomeAccentColor: null,
                welcomeMediaUrl: null,
            }
            const saved = await updateGuildConfigAndWait(guild.id, updates)
            res.json({ data: { config: premiumSafeWelcome(saved, guild), ...planPayload(guild) } })
        } catch (err) { next(err) }
    })

    router.use((err, req, res, _next) => {
        const mongoUnavailable = err?.code === "MONGO_UNAVAILABLE" || mongoose.connection.readyState !== 1
        console.error("[dashboard-welcome-api] request failed", {
            method: req.method,
            path: req.path,
            error: err?.name || "Error",
            code: err?.code || null,
        })
        res.status(mongoUnavailable ? 503 : 500).json({
            error: mongoUnavailable ? "MongoDB is unavailable. Try again shortly." : "The bot API could not complete this request.",
            code: mongoUnavailable ? "MONGO_UNAVAILABLE" : "INTERNAL_ERROR",
        })
    })

    return router
}

module.exports = { createDashboardWelcomeRouter, validateWelcome }
