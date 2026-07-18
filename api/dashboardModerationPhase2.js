const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { getServerConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { normalizePhase2Config, COMMAND_KEYS } = require("../utils/moderationPhase2Config")
const { countPendingTasks } = require("../utils/moderationTasks")
const { getLockedChannelIds } = require("../utils/channelLockState")
const { ModerationCase, getCaseStats } = require("../utils/moderationCases")

const SNOWFLAKE = /^\d{17,20}$/
const HTTP_URL = /^https?:\/\/\S+$/i

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
                canManageMessages: !permissions || permissions.has(PermissionFlagsBits.ManageMessages),
                canManageChannel: me?.permissions.has(PermissionFlagsBits.ManageChannels) === true,
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

function permissionState(guild) {
    const me = guild.members.me
    return {
        manageMessages: me?.permissions.has(PermissionFlagsBits.ManageMessages) === true,
        manageChannels: me?.permissions.has(PermissionFlagsBits.ManageChannels) === true,
        manageNicknames: me?.permissions.has(PermissionFlagsBits.ManageNicknames) === true,
        banMembers: me?.permissions.has(PermissionFlagsBits.BanMembers) === true,
        moderateMembers: me?.permissions.has(PermissionFlagsBits.ModerateMembers) === true,
    }
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateSnowflakeList(value, max) {
    return Array.isArray(value)
        && value.length <= max
        && value.every(item => SNOWFLAKE.test(String(item)))
}

function validateConfig(body, channelIds, roleIds) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }

    const expectedTop = new Set([
        "advancedModerationEnabled",
        "maxPurgeAmount",
        "tempBansEnabled",
        "softbansEnabled",
        "moderatorNotesEnabled",
        "dangerousCommandsAdminOnly",
        "commandToggles",
        "logging",
        "whitelist",
    ])
    for (const key of Object.keys(body)) {
        if (!expectedTop.has(key)) errors[key] = ["Unknown field."]
    }

    for (const key of [
        "advancedModerationEnabled",
        "tempBansEnabled",
        "softbansEnabled",
        "moderatorNotesEnabled",
        "dangerousCommandsAdminOnly",
    ]) {
        if (typeof body[key] !== "boolean") errors[key] = ["Expected a boolean."]
    }

    const maxPurge = Number(body.maxPurgeAmount)
    if (!Number.isInteger(maxPurge) || maxPurge < 1 || maxPurge > 100) {
        errors.maxPurgeAmount = ["Use 1 to 100 messages."]
    }
    if (!isRecord(body.commandToggles)) {
        errors.commandToggles = ["Expected command toggles."]
    } else {
        for (const key of COMMAND_KEYS) {
            if (typeof body.commandToggles[key] !== "boolean") {
                errors[`commandToggles.${key}`] = ["Expected a boolean."]
            }
        }
        for (const key of Object.keys(body.commandToggles)) {
            if (!COMMAND_KEYS.includes(key)) errors[`commandToggles.${key}`] = ["Unknown command."]
        }
    }

    if (!isRecord(body.logging)) {
        errors.logging = ["Expected logging settings."]
    } else {
        for (const key of ["messageDeleteEnabled", "messageEditEnabled", "memberUpdateEnabled", "storeDeletedMessageContent"]) {
            if (typeof body.logging[key] !== "boolean") errors[`logging.${key}`] = ["Expected a boolean."]
        }
        for (const key of ["messageLogChannelId", "memberLogChannelId"]) {
            const value = body.logging[key]
            if (value !== null && !channelIds.has(String(value))) {
                errors[`logging.${key}`] = ["Choose a text channel from this server."]
            }
        }
    }

    if (!isRecord(body.whitelist)) {
        errors.whitelist = ["Expected whitelist settings."]
    } else {
        for (const key of ["enabled", "exemptFromAutomod", "protectFromManualModeration"]) {
            if (typeof body.whitelist[key] !== "boolean") errors[`whitelist.${key}`] = ["Expected a boolean."]
        }
        if (!validateSnowflakeList(body.whitelist.userIds, 100)) errors["whitelist.userIds"] = ["Use up to 100 valid Discord user IDs."]
        if (!validateSnowflakeList(body.whitelist.botIds, 100)) errors["whitelist.botIds"] = ["Use up to 100 valid Discord bot IDs."]
        if (!validateSnowflakeList(body.whitelist.roleIds, 50) || body.whitelist.roleIds.some(id => !roleIds.has(String(id)))) {
            errors["whitelist.roleIds"] = ["Choose up to 50 roles from this server."]
        }
        if (!validateSnowflakeList(body.whitelist.channelIds, 100) || body.whitelist.channelIds.some(id => !channelIds.has(String(id)))) {
            errors["whitelist.channelIds"] = ["Choose up to 100 channels from this server."]
        }
    }
    return errors
}

function actorFromRequest(req) {
    const id = req.get("x-dashboard-user-id")
    return { id: id && SNOWFLAKE.test(id) ? id : null, tag: "Dashboard manager" }
}

