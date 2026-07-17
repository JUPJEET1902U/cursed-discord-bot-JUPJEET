/**
 * Server-specific Arcane-style leveling for CURSED.
 * Stores only guild/user IDs, display names, XP totals, levels, counts, and timestamps.
 * Message content is never persisted.
 */

const mongoose = require("mongoose")
const { AttachmentBuilder, PermissionFlagsBits } = require("discord.js")
const { generateLevelUpCard } = require("./levelUpCard")
const {
    DEFAULT_XP_MIN,
    DEFAULT_XP_MAX,
    DEFAULT_COOLDOWN_SECONDS,
    levelFromXp,
    getLevelProgress,
    normalizeMessageContent,
    isMeaningfulMessage,
} = require("./levelingMath")
const logger = require("./logger")

const log = logger.child("Leveling")
const CONFIG_CACHE_TTL_MS = 60_000
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const levelingConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    levelUpChannelId: { type: String, default: null },
    ignoredChannelIds: { type: [String], default: [] },
    xpMin: { type: Number, default: DEFAULT_XP_MIN, min: 1, max: 1000 },
    xpMax: { type: Number, default: DEFAULT_XP_MAX, min: 1, max: 1000 },
    cooldownSeconds: { type: Number, default: DEFAULT_COOLDOWN_SECONDS, min: 5, max: 3600 },
    announceLevelUps: { type: Boolean, default: true },
    trackingStartedAt: { type: Date, default: null },
}, { collection: "levelingConfigs", timestamps: true })

const levelingMemberSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    displayName: { type: String, default: "Member" },
    xp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 0, min: 0 },
    messageCount: { type: Number, default: 0, min: 0 },
    lastXpAt: { type: Date, default: null },
}, { collection: "levelingMembers", timestamps: true })
levelingMemberSchema.index({ guildId: 1, userId: 1 }, { unique: true })
levelingMemberSchema.index({ guildId: 1, xp: -1, userId: 1 })

const LevelingConfig = getModel("LevelingConfig", levelingConfigSchema)
const LevelingMember = getModel("LevelingMember", levelingMemberSchema)

const configCache = new Map()
const recentContent = new Map()
const userLocks = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function defaultConfig(guildId) {
    return {
        guildId: String(guildId),
        enabled: false,
        levelUpChannelId: null,
        ignoredChannelIds: [],
        xpMin: DEFAULT_XP_MIN,
        xpMax: DEFAULT_XP_MAX,
        cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
        announceLevelUps: true,
        trackingStartedAt: null,
    }
}

function normalizeConfig(config, guildId) {
    const fallback = defaultConfig(guildId)
    if (!config) return fallback
    const xpMin = Math.max(1, Math.floor(Number(config.xpMin) || DEFAULT_XP_MIN))
    const xpMax = Math.max(xpMin, Math.floor(Number(config.xpMax) || DEFAULT_XP_MAX))
    return {
        guildId: String(guildId),
        enabled: Boolean(config.enabled),
        levelUpChannelId: config.levelUpChannelId ? String(config.levelUpChannelId) : null,
        ignoredChannelIds: Array.isArray(config.ignoredChannelIds)
            ? [...new Set(config.ignoredChannelIds.map(String))]
            : [],
        xpMin,
        xpMax,
        cooldownSeconds: Math.max(5, Math.floor(Number(config.cooldownSeconds) || DEFAULT_COOLDOWN_SECONDS)),
        announceLevelUps: config.announceLevelUps !== false,
        trackingStartedAt: config.trackingStartedAt || null,
    }
}

function cacheConfig(guildId, config) {
    const normalized = normalizeConfig(config, guildId)
    configCache.set(String(guildId), {
        config: normalized,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
    })
    return normalized
}

async function getLevelingConfig(guildId, { fresh = false } = {}) {
    const id = String(guildId || "")
    if (!id) throw new Error("guildId is required")

    const cached = configCache.get(id)
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.config
    if (!isMongoConnected()) return defaultConfig(id)

    try {
        const doc = await LevelingConfig.findOne({ guildId: id }).lean()
        return cacheConfig(id, doc)
    } catch (err) {
        log.error(`getLevelingConfig failed (${id}): ${err.message}`)
        return cached?.config || defaultConfig(id)
    }
}

