const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { normalizeModerationConfig } = require("../utils/moderationConfig")
const {
    listCases,
    getCaseStats,
    updateCaseReason,
    revokeCase,
    softDeleteCase,
} = require("../utils/moderationCases")

const SNOWFLAKE = /^\d{17,20}$/
const CONFIG_KEYS = new Set([
    "moderationCommandsEnabled",
    "moderatorRoleIds",
    "modLogChannelId",
    "defaultTimeoutMinutes",
    "dmPunishedUsers",
    "requireModerationReason",
    "warningEscalationEnabled",
    "warningThresholds",
    "antiSpam",
    "antiLink",
    "antiInvite",
    "linkWhitelist",
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
                canEmbed: !permissions || permissions.has(PermissionFlagsBits.EmbedLinks),
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
        }))
}

function botPermissionState(guild, config) {
    const me = guild.members.me
    const logChannel = config.modLogChannelId ? guild.channels.cache.get(config.modLogChannelId) : null
    const logPermissions = logChannel && me ? logChannel.permissionsFor(me) : null
    return {
        moderateMembers: me?.permissions.has(PermissionFlagsBits.ModerateMembers) === true,
        kickMembers: me?.permissions.has(PermissionFlagsBits.KickMembers) === true,
        banMembers: me?.permissions.has(PermissionFlagsBits.BanMembers) === true,
        manageMessages: me?.permissions.has(PermissionFlagsBits.ManageMessages) === true,
        manageChannels: me?.permissions.has(PermissionFlagsBits.ManageChannels) === true,
        viewAuditLog: me?.permissions.has(PermissionFlagsBits.ViewAuditLog) === true,
        logChannelReady: Boolean(
            logChannel?.isTextBased?.()
            && logPermissions?.has(PermissionFlagsBits.ViewChannel)
            && logPermissions?.has(PermissionFlagsBits.SendMessages)
            && logPermissions?.has(PermissionFlagsBits.EmbedLinks)
        ),
        botHighestRolePosition: me?.roles.highest.position || 0,
    }
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateConfig(body, channelIds, roleIds) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    for (const key of Object.keys(body)) {
        if (!CONFIG_KEYS.has(key)) errors[key] = ["Unknown field."]
    }

    const booleans = [
        "moderationCommandsEnabled",
        "dmPunishedUsers",
        "requireModerationReason",
        "warningEscalationEnabled",
        "antiSpam",
        "antiLink",
        "antiInvite",
    ]
    for (const key of booleans) {
        if (typeof body[key] !== "boolean") errors[key] = ["Expected a boolean."]
    }

    if (!Array.isArray(body.moderatorRoleIds) || body.moderatorRoleIds.some(id => !roleIds.has(String(id)))) {
        errors.moderatorRoleIds = ["Choose moderator roles from this server."]
    }
    if (body.modLogChannelId !== null && !channelIds.has(String(body.modLogChannelId))) {
        errors.modLogChannelId = ["Choose a text channel from this server."]
    }
    const timeout = Number(body.defaultTimeoutMinutes)
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 40320) {
        errors.defaultTimeoutMinutes = ["Use 1 to 40320 minutes."]
    }
    if (!Array.isArray(body.linkWhitelist) || body.linkWhitelist.length > 100 || body.linkWhitelist.some(item => typeof item !== "string" || item.length > 253)) {
        errors.linkWhitelist = ["Use up to 100 valid domain names."]
    }
    if (!Array.isArray(body.warningThresholds) || body.warningThresholds.length > 10) {
        errors.warningThresholds = ["Use up to 10 warning thresholds."]
    } else {
        const seen = new Set()
        for (let index = 0; index < body.warningThresholds.length; index += 1) {
            const item = body.warningThresholds[index]
            if (!isRecord(item)) {
                errors[`warningThresholds.${index}`] = ["Expected a threshold object."]
                continue
            }
            const warnings = Number(item.warnings)
            if (!Number.isInteger(warnings) || warnings < 1 || warnings > 100 || seen.has(warnings)) {
                errors[`warningThresholds.${index}.warnings`] = ["Use a unique warning count from 1 to 100."]
            }
            seen.add(warnings)
            if (!["timeout", "kick", "ban"].includes(item.action)) {
                errors[`warningThresholds.${index}.action`] = ["Choose timeout, kick, or ban."]
            }
            if (item.action === "timeout") {
                const duration = Number(item.durationMinutes)
                if (!Number.isInteger(duration) || duration < 1 || duration > 40320) {
                    errors[`warningThresholds.${index}.durationMinutes`] = ["Use 1 to 40320 minutes."]
                }
            }
        }
    }
    return errors
}

