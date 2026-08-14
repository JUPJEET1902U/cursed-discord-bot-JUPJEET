const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { getGuildConfig, updateGuildConfigAndWait } = require("../utils/serverConfig")
const { isGuildPremium } = require("../utils/serverPremium")
const { resolveAppearanceImage } = require("../utils/serverAppearanceMedia")

const SNOWFLAKE = /^\d{17,20}$/
const APPEARANCE_FIELDS = new Set(["avatar", "banner", "bio"])
const BIO_MAX_LENGTH = 190

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
    if (origin && (!dashboardUrl || origin !== dashboardUrl)) return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
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

function validateAppearance(body) {
    const errors = {}
    if (!isRecord(body)) return { body: ["Expected a JSON object."] }
    const keys = Object.keys(body)
    if (!keys.length) return { body: ["Choose at least one appearance field to update."] }
    for (const key of keys) if (!APPEARANCE_FIELDS.has(key)) errors[key] = ["Unknown appearance field."]

    for (const mediaField of ["avatar", "banner"]) {
        if (!(mediaField in body)) continue
        const value = body[mediaField]
        if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 3_000_000)) {
            errors[mediaField] = ["Choose a valid image URL/upload or reset this field."]
        }
    }

    if ("bio" in body) {
        if (body.bio !== null && typeof body.bio !== "string") errors.bio = ["Bio must be text or null."]
        else if (typeof body.bio === "string" && body.bio.length > BIO_MAX_LENGTH) errors.bio = [`Bio must be ${BIO_MAX_LENGTH} characters or fewer.`]
    }
    return errors
}

async function fetchCurrentMember(guild) {
    const clientId = guild.client.user?.id
    if (!clientId) return guild.members.me
    return guild.members.fetch({ user: clientId, force: true }).catch(() => guild.members.me)
}

function serializeAppearance(guild, member, config = {}) {
    const globalAvatarUrl = guild.client.user?.displayAvatarURL?.({ size: 512 }) || null
    const globalBannerUrl = guild.client.user?.bannerURL?.({ size: 1024 }) || null
    const avatarUrl = member?.displayAvatarURL?.({ size: 512 }) || globalAvatarUrl
    const customAvatarUrl = member?.avatarURL?.({ size: 512 }) || null
    const customBannerUrl = member?.bannerURL?.({ size: 1024 }) || null
    const effectiveBannerUrl = member?.displayBannerURL?.({ size: 1024 }) || customBannerUrl || globalBannerUrl
    const bio = typeof config.serverAppearanceBio === "string" && config.serverAppearanceBio.length
        ? config.serverAppearanceBio
        : null

    return {
        premium: isGuildPremium(guild),
        profile: {
            avatarUrl,
            bannerUrl: effectiveBannerUrl || null,
            globalAvatarUrl,
            globalBannerUrl,
            customAvatarUrl,
            customBannerUrl,
            bio,
            hasCustomAvatar: Boolean(member?.avatar),
            hasCustomBanner: Boolean(member?.banner),
            hasCustomBio: Boolean(bio),
            hasCustomAppearance: Boolean(member?.avatar || member?.banner || bio),
        },
        limits: {
            bioMaxLength: BIO_MAX_LENGTH,
            localUploadBytes: 170 * 1024,
            remoteImageBytes: 2 * 1024 * 1024,
            acceptedTypes: ["image/jpeg", "image/png", "image/gif"],
        },
    }
}

async function rollbackBio(guildId, previousBio) {
    try { await updateGuildConfigAndWait(guildId, { serverAppearanceBio: previousBio || null }) }
    catch (err) { console.error(`[dashboard-appearance-api] bio rollback failed (${guildId}):`, err.message) }
}

function createDashboardAppearanceRouter(getClient) {
    const router = express.Router({ mergeParams: true })
    const readLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false })
    const writeLimiter = rateLimit({
        windowMs: 15 * 60_000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many appearance updates. Try again later.", code: "RATE_LIMITED" },
    })

    router.use(originGuard)
    router.use(readLimiter)
    router.use(dashboardAuth)

    router.get("/", async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            const member = await fetchCurrentMember(guild)
            if (!member) return res.status(503).json({ error: "CURSED member profile is unavailable.", code: "MEMBER_UNAVAILABLE" })
            return res.json({ data: serializeAppearance(guild, member, getGuildConfig(guild.id)) })
        } catch (err) { next(err) }
    })

    router.put("/", writeLimiter, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return
            if (!isGuildPremium(guild)) {
                return res.status(403).json({
                    error: "Per-server CURSED appearance is a Premium feature.",
                    code: "PREMIUM_REQUIRED",
                })
            }

            const fieldErrors = validateAppearance(req.body)
            if (Object.keys(fieldErrors).length) {
                return res.status(422).json({ error: "Appearance settings are not valid.", code: "VALIDATION_ERROR", fieldErrors })
            }

            const options = { reason: "CURSED dashboard server appearance update" }
            if ("avatar" in req.body) options.avatar = req.body.avatar === null ? null : await resolveAppearanceImage(req.body.avatar)
            if ("banner" in req.body) options.banner = req.body.banner === null ? null : await resolveAppearanceImage(req.body.banner)
            if ("bio" in req.body) options.bio = req.body.bio === null ? null : req.body.bio.trim()

            const previousConfig = getGuildConfig(guild.id)
            const previousBio = previousConfig.serverAppearanceBio || null
            if ("bio" in req.body) await updateGuildConfigAndWait(guild.id, { serverAppearanceBio: options.bio || null })

            let member
            try {
                member = await guild.members.editMe(options)
            } catch (err) {
                if ("bio" in req.body) await rollbackBio(guild.id, previousBio)
                throw err
            }

            return res.json({ data: serializeAppearance(guild, member, getGuildConfig(guild.id)) })
        } catch (err) { next(err) }
    })

    router.delete("/", writeLimiter, async (req, res, next) => {
        try {
            const guild = getGuildOrResponse(getClient, req.params.guildId, res)
            if (!guild) return

            const previousConfig = getGuildConfig(guild.id)
            const previousBio = previousConfig.serverAppearanceBio || null
            await updateGuildConfigAndWait(guild.id, { serverAppearanceBio: null })

            let member
            try {
                member = await guild.members.editMe({
                    avatar: null,
                    banner: null,
                    bio: null,
                    reason: "CURSED dashboard factory reset server appearance",
                })
            } catch (err) {
                await rollbackBio(guild.id, previousBio)
                throw err
            }

            return res.json({ data: serializeAppearance(guild, member, getGuildConfig(guild.id)) })
        } catch (err) { next(err) }
    })

    router.use((err, req, res, _next) => {
        const code = err?.code || null
        const mediaError = typeof code === "string" && (code.startsWith("IMAGE_") || code === "INVALID_IMAGE_URL" || code === "INVALID_IMAGE_TYPE" || code === "INVALID_IMAGE_DATA")
        console.error("[dashboard-appearance-api] request failed", {
            method: req.method,
            path: req.path,
            error: err?.name || "Error",
            code,
        })
        if (mediaError) return res.status(422).json({ error: err.message, code })
        return res.status(500).json({ error: "CURSED could not update its server appearance.", code: "APPEARANCE_UPDATE_FAILED" })
    })

    return router
}

module.exports = {
    BIO_MAX_LENGTH,
    validateAppearance,
    serializeAppearance,
    createDashboardAppearanceRouter,
}
