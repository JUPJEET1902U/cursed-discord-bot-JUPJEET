const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getGuildConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { getStatus: getAIStatus } = require("../utils/ai")
const {
    CONTROL_MODULES,
    CONTROL_MODULE_KEYS,
    getControlCommands,
    normalizeControlConfig,
} = require("../utils/dashboardControl")
const {
    LevelingConfig,
    LevelingMember,
    getLevelingConfig,
    clearGuildLevelingCache,
} = require("../utils/leveling")

const SNOWFLAKE = /^\d{17,20}$/
const CONTROL_KEYS = new Set([
    "channelRestrictionEnabled", "allowedChannels", "aiEnabled", "aiMaxTokens",
    "aiRateLimit", "aiRateWindowSeconds", "aiMemoryEnabled",
    "aiLongTermMemoryEnabled", "aiCustomPrompt", "legacyEconomyXpEnabled",
    "moderationCommandsEnabled", "disabledModules", "disabledCommands",
    "antiSpam", "antiLink", "antiInvite", "linkWhitelist", "modLogChannelId",
    "premiumRoleId", "paymentLinks",
])
const LEVELING_KEYS = new Set([
    "enabled", "levelUpChannelId", "ignoredChannelIds", "xpMin", "xpMax",
    "cooldownSeconds", "announceLevelUps",
])

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function dashboardAuth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    if (!secret) {
        return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    }
    const authorization = req.get("authorization") || ""
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
    if (!safeEqual(provided, secret)) {
        return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    }
    next()
}

function dashboardHeaders(req, res, next) {
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

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function usableTextChannels(guild) {
    const me = guild.members.me
    return [...guild.channels.cache.values()]
        .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .filter(channel => {
            const permissions = me ? channel.permissionsFor(me) : null
            return !permissions || permissions.has(PermissionFlagsBits.ViewChannel)
        })
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId || null,
            position: channel.rawPosition,
            canSend: me ? channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages) === true : false,
        }))
}

function manageableRoles(guild) {
    const me = guild.members.me
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.color,
            position: role.position,
            managed: role.managed,
            assignable: Boolean(
                me &&
                me.permissions.has(PermissionFlagsBits.ManageRoles) &&
                role.position < me.roles.highest.position
            ),
        }))
}

function publicLevelingConfig(config) {
    return {
        enabled: config.enabled === true,
        levelUpChannelId: config.levelUpChannelId || null,
        ignoredChannelIds: Array.isArray(config.ignoredChannelIds) ? config.ignoredChannelIds : [],
        xpMin: Number(config.xpMin),
        xpMax: Number(config.xpMax),
        cooldownSeconds: Number(config.cooldownSeconds),
        announceLevelUps: config.announceLevelUps !== false,
        trackingStartedAt: config.trackingStartedAt || null,
    }
}

async function getLevelingStats(guildId) {
    if (mongoose.connection.readyState !== 1) {
        return { available: false, members: 0, totalXp: 0, totalMessages: 0 }
    }
    const rows = await LevelingMember.aggregate([
        { $match: { guildId: String(guildId) } },
        {
            $group: {
                _id: null,
                members: { $sum: 1 },
                totalXp: { $sum: "$xp" },
                totalMessages: { $sum: "$messageCount" },
            },
        },
    ])
    const row = rows[0] || {}
    return {
        available: true,
        members: Number(row.members || 0),
        totalXp: Number(row.totalXp || 0),
        totalMessages: Number(row.totalMessages || 0),
    }
}