async function updateLevelingConfig(guildId, update) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const id = String(guildId)
    const doc = await LevelingConfig.findOneAndUpdate(
        { guildId: id },
        {
            ...update,
            $setOnInsert: {
                xpMin: DEFAULT_XP_MIN,
                xpMax: DEFAULT_XP_MAX,
                cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
                ignoredChannelIds: [],
                announceLevelUps: true,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(id, doc)
}

async function setupLeveling(guildId, channelId) {
    const existing = await getLevelingConfig(guildId, { fresh: true })
    return updateLevelingConfig(guildId, {
        $set: {
            enabled: true,
            levelUpChannelId: String(channelId),
            trackingStartedAt: existing.trackingStartedAt || new Date(),
        },
    })
}

async function setLevelingEnabled(guildId, enabled) {
    const existing = await getLevelingConfig(guildId, { fresh: true })
    return updateLevelingConfig(guildId, {
        $set: {
            enabled: Boolean(enabled),
            trackingStartedAt: enabled ? (existing.trackingStartedAt || new Date()) : existing.trackingStartedAt,
        },
    })
}

async function setLevelUpChannel(guildId, channelId) {
    return updateLevelingConfig(guildId, {
        $set: { levelUpChannelId: String(channelId) },
    })
}

async function setIgnoredChannel(guildId, channelId, ignored) {
    const operator = ignored ? "$addToSet" : "$pull"
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const id = String(guildId)
    const doc = await LevelingConfig.findOneAndUpdate(
        { guildId: id },
        {
            [operator]: { ignoredChannelIds: String(channelId) },
            $setOnInsert: {
                enabled: false,
                xpMin: DEFAULT_XP_MIN,
                xpMax: DEFAULT_XP_MAX,
                cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
                announceLevelUps: true,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(id, doc)
}

async function withUserLock(key, task) {
    const previous = userLocks.get(key) || Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const queued = previous.catch(() => {}).then(() => gate)
    userLocks.set(key, queued)

    await previous.catch(() => {})
    try {
        return await task()
    } finally {
        release()
        if (userLocks.get(key) === queued) userLocks.delete(key)
    }
}

function randomXp(config) {
    const min = Math.max(1, Math.floor(config.xpMin))
    const max = Math.max(min, Math.floor(config.xpMax))
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function recentContentKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function isRepeatedContent(guildId, userId, content, nowMs) {
    const key = recentContentKey(guildId, userId)
    const normalized = normalizeMessageContent(content)
    const previous = recentContent.get(key)
    return Boolean(
        previous &&
        previous.content === normalized &&
        nowMs - previous.at < DUPLICATE_WINDOW_MS
    )
}

function rememberContent(guildId, userId, content, nowMs) {
    recentContent.set(recentContentKey(guildId, userId), {
        content: normalizeMessageContent(content),
        at: nowMs,
    })
}

async function getLevelingMember(guildId, userId) {
    if (!isMongoConnected()) return null
    return LevelingMember.findOne({ guildId: String(guildId), userId: String(userId) }).lean()
}

async function getMemberRank(guildId, userId) {
    if (!isMongoConnected()) return null
    const member = await getLevelingMember(guildId, userId)
    if (!member) return null
    const ahead = await LevelingMember.countDocuments({
        guildId: String(guildId),
        xp: { $gt: member.xp },
    })
    return { ...member, rank: ahead + 1, progress: getLevelProgress(member.xp) }
}

async function getLeaderboard(guildId, limit = 10) {
    if (!isMongoConnected()) return []
    const safeLimit = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)))
    return LevelingMember.find({ guildId: String(guildId) })
        .sort({ xp: -1, updatedAt: 1, userId: 1 })
        .limit(safeLimit)
        .lean()
}

async function resolveAnnouncementChannel(guild, channelId) {
    if (!guild || !channelId) return null
    return guild.channels.cache.get(String(channelId))
        || guild.channels.fetch(String(channelId)).catch(() => null)
}

async function sendLevelUpAnnouncement({
    guild,
    user,
    displayName,
    oldLevel,
    newLevel,
    channelId,
    mention = true,
}) {
    const channel = await resolveAnnouncementChannel(guild, channelId)
    if (!channel || !channel.isTextBased() || channel.isThread?.()) {
        return { sent: false, reason: "missing-channel" }
    }

    const me = guild.members.me
    const permissions = me ? channel.permissionsFor(me) : null
    if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) {
        return { sent: false, reason: "missing-view-permission" }
    }
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
        return { sent: false, reason: "missing-send-permission" }
    }

    const content = mention
        ? `<@${user.id}> has reached **level ${newLevel}**. GG!`
        : `**${displayName || user.username}** previewed a level-up: **${oldLevel} → ${newLevel}**.`
    const payload = {
        content,
        allowedMentions: mention
            ? { parse: [], users: [user.id], roles: [], repliedUser: false }
            : { parse: [], users: [], roles: [], repliedUser: false },
    }

    const canAttach = !permissions || permissions.has(PermissionFlagsBits.AttachFiles)
    if (canAttach) {
        try {
            const buffer = await generateLevelUpCard({
                user,
                displayName,
                guildName: guild.name,
                oldLevel,
                newLevel,
            })
            payload.files = [new AttachmentBuilder(buffer, { name: `level-up-${user.id}.png` })]
        } catch (err) {
            log.warn(`Level-up card generation failed: ${err.message}`, {
                guildId: guild.id,
                userId: user.id,
            })
        }
    }

    await channel.send(payload)
    return { sent: true, channelId: channel.id, usedCard: Boolean(payload.files?.length) }
}

async function handleLevelingMessage(message) {
    if (!message?.guild || !message.author || message.author.bot || message.webhookId) return { awarded: false, reason: "unsupported" }
    if (!isMongoConnected()) return { awarded: false, reason: "mongo-unavailable" }
    if (!isMeaningfulMessage(message.content)) return { awarded: false, reason: "not-meaningful" }

    const guildId = String(message.guild.id)
    const userId = String(message.author.id)
    const channelId = String(message.channel.id)
    const config = await getLevelingConfig(guildId)

    if (!config.enabled) return { awarded: false, reason: "disabled" }
    if (!config.levelUpChannelId) return { awarded: false, reason: "not-configured" }
    if (config.ignoredChannelIds.includes(channelId)) return { awarded: false, reason: "ignored-channel" }

    const now = new Date()
    const nowMs = now.getTime()
    const lockKey = `${guildId}:${userId}`

    return withUserLock(lockKey, async () => {
        const existing = await LevelingMember.findOne({ guildId, userId }).lean()
        const cooldownMs = Math.max(5, config.cooldownSeconds) * 1000
        if (existing?.lastXpAt && nowMs - new Date(existing.lastXpAt).getTime() < cooldownMs) {
            return { awarded: false, reason: "cooldown" }
        }
        if (isRepeatedContent(guildId, userId, message.content, nowMs)) {
            return { awarded: false, reason: "duplicate" }
        }

        const gain = randomXp(config)
        let updated
        try {
            updated = await LevelingMember.findOneAndUpdate(
                { guildId, userId },
                {
                    $inc: { xp: gain, messageCount: 1 },
                    $set: {
                        displayName: String(message.member?.displayName || message.author.username).slice(0, 100),
                        lastXpAt: now,
                    },
                    $setOnInsert: { level: 0 },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean()
        } catch (err) {
            if (err?.code !== 11000) throw err
            updated = await LevelingMember.findOneAndUpdate(
                { guildId, userId },
                {
                    $inc: { xp: gain, messageCount: 1 },
                    $set: {
                        displayName: String(message.member?.displayName || message.author.username).slice(0, 100),
                        lastXpAt: now,
                    },
                },
                { new: true }
            ).lean()
        }

        if (!updated) return { awarded: false, reason: "write-failed" }

        rememberContent(guildId, userId, message.content, nowMs)
        const oldLevel = levelFromXp(Math.max(0, updated.xp - gain))
        const newLevel = levelFromXp(updated.xp)
        if (updated.level !== newLevel) {
            await LevelingMember.updateOne(
                { _id: updated._id },
                { $set: { level: newLevel } }
            )
            updated.level = newLevel
        }

        let announcement = null
        if (newLevel > oldLevel && config.announceLevelUps) {
            try {
                announcement = await sendLevelUpAnnouncement({
                    guild: message.guild,
                    user: message.author,
                    displayName: message.member?.displayName || message.author.username,
                    oldLevel,
                    newLevel,
                    channelId: config.levelUpChannelId,
                    mention: true,
                })
                if (!announcement.sent) {
                    log.warn(`Level-up announcement skipped: ${announcement.reason}`, {
                        guildId,
                        userId,
                        channelId: config.levelUpChannelId,
                    })
                }
            } catch (err) {
                log.error(`Level-up announcement failed: ${err.message}`, {
                    guildId,
                    userId,
                    channelId: config.levelUpChannelId,
                })
            }
        }

        return {
            awarded: true,
            gain,
            xp: updated.xp,
            oldLevel,
            newLevel,
            leveledUp: newLevel > oldLevel,
            announcement,
        }
    })
}

function clearGuildLevelingCache(guildId) {
    const prefix = `${guildId}:`
    configCache.delete(String(guildId))
    for (const key of recentContent.keys()) {
        if (key.startsWith(prefix)) recentContent.delete(key)
    }
}

const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - DUPLICATE_WINDOW_MS
    for (const [key, entry] of recentContent) {
        if (entry.at < cutoff) recentContent.delete(key)
    }
}, 10 * 60 * 1000)
cleanupTimer.unref?.()

module.exports = {
    LevelingConfig,
    LevelingMember,
    getLevelingConfig,
    setupLeveling,
    setLevelingEnabled,
    setLevelUpChannel,
    setIgnoredChannel,
    getLevelingMember,
    getMemberRank,
    getLeaderboard,
    sendLevelUpAnnouncement,
    handleLevelingMessage,
    clearGuildLevelingCache,
}
