/**
 * Anti-spam tracker.
 *
 * Tracks message timestamps per user per guild.
 * Triggers when a user sends SPAM_THRESHOLD messages within SPAM_WINDOW_MS.
 */

const logger = require("./logger")
const { ANTI_SPAM } = require("../config/constants")

const SPAM_THRESHOLD   = ANTI_SPAM.THRESHOLD
const SPAM_WINDOW_MS   = ANTI_SPAM.WINDOW_MS
const MUTE_DURATION_MS = ANTI_SPAM.MUTE_DURATION_MS

// Map<guildId_userId, number[]>  — stores message timestamps
const messageLog = new Map()

// Set<guildId_userId>  — users currently muted by anti-spam
const mutedUsers = new Set()

function _key(guildId, userId) {
    return `${guildId}_${userId}`
}

/**
 * Record a message and check whether the user is spamming.
 *
 * @returns {{ spam: boolean, count: number }}
 */
function recordMessage(guildId, userId) {
    const key = _key(guildId, userId)
    const now = Date.now()

    // Retrieve and prune old timestamps
    const timestamps = (messageLog.get(key) || []).filter(t => now - t < SPAM_WINDOW_MS)
    timestamps.push(now)
    messageLog.set(key, timestamps)

    return { spam: timestamps.length >= SPAM_THRESHOLD, count: timestamps.length }
}

/**
 * Mark a user as muted by anti-spam and schedule automatic unmute.
 * Returns false if the user is already muted (prevents double-action).
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {Function} onUnmute  - async callback called after MUTE_DURATION_MS
 */
function markMuted(guildId, userId, onUnmute) {
    const key = _key(guildId, userId)
    if (mutedUsers.has(key)) return false
    mutedUsers.add(key)
    messageLog.delete(key) // reset spam counter

    setTimeout(async () => {
        mutedUsers.delete(key)
        try { await onUnmute() } catch (err) { logger.error("AntiSpam", `Unmute error: ${err.message}`) }
    }, MUTE_DURATION_MS)

    return true
}

function isMuted(guildId, userId) {
    return mutedUsers.has(_key(guildId, userId))
}

module.exports = { recordMessage, markMuted, isMuted, MUTE_DURATION_MS }
