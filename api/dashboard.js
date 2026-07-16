const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const {
    getGuildConfig,
    updateGuildConfigAndWait,
} = require("../utils/serverConfig")
const { getGuildActivitySummary } = require("../utils/activityTracker")
const { getStatus: getAIStatus } = require("../utils/ai")

const SNOWFLAKE = /^\d{17,20}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const WELCOME_FIELDS = [
    "welcomeChannelId",
    "welcomeMessage",
    "welcomeUseAI",
    "welcomeColor",
    "welcomeThumbnail",
    "welcomeImageUrl",
    "welcomeFooter",
]

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function dashboardAuth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    if (!secret) {
        return res.status(503).json({
            error: "Dashboard API is not configured.",
            code: "API_NOT_CONFIGURED",
        })
    }

    const authorization = req.get("authorization") || ""
    const provided = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : ""

    if (!safeEqual(provided, secret)) {
        return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    }
    next()
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isHttpUrl(value) {
    if (value === null) return true
    try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") && value.length <= 2048
    } catch {
        return false
    }
}

function validateWelcome(body) {
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    const errors = {}
    const keys = Object.keys(body)

    for (const field of WELCOME_FIELDS) {
        if (!keys.includes(field)) errors[field] = ["This field is required."]
    }
    for (const key of keys) {
        if (!WELCOME_FIELDS.includes(key)) errors[key] = ["Unknown field."]
    }

    if (body.welcomeChannelId !== null && !SNOWFLAKE.test(body.welcomeChannelId || "")) {
        errors.welcomeChannelId = ["Invalid channel ID."]
    }
    if (body.welcomeMessage !== null &&
        (typeof body.welcomeMessage !== "string" || body.welcomeMessage.length > 2000)) {
        errors.welcomeMessage = ["Message must be 2000 characters or fewer."]
    }
    if (typeof body.welcomeUseAI !== "boolean") {
        errors.welcomeUseAI = ["Expected a boolean."]
    }
    if (body.welcomeColor !== null &&
        (typeof body.welcomeColor !== "string" || !HEX_COLOR.test(body.welcomeColor))) {
        errors.welcomeColor = ["Expected a six-digit hex color."]
    }
    if (typeof body.welcomeThumbnail !== "boolean") {
        errors.welcomeThumbnail = ["Expected a boolean."]
    }
    if (body.welcomeImageUrl !== null &&
        (typeof body.welcomeImageUrl !== "string" || !isHttpUrl(body.welcomeImageUrl))) {
        errors.welcomeImageUrl = ["Expected a valid http(s) URL."]
    }
    if (body.welcomeFooter !== null &&
        (typeof body.welcomeFooter !== "string" || body.welcomeFooter.length > 2048)) {
        errors.welcomeFooter = ["Footer must be 2048 characters or fewer."]
    }

    return errors
}

function validateAutorole(body) {
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    const errors = {}
    const keys = Object.keys(body)
    if (!keys.includes("autoroleId")) errors.autoroleId = ["This field is required."]
    for (const key of keys) {
        if (key !== "autoroleId") errors[key] = ["Unknown field."]
    }
    if (body.autoroleId !== null && !SNOWFLAKE.test(body.autoroleId || "")) {
        errors.autoroleId = ["Invalid role ID."]
    }
    return errors
}

function welcomeConfig(config) {
    return {
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage: config.welcomeMessage || null,
        welcomeUseAI: config.welcomeUseAI === true,
        welcomeColor: config.welcomeColor || null,
        welcomeThumbnail: config.welcomeThumbnail !== false,
        welcomeImageUrl: config.welcomeImageUrl || null,
        welcomeFooter: config.welcomeFooter || null,
    }
}

function autoroleConfig(config) {
    return {
        autoroleId: config.autoroleId || null,
        autoroleRoleName: config.autoroleRoleName || null,
    }
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
        res.status(404).json({
            error: "CURSED is not added to this server.",
            code: "BOT_NOT_IN_GUILD",
        })
        return null
    }
    return { client, guild }
}

