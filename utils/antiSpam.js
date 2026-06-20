/**
 * Anti-spam tracker.
 *
 * Tracks message timestamps per user per guild.
 * Triggers when a user sends SPAM_THRESHOLD messages within SPAM_WINDOW_MS.
 */

const SPAM_THRESHOLD  = 5        // messages
const SPAM_WINDOW_MS  = 5_000    // 5 seconds
const MUTE_DURATION_MS = 30_000  // 30 seconds

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
        try { await onUnmute() } catch (err) { console.error("Anti-spam unmute error:", err.message) }
    }, MUTE_DURATION_MS)

    return true
}

function isMuted(guildId, userId) {
    return mutedUsers.has(_key(guildId, userId))
}

/**
 * Remove messageLog entries that have no timestamps within the spam window.
 * Entries for muted users are also pruned since their counter was already reset.
 * Call this periodically to prevent the Map from growing unbounded for inactive users.
 */
function cleanupMessageLog() {
    const now = Date.now()
    let pruned = 0
    for (const [key, timestamps] of messageLog.entries()) {
        // Keep only entries that still have recent timestamps
        const recent = timestamps.filter(t => now - t < SPAM_WINDOW_MS)
        if (recent.length === 0) {
            messageLog.delete(key)
            pruned++
        } else {
            messageLog.set(key, recent)
        }
    }
    if (pruned > 0) {
        console.log(`[AntiSpam] Cleaned up ${pruned} stale messageLog entries (${messageLog.size} remaining)`)
    }
}

// Run cleanup every 30 seconds
setInterval(cleanupMessageLog, 30_000)

module.exports = { recordMessage, markMuted, isMuted, cleanupMessageLog, MUTE_DURATION_MS }
