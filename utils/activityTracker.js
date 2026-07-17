/**
 * Persistent activity tracking for CURSED.
 *
 * Existing lifetime totals remain available. Detailed daily guild/user/channel
 * tracking is opt-in per guild and stores counts only—never message content,
 * attachments, links, or voice audio.
 */

const mongoose = require("mongoose")
const { Events } = require("discord.js")
const logger = require("./logger")
const { utcDateKey, splitDurationByUtcDay } = require("./activityStatsHelpers")
const log = logger.child("ActivityTracker")

const CONFIG_CACHE_TTL_MS = 60_000

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const activitySchema = new mongoose.Schema({
    guildId:       { type: String, required: true, index: true },
    userId:        { type: String, required: true, index: true },
    messageCount:  { type: Number, default: 0 },
    commandCount:  { type: Number, default: 0 },
    voiceSeconds:  { type: Number, default: 0 },
    firstSeenAt:   { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    lastVoiceAt:   { type: Date, default: null },
    updatedAt:     { type: Date, default: Date.now },
})
activitySchema.index({ guildId: 1, userId: 1 }, { unique: true })

const statsConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    excludeBots: { type: Boolean, default: true },
    excludedChannelIds: { type: [String], default: [] },
    trackingStartedAt: { type: Date, default: null },
}, { collection: "guildStatsConfigs", timestamps: true })

const guildDailySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    messageCount: { type: Number, default: 0 },
    commandCount: { type: Number, default: 0 },
    voiceSeconds: { type: Number, default: 0 },
    joins: { type: Number, default: 0 },
    leaves: { type: Number, default: 0 },
}, { collection: "guildActivityDaily", timestamps: true })
guildDailySchema.index({ guildId: 1, date: 1 }, { unique: true })

const userDailySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    messageCount: { type: Number, default: 0 },
    commandCount: { type: Number, default: 0 },
    voiceSeconds: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    lastVoiceAt: { type: Date, default: null },
}, { collection: "userActivityDaily", timestamps: true })
userDailySchema.index({ guildId: 1, userId: 1, date: 1 }, { unique: true })
userDailySchema.index({ guildId: 1, date: 1, messageCount: -1 })
userDailySchema.index({ guildId: 1, date: 1, voiceSeconds: -1 })

const channelDailySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    channelType: { type: String, default: "unknown" },
    date: { type: String, required: true, index: true },
    messageCount: { type: Number, default: 0 },
    commandCount: { type: Number, default: 0 },
    voiceSeconds: { type: Number, default: 0 },
}, { collection: "channelActivityDaily", timestamps: true })
channelDailySchema.index({ guildId: 1, channelId: 1, date: 1 }, { unique: true })
channelDailySchema.index({ guildId: 1, date: 1, messageCount: -1 })
channelDailySchema.index({ guildId: 1, date: 1, voiceSeconds: -1 })

const ActivityModel = getModel("Activity", activitySchema)
const GuildStatsConfig = getModel("GuildStatsConfig", statsConfigSchema)
const GuildActivityDaily = getModel("GuildActivityDaily", guildDailySchema)
const UserActivityDaily = getModel("UserActivityDaily", userDailySchema)
const ChannelActivityDaily = getModel("ChannelActivityDaily", channelDailySchema)

const lifetimeVoiceSessions = new Map()
const detailedVoiceSessions = new Map()
const configCache = new Map()
const attachedClients = new WeakSet()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function defaultStatsConfig(guildId) {
    return {
        guildId,
        enabled: false,
        excludeBots: true,
        excludedChannelIds: [],
        trackingStartedAt: null,
    }
}

function normalizeStatsConfig(config, guildId) {
    const fallback = defaultStatsConfig(guildId)
    if (!config) return fallback
    return {
        guildId,
        enabled: Boolean(config.enabled),
        excludeBots: config.excludeBots !== false,
        excludedChannelIds: Array.isArray(config.excludedChannelIds)
            ? [...new Set(config.excludedChannelIds.map(String))]
            : [],
        trackingStartedAt: config.trackingStartedAt || null,
    }
}

function cacheConfig(guildId, config) {
    const normalized = normalizeStatsConfig(config, guildId)
    configCache.set(guildId, { config: normalized, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS })
    return normalized
}

async function getStatsConfig(guildId, { fresh = false } = {}) {
    if (!guildId) throw new Error("guildId is required")
    const cached = configCache.get(guildId)
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.config
    if (!isMongoConnected()) return defaultStatsConfig(guildId)

    try {
        const doc = await GuildStatsConfig.findOne({ guildId }).lean()
        return cacheConfig(guildId, doc)
    } catch (err) {
        log.error(`getStatsConfig failed (${guildId}): ${err.message}`)
        return cached?.config || defaultStatsConfig(guildId)
    }
}