async function caseEnhancement(guildId, caseNumber, body, actor) {
    if (mongoose.connection.readyState !== 1) throw Object.assign(new Error("MongoDB is unavailable"), { code: "MONGO_UNAVAILABLE" })
    const number = Number(caseNumber)
    if (!Number.isInteger(number) || number < 1) throw Object.assign(new Error("Invalid case number"), { code: "INVALID_CASE" })

    if (body.operation === "note") {
        const note = String(body.note || "").trim()
        if (!note || note.length > 2000) throw Object.assign(new Error("Note must be 1 to 2000 characters"), { code: "VALIDATION_ERROR" })
        return ModerationCase.findOneAndUpdate(
            { guildId: String(guildId), caseNumber: number, status: { $ne: "deleted" } },
            {
                $push: {
                    "metadata.notes": {
                        text: note,
                        moderatorId: actor.id,
                        moderatorTag: actor.tag,
                        createdAt: new Date(),
                    },
                },
            },
            { new: true }
        ).lean()
    }

    if (body.operation === "evidence") {
        const evidenceUrl = body.evidenceUrl === null ? null : String(body.evidenceUrl || "").trim()
        if (evidenceUrl !== null && (!HTTP_URL.test(evidenceUrl) || evidenceUrl.length > 2048)) {
            throw Object.assign(new Error("Evidence must be an HTTP(S) URL"), { code: "VALIDATION_ERROR" })
        }
        return ModerationCase.findOneAndUpdate(
            { guildId: String(guildId), caseNumber: number, status: { $ne: "deleted" } },
            {
                $set: { evidenceUrl },
                $push: {
                    "metadata.evidenceHistory": {
                        evidenceUrl,
                        moderatorId: actor.id,
                        moderatorTag: actor.tag,
                        changedAt: new Date(),
                    },
                },
            },
            { new: true }
        ).lean()
    }

    throw Object.assign(new Error("Unknown case operation"), { code: "VALIDATION_ERROR" })
}

function serializeDoc(doc) {
    if (!doc) return null
    const value = typeof doc.toObject === "function" ? doc.toObject() : doc
    return {
        id: value._id ? String(value._id) : null,
        guildId: String(value.guildId),
        caseNumber: Number(value.caseNumber),
        action: String(value.action),
        targetId: String(value.targetId),
        targetTag: value.targetTag || "Unknown user",
        moderatorId: value.moderatorId || null,
        moderatorTag: value.moderatorTag || "Auto-Moderation",
        reason: value.reason || "No reason provided",
        durationMs: value.durationMs ?? null,
        evidenceUrl: value.evidenceUrl || null,
        source: value.source || "manual",
        status: value.status || "active",
        expiresAt: value.expiresAt ? new Date(value.expiresAt).toISOString() : null,
        revokedAt: value.revokedAt ? new Date(value.revokedAt).toISOString() : null,
        revokedById: value.revokedById || null,
        revokedByTag: value.revokedByTag || null,
        revokeReason: value.revokeReason || null,
        metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {},
        createdAt: value.createdAt ? new Date(value.createdAt).toISOString() : null,
        updatedAt: value.updatedAt ? new Date(value.updatedAt).toISOString() : null,
    }
}

function createDashboardModerationPhase2Router(getClient) {
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

    router.get("/guilds/:guildId/moderation/advanced", async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const config = normalizePhase2Config(getServerConfig(found.guild.id).config)
            res.json({
                data: {
                    config,
                    channels: textChannels(found.guild),
                    roles: selectableRoles(found.guild),
                    botPermissions: permissionState(found.guild),
                    pendingTasks: await countPendingTasks(found.guild.id),
                    lockedChannelIds: await getLockedChannelIds(found.guild.id),
                    caseStats: await getCaseStats(found.guild.id),
                    mongoConnected: mongoose.connection.readyState === 1,
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.put("/guilds/:guildId/moderation/advanced", writeLimiter, async (req, res, next) => {
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
                    error: "Advanced moderation settings are not valid.",
                    code: "VALIDATION_ERROR",
                    fieldErrors: errors,
                })
            }
            const normalized = normalizePhase2Config({ moderationPhase2: req.body })
            const saved = await updateGuildConfigAndWait(found.guild.id, { moderationPhase2: normalized })
            res.json({
                data: {
                    config: normalizePhase2Config(saved),
                    botPermissions: permissionState(found.guild),
                    pendingTasks: await countPendingTasks(found.guild.id),
                    lockedChannelIds: await getLockedChannelIds(found.guild.id),
                },
            })
        } catch (err) {
            next(err)
        }
    })

    router.patch("/guilds/:guildId/moderation/advanced/cases/:caseNumber", writeLimiter, async (req, res, next) => {
        try {
            const found = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!found) return
            const body = req.body
            if (!isRecord(body) || !["note", "evidence"].includes(body.operation)) {
                return res.status(422).json({ error: "Invalid case operation.", code: "VALIDATION_ERROR" })
            }
            const updated = await caseEnhancement(
                found.guild.id,
                req.params.caseNumber,
                body,
                actorFromRequest(req)
            )
            if (!updated) return res.status(404).json({ error: "Case not found.", code: "CASE_NOT_FOUND" })
            res.json({ data: { case: serializeDoc(updated), stats: await getCaseStats(found.guild.id) } })
        } catch (err) {
            if (err.code === "VALIDATION_ERROR" || err.code === "INVALID_CASE") {
                return res.status(422).json({ error: err.message, code: err.code })
            }
            next(err)
        }
    })

    router.use((err, _req, res, _next) => {
        console.error("Advanced moderation dashboard API error:", err.message)
        const status = err.code === "MONGO_UNAVAILABLE" ? 503 : 500
        res.status(status).json({
            error: status === 503 ? "MongoDB is unavailable." : "Advanced moderation request failed.",
            code: err.code || "INTERNAL_ERROR",
        })
    })

    return router
}

module.exports = {
    createDashboardModerationPhase2Router,
    validateConfig,
}