function usableWelcomeChannels(guild) {
    const botMember = guild.members.me
    if (!botMember) return []

    return [...guild.channels.cache.values()]
        .filter((channel) =>
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildAnnouncement
        )
        .filter((channel) => {
            const permissions = channel.permissionsFor(botMember)
            return permissions?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
            ]) === true
        })
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId || null,
            position: channel.rawPosition,
        }))
}

function roleUnavailableReason(role, guild, botMember) {
    if (!botMember) return "Bot member is unavailable."
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return "CURSED needs the Manage Roles permission."
    }
    if (role.id === guild.id) return "The @everyone role cannot be assigned."
    if (role.managed) return "This role is managed by Discord or an integration."
    if (role.position >= botMember.roles.highest.position) {
        return "Move the CURSED role above this role in Discord."
    }
    return null
}

function assignableRoles(guild) {
    const botMember = guild.members.me
    return [...guild.roles.cache.values()]
        .filter((role) => roleUnavailableReason(role, guild, botMember) === null)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
            id: role.id,
            name: role.name,
            color: role.color,
            position: role.position,
            managed: role.managed,
        }))
}

function mongoState() {
    const names = ["disconnected", "connected", "connecting", "disconnecting"]
    return names[mongoose.connection.readyState] || "unknown"
}

