const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { ChannelType } = require("discord.js")
const {
    parseBirthdayInput,
    validateBirthday,
    validateTimezone,
    getBirthdayConfig,
    updateBirthdayConfig,
    upsertBirthday,
    listBirthdays,
    removeBirthday,
    formatBirthday,
} = require("../utils/birthdays")

const SNOWFLAKE = /^\d{17,20}$/

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ""))
    const y = Buffer.from(String(b || ""))
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

function auth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    const provided = (req.get("authorization") || "").replace(/^Bearer /, "")
    if (!secret) return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    if (!safeEqual(provided, secret)) return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    next()
}

function origin(req, res, next) {
    res.set("Cache-Control", "no-store")
    const incoming = req.get("origin")
    const dashboard = process.env.DASHBOARD_URL
    if (incoming && (!dashboard || incoming !== dashboard)) return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    next()
}

function guildOr(getClient, id, res) {
    if (!SNOWFLAKE.test(id || "")) {
        res.status(400).json({ error: "Invalid guild ID.", code: "INVALID_GUILD_ID" })
        return null
    }
    const client = getClient()
    if (!client?.isReady()) {
        res.status(503).json({ error: "Bot is not ready.", code: "BOT_NOT_READY" })
        return null
    }
    const guild = client.guilds.cache.get(id)
    if (!guild) {
        res.status(404).json({ error: "CURSED is not added to this server.", code: "BOT_NOT_IN_GUILD" })
        return null
    }
    return guild
}

function normalizeSettings(body = {}, current = {}) {
    const timezone = body.timezone == null ? current.timezone : String(body.timezone)
    if (!validateTimezone(timezone)) {
        const err = new Error("Use a valid IANA timezone such as Asia/Kolkata.")
        err.code = "INVALID_TIMEZONE"
        throw err
    }
    const channelId = body.announcementChannelId == null || body.announcementChannelId === ""
        ? null
        : String(body.announcementChannelId)
    if (channelId && !SNOWFLAKE.test(channelId)) {
        const err = new Error("Select a valid announcement channel.")
        err.code = "INVALID_CHANNEL"
        throw err
    }
    return {
        enabled: body.enabled !== false,
        announcementChannelId: channelId,
        timezone,
        dmEnabled: body.dmEnabled !== false,
        announcementEnabled: body.announcementEnabled !== false,
        announcementTemplate: body.announcementTemplate == null ? current.announcementTemplate : String(body.announcementTemplate).slice(0, 1500),
        dmTemplate: body.dmTemplate == null ? current.dmTemplate : String(body.dmTemplate).slice(0, 1500),
    }
}

async function payload(guild) {
    const [config, entries] = await Promise.all([
        getBirthdayConfig(guild.id),
        listBirthdays(guild.id),
    ])
    const birthdays = await Promise.all(entries.map(async entry => {
        const member = guild.members.cache.get(entry.userId) || await guild.members.fetch(entry.userId).catch(() => null)
        return {
            ...entry,
            displayName: member?.displayName || member?.user?.globalName || member?.user?.username || `Unknown member (${entry.userId})`,
            username: member?.user?.username || null,
            avatarUrl: member?.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || null,
            inGuild: Boolean(member),
            publicDate: formatBirthday(entry),
        }
    }))
    return {
        config,
        birthdays,
        channels: [...guild.channels.cache.values()]
            .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .map(channel => ({ id: channel.id, name: channel.name, type: channel.type })),
        guild: { id: guild.id, name: guild.name },
    }
}

function parseEntryBody(body = {}) {
    if (body.date) {
        const parsed = parseBirthdayInput(body.date)
        if (!parsed.ok) {
            const err = new Error(parsed.error)
            err.code = "INVALID_BIRTHDAY"
            throw err
        }
        return parsed
    }
    const day = Number(body.day)
    const month = Number(body.month)
    const year = body.year == null || body.year === "" ? null : Number(body.year)
    if (!validateBirthday(day, month, year)) {
        const err = new Error("Enter a valid birthday date.")
        err.code = "INVALID_BIRTHDAY"
        throw err
    }
    return { day, month, year }
}

function createDashboardBirthdaysRouter(getClient) {
    const router = express.Router()
    router.use(origin, auth, rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }))

    router.get("/guilds/:guildId/birthdays", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            res.json({ data: await payload(guild) })
        } catch (err) {
            console.error("Birthday dashboard load error:", err.message)
            res.status(500).json({ error: "Could not load birthday settings.", code: "BIRTHDAY_LOAD_FAILED" })
        }
    })

    router.put("/guilds/:guildId/birthdays/settings", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            const current = await getBirthdayConfig(guild.id)
            const settings = normalizeSettings(req.body, current)
            if (settings.announcementChannelId) {
                const channel = guild.channels.cache.get(settings.announcementChannelId)
                if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
                    return res.status(422).json({ error: "The selected birthday channel is unavailable.", code: "INVALID_CHANNEL" })
                }
            }
            await updateBirthdayConfig(guild.id, settings, req.get("x-dashboard-user-id"))
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: err.code || "BIRTHDAY_SETTINGS_SAVE_FAILED" })
        }
    })

    router.post("/guilds/:guildId/birthdays", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        const userId = String(req.body?.userId || "")
        if (!SNOWFLAKE.test(userId)) return res.status(422).json({ error: "Enter a valid Discord user ID.", code: "INVALID_USER_ID" })
        try {
            const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null)
            if (!member) return res.status(422).json({ error: "That user is not currently a member of this server.", code: "MEMBER_NOT_FOUND" })
            const birthday = parseEntryBody(req.body)
            await upsertBirthday(guild.id, userId, birthday, req.get("x-dashboard-user-id"))
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: err.code || "BIRTHDAY_SAVE_FAILED" })
        }
    })

    router.delete("/guilds/:guildId/birthdays/:userId", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        if (!SNOWFLAKE.test(req.params.userId || "")) return res.status(422).json({ error: "Invalid user ID.", code: "INVALID_USER_ID" })
        try {
            await removeBirthday(guild.id, req.params.userId)
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(500).json({ error: err.message, code: "BIRTHDAY_DELETE_FAILED" })
        }
    })

    return router
}

module.exports = { createDashboardBirthdaysRouter, normalizeSettings, parseEntryBody }
