const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const {
    LOG_CATEGORY_KEYS,
    HEX_COLOR,
    normalizeLogsConfig,
} = require("../utils/loggingConfig")

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

function textChannels(guild) {
    const me = guild.members.me
    return [...guild.channels.cache.values()]
        .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => {
            const permissions = me ? channel.permissionsFor(me) : null
            const canView = !permissions || permissions.has(PermissionFlagsBits.ViewChannel)
            const canSend = !permissions || permissions.has(PermissionFlagsBits.SendMessages)
            const canEmbed = !permissions || permissions.has(PermissionFlagsBits.EmbedLinks)
            return {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                parent_id: channel.parentId || null,
                position: channel.rawPosition,
                canView,
                canSend,
                canEmbed,
            }
        })
        .filter(channel => channel.canView && channel.canSend)
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateConfig(body, channels) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }

    const expected = new Set(LOG_CATEGORY_KEYS)
    for (const key of Object.keys(body)) {
        if (!expected.has(key)) errors[key] = ["Unknown logging category."]
    }

    const channelIds = new Set(channels.map(channel => channel.id))
    for (const key of LOG_CATEGORY_KEYS) {
        const category = body[key]
        if (!isRecord(category)) {
            errors[key] = ["Expected logging settings for this category."]
            continue
        }

        for (const booleanKey of ["enabled", "embed", "ignoreBots", "includeContent"]) {
            if (typeof category[booleanKey] !== "boolean") {
                errors[key] = [`${booleanKey} must be true or false.`]
                break
            }
        }
        if (errors[key]) continue

        if (!HEX_COLOR.test(String(category.color || ""))) {
            errors[key] = ["Choose a valid six-digit hex color."]
            continue
        }

        const channelId = category.channelId == null ? null : String(category.channelId)
        if (channelId !== null && !channelIds.has(channelId)) {
            errors[key] = ["Choose a text channel where CURSED can send messages."]
            continue
        }
        if (category.enabled === true && !channelId) {
            errors[key] = ["Choose a log channel before enabling this category."]
        }
    }

    return errors
}

function synchronizedPatch(rawConfig, normalized) {
    const existingPhase2 = isRecord(rawConfig.moderationPhase2) ? rawConfig.moderationPhase2 : {}
    const existingPhase2Logging = isRecord(existingPhase2.logging) ? existingPhase2.logging : {}
    const existingSecurity = isRecord(rawConfig.securityPhase3) ? rawConfig.securityPhase3 : {}
    const existingTickets = isRecord(rawConfig.tickets) ? rawConfig.tickets : {}

    const messageFallbackChannel = normalized.messageDelete.channelId || normalized.messageEdit.channelId || null
    const phase2Logging = {
        ...existingPhase2Logging,
        messageDeleteEnabled: normalized.messageDelete.enabled,
        messageEditEnabled: normalized.messageEdit.enabled,
        memberUpdateEnabled: normalized.memberNicknameChange.enabled,
        storeDeletedMessageContent: normalized.messageDelete.includeContent,
        messageLogChannelId: messageFallbackChannel,
        memberLogChannelId: normalized.memberNicknameChange.channelId || null,
    }

    return {
        logs: normalized,
        moderationPhase2: {
            ...existingPhase2,
            logging: phase2Logging,
        },
        modLogChannelId: normalized.moderationAction.enabled
            ? normalized.moderationAction.channelId
            : null,
        securityPhase3: {
            ...existingSecurity,
            securityLogChannelId: normalized.securityAlert.enabled
                ? normalized.securityAlert.channelId
                : null,
        },
        tickets: {
            ...existingTickets,
            logChannelId: normalized.ticketEvent.enabled
                ? normalized.ticketEvent.channelId
                : null,
        },
    }
}

function createDashboardLoggingRouter(getClient) {
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

    router.use(originGuard)
    router.use(readLimiter)
    router.use(dashboardAuth)

    router.get("/guilds/:guildId/logs", (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const rawConfig = getServerConfig(guild.id).config
            return res.json({
                config: normalizeLogsConfig(rawConfig),
                channels: textChannels(guild),
            })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/logs", writeLimiter, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const channels = textChannels(guild)
            const errors = validateConfig(req.body, channels)
            if (Object.keys(errors).length) {
                return res.status(422).json({
                    error: "Logging settings are not valid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors: errors,
                })
            }

            const normalized = normalizeLogsConfig({ logs: req.body })
            const rawConfig = getServerConfig(guild.id).config
            const saved = await updateGuildConfigAndWait(
                guild.id,
                synchronizedPatch(rawConfig, normalized)
            )

            return res.json({
                config: normalizeLogsConfig(saved),
                channels,
            })
        } catch (err) {
            next(err)
        }
    })

    return router
}

module.exports = {
    createDashboardLoggingRouter,
    validateConfig,
    textChannels,
    synchronizedPatch,
}