function createDashboardRouter(getClient) {
    const router = express.Router()
    const readLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 180,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests.", code: "RATE_LIMITED" },
    })
    const writeLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many update requests.", code: "RATE_LIMITED" },
    })

    router.use((req, res, next) => {
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
    })
    router.use(readLimiter)
    router.use(dashboardAuth)

    router.get("/health", (req, res) => {
        const client = getClient()
        const ready = client?.isReady() === true
        const ai = getAIStatus()
        res.json({
            data: {
                bot: {
                    ready,
                    pingMs: ready && Number.isFinite(client.ws.ping) ? client.ws.ping : null,
                    uptimeMs: ready && Number.isFinite(client.uptime) ? client.uptime : null,
                    guildCount: ready ? client.guilds.cache.size : null,
                },
                mongo: { connected: mongoose.connection.readyState === 1, state: mongoState() },
                aiProviders: {
                    gemini: ai.geminiConfigured,
                    groq: ai.groqConfigured,
                    openRouter: ai.openRouterConfigured,
                },
            },
        })
    })

    router.post("/guilds/presence", (req, res) => {
        const client = getClient()
        if (!client?.isReady()) {
            return res.status(503).json({ error: "Bot is not ready.", code: "BOT_NOT_READY" })
        }
        const guildIds = req.body?.guildIds
        if (!Array.isArray(guildIds) || guildIds.length > 250 || guildIds.some((id) => !SNOWFLAKE.test(id))) {
            return res.status(422).json({ error: "Invalid guild ID list.", code: "VALIDATION_ERROR" })
        }
        const presentGuildIds = guildIds.filter((id) => client.guilds.cache.has(id))
        res.json({ data: { presentGuildIds } })
    })

    router.get("/guilds/:guildId/overview", async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const { client, guild } = found
            const activity = await getGuildActivitySummary(guild.id)
            const ai = getAIStatus()

            res.json({
                data: {
                    bot: {
                        ready: true,
                        pingMs: Number.isFinite(client.ws.ping) ? client.ws.ping : null,
                        uptimeMs: Number.isFinite(client.uptime) ? client.uptime : null,
                        presence: client.user?.presence?.status || null,
                    },
                    mongo: { connected: mongoose.connection.readyState === 1, state: mongoState() },
                    guild: {
                        id: guild.id,
                        name: guild.name,
                        iconUrl: guild.iconURL({ extension: "png", size: 128 }),
                        memberCount: guild.memberCount,
                        boostCount: guild.premiumSubscriptionCount ?? null,
                        botIsMember: true,
                    },
                    aiProviders: {
                        gemini: ai.geminiConfigured,
                        groq: ai.groqConfigured,
                        openRouter: ai.openRouterConfigured,
                    },
                    activity: activity ? { available: true, ...activity } : { available: false },
                    recentActivity: { available: false, items: [] },
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.get("/guilds/:guildId/welcome", (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const config = welcomeConfig(getGuildConfig(found.guild.id))
            res.json({ data: { config, channels: usableWelcomeChannels(found.guild) } })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/welcome", writeLimiter, async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const fieldErrors = validateWelcome(req.body)
            if (Object.keys(fieldErrors).length > 0) {
                return res.status(422).json({
                    error: "Welcome settings are not valid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors,
                })
            }

            if (req.body.welcomeChannelId) {
                const channel = usableWelcomeChannels(found.guild)
                    .find((item) => item.id === req.body.welcomeChannelId)
                if (!channel) {
                    return res.status(422).json({
                        error: "CURSED cannot use that welcome channel.",
                        code: "CHANNEL_UNAVAILABLE",
                        fieldErrors: {
                            welcomeChannelId: ["Choose a channel where CURSED can view, send, and embed links."],
                        },
                    })
                }
            }

            const saved = await updateGuildConfigAndWait(found.guild.id, req.body)
            res.json({ data: { config: welcomeConfig(saved) } })
        } catch (err) {
            next(err)
        }
    })

    router.get("/guilds/:guildId/autorole", (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const config = autoroleConfig(getGuildConfig(found.guild.id))
            const currentRole = config.autoroleId
                ? found.guild.roles.cache.get(config.autoroleId)
                : null
            const unavailableReason = currentRole
                ? roleUnavailableReason(currentRole, found.guild, found.guild.members.me)
                : config.autoroleId ? "The configured role no longer exists." : null

            res.json({
                data: {
                    config,
                    enabled: Boolean(config.autoroleId),
                    roles: assignableRoles(found.guild),
                    canManageRoles: found.guild.members.me?.permissions
                        .has(PermissionFlagsBits.ManageRoles) === true,
                    currentRole: currentRole ? {
                        id: currentRole.id,
                        name: currentRole.name,
                        color: currentRole.color,
                        position: currentRole.position,
                        managed: currentRole.managed,
                        assignable: unavailableReason === null,
                        unavailableReason,
                    } : null,
                    unavailableReason,
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/autorole", writeLimiter, async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const fieldErrors = validateAutorole(req.body)
            if (Object.keys(fieldErrors).length > 0) {
                return res.status(422).json({
                    error: "Autorole settings are not valid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors,
                })
            }

            let roleName = null
            if (req.body.autoroleId) {
                const role = found.guild.roles.cache.get(req.body.autoroleId)
                const reason = role
                    ? roleUnavailableReason(role, found.guild, found.guild.members.me)
                    : "That role no longer exists."
                if (reason) {
                    return res.status(422).json({
                        error: reason,
                        code: "ROLE_UNAVAILABLE",
                        fieldErrors: { autoroleId: [reason] },
                    })
                }
                roleName = role.name
            }

            const saved = await updateGuildConfigAndWait(found.guild.id, {
                autoroleId: req.body.autoroleId,
                autoroleRoleName: roleName,
            })
            res.json({ data: { config: autoroleConfig(saved), enabled: Boolean(saved.autoroleId) } })
        } catch (err) {
            next(err)
        }
    })

    router.use((err, req, res, _next) => {
        const mongoUnavailable = err?.code === "MONGO_UNAVAILABLE" || mongoose.connection.readyState !== 1
        console.error("[dashboard-api] request failed", {
            method: req.method,
            path: req.path,
            error: err?.name || "Error",
            code: err?.code || null,
        })
        res.status(mongoUnavailable ? 503 : 500).json({
            error: mongoUnavailable
                ? "MongoDB is unavailable. Try again shortly."
                : "The bot API could not complete this request.",
            code: mongoUnavailable ? "MONGO_UNAVAILABLE" : "INTERNAL_ERROR",
        })
    })

    return router
}

module.exports = {
    createDashboardRouter,
    validateWelcome,
    validateAutorole,
}
