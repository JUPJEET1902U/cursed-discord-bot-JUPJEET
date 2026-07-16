/**
 * utils/activityTracker.js
 * Persistent per-guild, per-user activity tracking for CURSED.
 * Tracks: messageCount, commandCount, voiceSeconds, firstSeenAt, lastMessageAt, lastVoiceAt.
 * Uses MongoDB when available; silently skips on failure so nothing breaks.
 *
 * NOTE: Statistics are collected only from the time tracking was enabled.
 *       Historical messages are NOT scanned.
 */

const mongoose = require("mongoose")
const logger = require("./logger")
const log = logger.child("ActivityTracker")

// ── Schema ─────────────────────────────────────────────────────────────────────
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

let ActivityModel
try {
    ActivityModel = mongoose.model("Activity")
} catch {
    ActivityModel = mongoose.model("Activity", activitySchema)
}

// ── Voice session tracking (in-memory; ephemeral) ─────────────────────────────
// Map<"guildId:userId", joinTimestamp (ms)>
const voiceSessions = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

/**
 * Fetch (or upsert-create) an activity record for a user in a guild.
 * Returns null when MongoDB is unavailable.
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getActivity(guildId, userId) {
    if (!isMongoConnected()) return null
    try {
        return await ActivityModel.findOne({ guildId, userId }).lean()
    } catch (err) {
        log.error(`getActivity failed (${guildId}/${userId}): ${err.message}`)
        return null
    }
}

/**
 * Increment the message count for a user and touch firstSeenAt / lastMessageAt.
 * Fire-and-forget safe — all errors are caught internally.
 * @param {string} guildId
 * @param {string} userId
 */
async function trackMessage(guildId, userId) {
    if (!isMongoConnected()) return
    try {
        const now = new Date()
        await ActivityModel.findOneAndUpdate(
            { guildId, userId },
            {
                $inc: { messageCount: 1 },
                $set: { lastMessageAt: now, updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true, new: false }
        )
    } catch (err) {
        log.error(`trackMessage failed (${guildId}/${userId}): ${err.message}`)
    }
}

/**
 * Increment the command count for a user.
 * Fire-and-forget safe.
 * @param {string} guildId
 * @param {string} userId
 */
async function trackCommand(guildId, userId) {
    if (!isMongoConnected()) return
    try {
        const now = new Date()
        await ActivityModel.findOneAndUpdate(
            { guildId, userId },
            {
                $inc: { commandCount: 1 },
                $set: { updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true, new: false }
        )
    } catch (err) {
        log.error(`trackCommand failed (${guildId}/${userId}): ${err.message}`)
    }
}

/**
 * Record a user joining a voice channel (starts a timed session).
 * @param {string} guildId
 * @param {string} userId
 */
function startVoiceSession(guildId, userId) {
    const key = `${guildId}:${userId}`
    if (!voiceSessions.has(key)) {
        voiceSessions.set(key, Date.now())
    }
}

/**
 * Record a user leaving a voice channel — persists accumulated seconds to DB.
 * Fire-and-forget safe.
 * @param {string} guildId
 * @param {string} userId
 */
async function endVoiceSession(guildId, userId) {
    const key = `${guildId}:${userId}`
    const joinedAt = voiceSessions.get(key)
    voiceSessions.delete(key)

    if (!joinedAt) return
    const seconds = Math.floor((Date.now() - joinedAt) / 1000)
    if (seconds <= 0) return

    if (!isMongoConnected()) return
    try {
        const now = new Date()
        await ActivityModel.findOneAndUpdate(
            { guildId, userId },
            {
                $inc: { voiceSeconds: seconds },
                $set: { lastVoiceAt: now, updatedAt: now },
                $setOnInsert: { firstSeenAt: now },
            },
            { upsert: true, new: false }
        )
        log.debug(`Voice: ${guildId}/${userId} +${seconds}s`)
    } catch (err) {
        log.error(`endVoiceSession failed (${guildId}/${userId}): ${err.message}`)
    }
}

/**
 * Return real persisted totals for a guild. An empty collection is a valid
 * zero-data result; null means MongoDB is unavailable or the query failed.
 */
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
                                {
                                    $or: [
                                        { $gt: ["$messageCount", 0] },
                                        { $gt: ["$commandCount", 0] },
                                        { $gt: ["$voiceSeconds", 0] },
                                    ],
                                },
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

module.exports = {
    getActivity,
    getGuildActivitySummary,
    trackMessage,
    trackCommand,
    startVoiceSession,
    endVoiceSession,
}