async function saveLevelingConfig(guildId, requested) {
    if (mongoose.connection.readyState !== 1) {
        const error = new Error("MongoDB is unavailable")
        error.code = "MONGO_UNAVAILABLE"
        throw error
    }
    const current = await getLevelingConfig(guildId, { fresh: true })
    const doc = await LevelingConfig.findOneAndUpdate(
        { guildId: String(guildId) },
        {
            $set: {
                enabled: requested.enabled,
                levelUpChannelId: requested.levelUpChannelId,
                ignoredChannelIds: [...new Set(requested.ignoredChannelIds.map(String))],
                xpMin: requested.xpMin,
                xpMax: requested.xpMax,
                cooldownSeconds: requested.cooldownSeconds,
                announceLevelUps: requested.announceLevelUps,
                trackingStartedAt: requested.enabled
                    ? (current.trackingStartedAt || new Date())
                    : current.trackingStartedAt,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    clearGuildLevelingCache(guildId)
    return getLevelingConfig(guildId, { fresh: true }).then(config => config || doc)
}

function validateUrl(value) {
    if (value === null || value === undefined || value === "") return true
    try {
        const url = new URL(String(value))
        return ["http:", "https:"].includes(url.protocol)
    } catch {
        return false
    }
}

function validatePayload(body, channelIds, roleIds) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    if (!isRecord(body.config)) errors.config = ["Expected a configuration object."]
    if (!isRecord(body.leveling)) errors.leveling = ["Expected a leveling object."]
    if (Object.keys(errors).length) return errors

    for (const key of Object.keys(body.config)) {
        if (!CONTROL_KEYS.has(key)) errors[`config.${key}`] = ["Unknown field."]
    }
    for (const key of Object.keys(body.leveling)) {
        if (!LEVELING_KEYS.has(key)) errors[`leveling.${key}`] = ["Unknown field."]
    }

    const config = body.config
    const leveling = body.leveling
    const booleanFields = [
        "channelRestrictionEnabled", "aiEnabled", "aiMemoryEnabled",
        "aiLongTermMemoryEnabled", "legacyEconomyXpEnabled",
        "moderationCommandsEnabled", "antiSpam", "antiLink", "antiInvite",
    ]
    for (const field of booleanFields) {
        if (typeof config[field] !== "boolean") errors[`config.${field}`] = ["Expected a boolean."]
    }

    if (!Array.isArray(config.allowedChannels) || config.allowedChannels.some(id => !channelIds.has(String(id)))) {
        errors["config.allowedChannels"] = ["Choose channels from this server."]
    }
    if (!Array.isArray(config.disabledModules) || config.disabledModules.some(key => !CONTROL_MODULE_KEYS.has(String(key)))) {
        errors["config.disabledModules"] = ["Contains an unknown feature module."]
    }
    if (!Array.isArray(config.disabledCommands) || config.disabledCommands.length > 250) {
        errors["config.disabledCommands"] = ["Expected up to 250 command names."]
    }
    if (!Array.isArray(config.linkWhitelist) || config.linkWhitelist.length > 100) {
        errors["config.linkWhitelist"] = ["Expected up to 100 domains."]
    }
    if (config.modLogChannelId !== null && !channelIds.has(String(config.modLogChannelId))) {
        errors["config.modLogChannelId"] = ["Choose a channel from this server."]
    }
    if (config.premiumRoleId !== null && !roleIds.has(String(config.premiumRoleId))) {
        errors["config.premiumRoleId"] = ["Choose a role CURSED can assign."]
    }

    const aiMaxTokens = Number(config.aiMaxTokens)
    const aiRateLimit = Number(config.aiRateLimit)
    const aiRateWindowSeconds = Number(config.aiRateWindowSeconds)
    if (!Number.isInteger(aiMaxTokens) || aiMaxTokens < 100 || aiMaxTokens > 1500) errors["config.aiMaxTokens"] = ["Use 100 to 1500."]
    if (!Number.isInteger(aiRateLimit) || aiRateLimit < 1 || aiRateLimit > 30) errors["config.aiRateLimit"] = ["Use 1 to 30."]
    if (!Number.isInteger(aiRateWindowSeconds) || aiRateWindowSeconds < 10 || aiRateWindowSeconds > 600) errors["config.aiRateWindowSeconds"] = ["Use 10 to 600 seconds."]
    if (config.aiCustomPrompt !== null && (typeof config.aiCustomPrompt !== "string" || config.aiCustomPrompt.length > 2000)) errors["config.aiCustomPrompt"] = ["Use 2000 characters or fewer."]

    if (!isRecord(config.paymentLinks)) {
        errors["config.paymentLinks"] = ["Expected payment link fields."]
    } else {
        for (const key of ["kofi", "patreon", "bmc"]) {
            if (!validateUrl(config.paymentLinks[key])) errors[`config.paymentLinks.${key}`] = ["Enter a valid http(s) URL or leave it blank."]
        }
    }

    if (typeof leveling.enabled !== "boolean") errors["leveling.enabled"] = ["Expected a boolean."]
    if (typeof leveling.announceLevelUps !== "boolean") errors["leveling.announceLevelUps"] = ["Expected a boolean."]
    if (leveling.levelUpChannelId !== null && !channelIds.has(String(leveling.levelUpChannelId))) errors["leveling.levelUpChannelId"] = ["Choose a channel from this server."]
    if (leveling.enabled && !leveling.levelUpChannelId) errors["leveling.levelUpChannelId"] = ["Choose a level-up channel before enabling leveling."]
    if (!Array.isArray(leveling.ignoredChannelIds) || leveling.ignoredChannelIds.some(id => !channelIds.has(String(id)))) errors["leveling.ignoredChannelIds"] = ["Choose ignored channels from this server."]

    const xpMin = Number(leveling.xpMin)
    const xpMax = Number(leveling.xpMax)
    const cooldown = Number(leveling.cooldownSeconds)
    if (!Number.isInteger(xpMin) || xpMin < 1 || xpMin > 1000) errors["leveling.xpMin"] = ["Use 1 to 1000 XP."]
    if (!Number.isInteger(xpMax) || xpMax < xpMin || xpMax > 1000) errors["leveling.xpMax"] = ["Maximum XP must be at least the minimum and no more than 1000."]
    if (!Number.isInteger(cooldown) || cooldown < 5 || cooldown > 3600) errors["leveling.cooldownSeconds"] = ["Use 5 to 3600 seconds."]
    return errors
}

function normalizePaymentLinks(paymentLinks) {
    const result = {}
    for (const key of ["kofi", "patreon", "bmc"]) {
        const value = paymentLinks?.[key]
        result[key] = typeof value === "string" && value.trim() ? value.trim() : null
    }
    return result
}

function createDashboardControlRouter(getClient) {
    const router = express.Router()
    const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 180, standardHeaders: true, legacyHeaders: false })
    const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false })
    const middleware = [dashboardHeaders, readLimiter, dashboardAuth]

    router.get("/guilds/:guildId/control-center", ...middleware, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const rawConfig = getGuildConfig(guild.id)
            const leveling = await getLevelingConfig(guild.id, { fresh: true })
            const ai = getAIStatus()
            res.json({
                data: {
                    config: normalizeControlConfig(rawConfig),
                    leveling: publicLevelingConfig(leveling),
                    levelingStats: await getLevelingStats(guild.id),
                    channels: usableTextChannels(guild),
                    roles: manageableRoles(guild),
                    modules: CONTROL_MODULES,
                    commands: getControlCommands(),
                    aiProviders: {
                        gemini: ai.geminiConfigured,
                        groq: ai.groqConfigured,
                        openRouter: ai.openRouterConfigured,
                    },
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/control-center", dashboardHeaders, writeLimiter, dashboardAuth, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const channels = usableTextChannels(guild)
            const roles = manageableRoles(guild)
            const channelIds = new Set(channels.map(channel => channel.id))
            const roleIds = new Set(roles.filter(role => role.assignable).map(role => role.id))
            const currentPremiumRoleId = getGuildConfig(guild.id).premiumRoleId
            if (currentPremiumRoleId) roleIds.add(String(currentPremiumRoleId))

            const fieldErrors = validatePayload(req.body, channelIds, roleIds)
            if (Object.keys(fieldErrors).length > 0) {
                return res.status(422).json({ error: "Control center settings are not valid.", code: "VALIDATION_ERROR", fieldErrors })
            }

            const normalized = normalizeControlConfig({
                ...req.body.config,
                paymentLinks: normalizePaymentLinks(req.body.config.paymentLinks),
            })
            const saved = await updateGuildConfigAndWait(guild.id, normalized)
            const leveling = await saveLevelingConfig(guild.id, req.body.leveling)
            res.json({
                data: {
                    config: normalizeControlConfig(saved),
                    leveling: publicLevelingConfig(leveling),
                    levelingStats: await getLevelingStats(guild.id),
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.use((err, req, res, _next) => {
        const mongoUnavailable = err?.code === "MONGO_UNAVAILABLE" || mongoose.connection.readyState !== 1
        console.error("[dashboard-control-api] request failed", {
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

module.exports = { createDashboardControlRouter, validatePayload }