function actorFromRequest(req) {
    const id = req.get("x-dashboard-user-id")
    return {
        id: id && SNOWFLAKE.test(id) ? id : null,
        tag: "Dashboard manager",
    }
}

function createDashboardModerationRouter(getClient) {
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

    router.get("/guilds/:guildId/moderation", async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const config = normalizeModerationConfig(getServerConfig(found.guild.id).config)
            const cases = await listCases(found.guild.id, { limit: 25 })
            res.json({
                data: {
                    config,
                    channels: textChannels(found.guild),
                    roles: selectableRoles(found.guild),
                    botPermissions: botPermissionState(found.guild, config),
                    stats: await getCaseStats(found.guild.id),
                    cases,
                    mongoConnected: mongoose.connection.readyState === 1,
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/moderation", writeLimiter, async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const channels = textChannels(found.guild)
            const roles = selectableRoles(found.guild)
            const errors = validateConfig(
                req.body,
                new Set(channels.map(channel => channel.id)),
                new Set(roles.map(role => role.id))
            )
            if (Object.keys(errors).length) {
                return res.status(422).json({
                    error: "Moderation settings are not valid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors: errors,
                })
            }
            const config = normalizeModerationConfig(req.body)
            const saved = await updateGuildConfigAndWait(found.guild.id, config)
            const normalized = normalizeModerationConfig(saved)
            res.json({
                data: {
                    config: normalized,
                    botPermissions: botPermissionState(found.guild, normalized),
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.get("/guilds/:guildId/moderation/cases", async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25))
            const cases = await listCases(found.guild.id, {
                limit,
                targetId: req.query.targetId || null,
                action: req.query.action || null,
                status: req.query.status || null,
                beforeCaseNumber: req.query.before || null,
            })
            res.json({ data: { cases, stats: await getCaseStats(found.guild.id) } })
        } catch (err) {
            next(err)
        }
    })

    router.patch("/guilds/:guildId/moderation/cases/:caseNumber", writeLimiter, async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const caseNumber = Number(req.params.caseNumber)
            if (!Number.isInteger(caseNumber) || caseNumber < 1) {
                return res.status(400).json({ error: "Invalid case number.", code: "INVALID_CASE_NUMBER" })
            }
            const operation = String(req.body?.operation || "")
            const actor = actorFromRequest(req)
            let record = null
            if (operation === "reason") {
                const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : ""
                if (!reason || reason.length > 2000) {
                    return res.status(422).json({ error: "Reason must be 1 to 2000 characters.", code: "VALIDATION_ERROR" })
                }
                record = await updateCaseReason(found.guild.id, caseNumber, reason, actor)
            } else if (operation === "revoke") {
                const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null
                if (reason && reason.length > 1000) {
                    return res.status(422).json({ error: "Revocation reason is too long.", code: "VALIDATION_ERROR" })
                }
                record = await revokeCase(found.guild.id, caseNumber, actor, reason)
            } else if (operation === "delete") {
                record = await softDeleteCase(found.guild.id, caseNumber, actor)
            } else {
                return res.status(422).json({ error: "Unknown case operation.", code: "VALIDATION_ERROR" })
            }
            if (!record) return res.status(404).json({ error: "Case not found or operation is not available.", code: "CASE_NOT_FOUND" })
            res.json({ data: { case: record, stats: await getCaseStats(found.guild.id) } })
        } catch (err) {
            next(err)
        }
    })

    router.use((err, req, res, _next) => {
        const mongoUnavailable = err?.code === "MONGO_UNAVAILABLE" || mongoose.connection.readyState !== 1
        console.error("[dashboard-moderation-api] request failed", {
            method: req.method,
            path: req.path,
            error: err?.name || "Error",
            code: err?.code || null,
        })
        res.status(mongoUnavailable ? 503 : 500).json({
            error: mongoUnavailable
                ? "MongoDB is unavailable. Try again shortly."
                : "The moderation API could not complete this request.",
            code: mongoUnavailable ? "MONGO_UNAVAILABLE" : "INTERNAL_ERROR",
        })
    })

    return router
}

module.exports = { createDashboardModerationRouter, validateConfig }