async function setStatsEnabled(guildId, enabled) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const existing = await GuildStatsConfig.findOne({ guildId }).lean()
    const update = {
        $set: { enabled: Boolean(enabled) },
        $setOnInsert: { excludeBots: true, excludedChannelIds: [] },
    }
    if (enabled && !existing?.trackingStartedAt) update.$set.trackingStartedAt = new Date()

    const doc = await GuildStatsConfig.findOneAndUpdate(
        { guildId },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(guildId, doc)
}

async function setupStats(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const existing = await GuildStatsConfig.findOne({ guildId }).lean()
    const startedAt = existing?.trackingStartedAt || new Date()
    const doc = await GuildStatsConfig.findOneAndUpdate(
        { guildId },
        {
            $set: { enabled: true, trackingStartedAt: startedAt },
            $setOnInsert: { excludeBots: true, excludedChannelIds: [] },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(guildId, doc)
}

async function setChannelExcluded(guildId, channelId, excluded) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const operator = excluded ? "$addToSet" : "$pull"
    const doc = await GuildStatsConfig.findOneAndUpdate(
        { guildId },
        {
            [operator]: { excludedChannelIds: String(channelId) },
            $setOnInsert: { enabled: false, excludeBots: true },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    return cacheConfig(guildId, doc)
}

async function resetGuildStats(guildId, { includeLifetime = true } = {}) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable.")
    const operations = [
        GuildActivityDaily.deleteMany({ guildId }),
        UserActivityDaily.deleteMany({ guildId }),
        ChannelActivityDaily.deleteMany({ guildId }),
        GuildStatsConfig.updateOne(
            { guildId },
            { $set: { enabled: false, trackingStartedAt: null, excludedChannelIds: [] } },
            { upsert: true }
        ),
    ]
    if (includeLifetime) operations.push(ActivityModel.deleteMany({ guildId }))
    const results = await Promise.all(operations)
    configCache.delete(guildId)
    lifetimeVoiceSessions.forEach((_value, key) => { if (key.startsWith(`${guildId}:`)) lifetimeVoiceSessions.delete(key) })
    detailedVoiceSessions.forEach((_value, key) => { if (key.startsWith(`${guildId}:`)) detailedVoiceSessions.delete(key) })
    return results
}

function channelTypeName(type) {
    return type === undefined || type === null ? "unknown" : String(type)
}

async function shouldTrackDetailed(guildId, channelId, isBot = false) {
    const config = await getStatsConfig(guildId)
    if (!config.enabled) return { ok: false, config }
    if (config.excludeBots && isBot) return { ok: false, config }
    if (channelId && config.excludedChannelIds.includes(String(channelId))) return { ok: false, config }
    return { ok: true, config }
}

function logSettledFailures(results, label, context) {
    for (const result of results) {
        if (result.status === "rejected") {
            log.error(`${label} failed: ${result.reason?.message || result.reason}`, context)
        }
    }
}

async function trackDetailedMessage(guildId, userId, channelId, channelType, { isBot = false } = {}) {
    if (!isMongoConnected()) return
    const decision = await shouldTrackDetailed(guildId, channelId, isBot)
    if (!decision.ok) return

    const now = new Date()
    const date = utcDateKey(now)
    const baseInsert = { createdAt: now }
    const results = await Promise.allSettled([
        GuildActivityDaily.updateOne(
            { guildId, date },
            { $inc: { messageCount: 1 }, $setOnInsert: baseInsert },
            { upsert: true }
        ),
        UserActivityDaily.updateOne(
            { guildId, userId, date },
            { $inc: { messageCount: 1 }, $set: { lastMessageAt: now }, $setOnInsert: baseInsert },
            { upsert: true }
        ),
        ChannelActivityDaily.updateOne(
            { guildId, channelId: String(channelId), date },
            {
                $inc: { messageCount: 1 },
                $set: { channelType: channelTypeName(channelType) },
                $setOnInsert: baseInsert,
            },
            { upsert: true }
        ),
    ])
    logSettledFailures(results, "Daily message tracking", { guildId, userId, channelId })
}

async function trackDetailedCommand(guildId, userId, channelId = null, channelType = null, { isBot = false } = {}) {
    if (!isMongoConnected()) return
    const decision = await shouldTrackDetailed(guildId, channelId, isBot)
    if (!decision.ok) return

    const now = new Date()
    const date = utcDateKey(now)
    const operations = [
        GuildActivityDaily.updateOne(
            { guildId, date },
            { $inc: { commandCount: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true }
        ),
        UserActivityDaily.updateOne(
            { guildId, userId, date },
            { $inc: { commandCount: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true }
        ),
    ]
    if (channelId) {
        operations.push(ChannelActivityDaily.updateOne(
            { guildId, channelId: String(channelId), date },
            {
                $inc: { commandCount: 1 },
                $set: { channelType: channelTypeName(channelType) },
                $setOnInsert: { createdAt: now },
            },
            { upsert: true }
        ))
    }
    const results = await Promise.allSettled(operations)
    logSettledFailures(results, "Daily command tracking", { guildId, userId, channelId })
}

async function trackMemberDelta(guildId, field, isBot = false) {
    if (!isMongoConnected()) return
    const decision = await shouldTrackDetailed(guildId, null, isBot)
    if (!decision.ok) return
    const now = new Date()
    await GuildActivityDaily.updateOne(
        { guildId, date: utcDateKey(now) },
        { $inc: { [field]: 1 }, $setOnInsert: { createdAt: now } },
        { upsert: true }
    )
}

async function trackMemberJoin(guildId, isBot = false) {
    return trackMemberDelta(guildId, "joins", isBot)
}

async function trackMemberLeave(guildId, isBot = false) {
    return trackMemberDelta(guildId, "leaves", isBot)
}

async function persistDetailedVoiceSegment(session, date, seconds) {
    const now = new Date()
    const { guildId, userId, channelId, channelType } = session
    const results = await Promise.allSettled([
        GuildActivityDaily.updateOne(
            { guildId, date },
            { $inc: { voiceSeconds: seconds }, $setOnInsert: { createdAt: now } },
            { upsert: true }
        ),
        UserActivityDaily.updateOne(
            { guildId, userId, date },
            { $inc: { voiceSeconds: seconds }, $set: { lastVoiceAt: now }, $setOnInsert: { createdAt: now } },
            { upsert: true }
        ),
        ChannelActivityDaily.updateOne(
            { guildId, channelId: String(channelId), date },
            {
                $inc: { voiceSeconds: seconds },
                $set: { channelType: channelTypeName(channelType) },
                $setOnInsert: { createdAt: now },
            },
            { upsert: true }
        ),
    ])
    logSettledFailures(results, "Daily voice tracking", { guildId, userId, channelId })
}

async function startDetailedVoiceSession(guildId, userId, channelId, channelType, isBot = false) {
    if (!channelId) return
    const decision = await shouldTrackDetailed(guildId, channelId, isBot)
    if (!decision.ok) return
    detailedVoiceSessions.set(`${guildId}:${userId}`, {
        guildId,
        userId,
        channelId: String(channelId),
        channelType: channelTypeName(channelType),
        joinedAt: Date.now(),
    })
}

async function endDetailedVoiceSession(guildId, userId) {
    const key = `${guildId}:${userId}`
    const session = detailedVoiceSessions.get(key)
    detailedVoiceSessions.delete(key)
    if (!session || !isMongoConnected()) return

    const decision = await shouldTrackDetailed(guildId, session.channelId, false)
    if (!decision.ok) return
    const endedAt = Date.now()
    for (const segment of splitDurationByUtcDay(session.joinedAt, endedAt)) {
        await persistDetailedVoiceSegment(session, segment.date, segment.seconds)
    }
}

async function getActivity(guildId, userId) {
    if (!isMongoConnected()) return null
    try {
        return await ActivityModel.findOne({ guildId, userId }).lean()
    } catch (err) {
        log.error(`getActivity failed (${guildId}/${userId}): ${err.message}`)
        return null
    }
}

async function trackMessage(guildId, userId) {
    if (!isMongoConnected()) return
    try {
        const now = new Date()
        await ActivityModel.updateOne(
            { guildId, userId },
            {
                $inc: { messageCount: 1 },
                $set: { lastMessageAt: now, updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true }
        )
    } catch (err) {
        log.error(`trackMessage failed (${guildId}/${userId}): ${err.message}`)
    }
}

async function trackCommand(guildId, userId) {
    if (!isMongoConnected()) return
    try {
        const now = new Date()
        await ActivityModel.updateOne(
            { guildId, userId },
            {
                $inc: { commandCount: 1 },
                $set: { updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true }
        )
    } catch (err) {
        log.error(`trackCommand failed (${guildId}/${userId}): ${err.message}`)
    }
}

function startVoiceSession(guildId, userId) {
    const key = `${guildId}:${userId}`
    if (!lifetimeVoiceSessions.has(key)) lifetimeVoiceSessions.set(key, Date.now())
}

async function endVoiceSession(guildId, userId) {
    const key = `${guildId}:${userId}`
    const joinedAt = lifetimeVoiceSessions.get(key)
    lifetimeVoiceSessions.delete(key)
    if (!joinedAt || !isMongoConnected()) return

    const seconds = Math.floor((Date.now() - joinedAt) / 1000)
    if (seconds <= 0) return
    try {
        const now = new Date()
        await ActivityModel.updateOne(
            { guildId, userId },
            {
                $inc: { voiceSeconds: seconds },
                $set: { lastVoiceAt: now, updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true }
        )
    } catch (err) {
        log.error(`endVoiceSession failed (${guildId}/${userId}): ${err.message}`)
    }
}

async function getGuildActivitySummary(guildId) {
    if (!isMongoConnected()) return null
    try {
        const [summary] = await ActivityModel.aggregate([
            { $match: { guildId } },
            {
                $group: {
                    _id: null,
                    totalMessages: { $sum: "$messageCount" },
                    totalCommands: { $sum: "$commandCount" },
                    totalVoiceSeconds: { $sum: "$voiceSeconds" },
                    trackedUsers: { $sum: 1 },
                    activeUsers: {
                        $sum: {
                            $cond: [
                                { $or: [
                                    { $gt: ["$messageCount", 0] },
                                    { $gt: ["$commandCount", 0] },
                                    { $gt: ["$voiceSeconds", 0] },
                                ] },
                                1,
                                0,
                            ],
                        },
                    },
                    lastActivityAt: { $max: "$updatedAt" },
                },
            },
        ])
        return summary || {
            totalMessages: 0,
            totalCommands: 0,
            totalVoiceSeconds: 0,
            trackedUsers: 0,
            activeUsers: 0,
            lastActivityAt: null,
        }
    } catch (err) {
        log.error(`getGuildActivitySummary failed (${guildId}): ${err.message}`)
        return null
    }
}

function attachActivityTracking(client) {
    if (!client || attachedClients.has(client)) return false
    attachedClients.add(client)

    client.on(Events.MessageCreate, message => {
        if (!message.guild) return
        trackDetailedMessage(
            message.guild.id,
            message.author.id,
            message.channel.id,
            message.channel.type,
            { isBot: message.author.bot }
        ).catch(err => log.error(`Detailed message listener failed: ${err.message}`))
    })

    client.on(Events.InteractionCreate, interaction => {
        if (!interaction.inGuild?.() || !interaction.isChatInputCommand?.()) return
        Promise.allSettled([
            trackCommand(interaction.guildId, interaction.user.id),
            trackDetailedCommand(
                interaction.guildId,
                interaction.user.id,
                interaction.channelId,
                interaction.channel?.type,
                { isBot: interaction.user.bot }
            ),
        ]).then(results => logSettledFailures(results, "Slash command tracking", {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            channelId: interaction.channelId,
        }))
    })

    client.on(Events.GuildMemberAdd, member => {
        trackMemberJoin(member.guild.id, member.user.bot)
            .catch(err => log.error(`Member join tracking failed: ${err.message}`))
    })

    client.on(Events.GuildMemberRemove, member => {
        trackMemberLeave(member.guild.id, member.user.bot)
            .catch(err => log.error(`Member leave tracking failed: ${err.message}`))
    })

    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        const member = newState.member || oldState.member
        if (!member) return
        const guildId = newState.guild.id
        const userId = newState.id || oldState.id
        const joined = !oldState.channelId && newState.channelId
        const left = oldState.channelId && !newState.channelId
        const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId

        try {
            if (joined) {
                await startDetailedVoiceSession(guildId, userId, newState.channelId, newState.channel?.type, member.user.bot)
            } else if (left) {
                await endDetailedVoiceSession(guildId, userId)
            } else if (switched) {
                await endDetailedVoiceSession(guildId, userId)
                await startDetailedVoiceSession(guildId, userId, newState.channelId, newState.channel?.type, member.user.bot)
            }
        } catch (err) {
            log.error(`Detailed voice listener failed: ${err.message}`, { guildId, userId })
        }
    })

    log.info("Detailed server activity listeners attached")
    return true
}

module.exports = {
    getActivity,
    getGuildActivitySummary,
    trackMessage,
    trackCommand,
    startVoiceSession,
    endVoiceSession,
    getStatsConfig,
    setupStats,
    setStatsEnabled,
    setChannelExcluded,
    resetGuildStats,
    trackDetailedMessage,
    trackDetailedCommand,
    trackMemberJoin,
    trackMemberLeave,
    attachActivityTracking,
    GuildStatsConfig,
    GuildActivityDaily,
    UserActivityDaily,
    ChannelActivityDaily,
}
