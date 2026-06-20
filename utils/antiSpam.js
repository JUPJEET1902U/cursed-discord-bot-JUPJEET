/**
 * Anti-spam tracker.
 *
 * Tracks message timestamps per user per guild.
 * Triggers when a user sends SPAM_THRESHOLD messages within SPAM_WINDOW_MS.
 */

const SPAM_THRESHOLD   = 5        // messages
const SPAM_WINDOW_MS   = 5_000    // 5 seconds
const MUTE_DURATION_MS = 30_000   // 30 seconds
const STALE_ENTRY_MS   = 10 * 60 * 1000  // 10 minutes — entries older than this are stale
const MAX_TIMESTAMPS   = 50       // max stored timestamps per user (safety cap)

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
    let timestamps = (messageLog.get(key) || []).filter(t => now - t < SPAM_WINDOW_MS)
    timestamps.push(now)

    // Cap to MAX_TIMESTAMPS to prevent unbounded growth per user
    if (timestamps.length > MAX_TIMESTAMPS) {
        timestamps = timestamps.slice(-MAX_TIMESTAMPS)
    }

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
 * Remove stale entries from messageLog for users who have been inactive.
 * Should be called periodically (every 5 minutes) from index.js.
 *
 * @returns {{ removed: number, remaining: number }}
 */
function cleanupAntiSpam() {
    const now = Date.now()
    let removed = 0

    for (const [key, timestamps] of messageLog) {
        // If the most recent timestamp is older than STALE_ENTRY_MS, remove the entry
        const mostRecent = timestamps.length > 0 ? Math.max(...timestamps) : 0
        if (now - mostRecent > STALE_ENTRY_MS) {
            messageLog.delete(key)
            removed++
        }
    }

    return { removed, remaining: messageLog.size }
}

// Run cleanup every 5 minutes automatically
setInterval(() => {
    const stats = cleanupAntiSpam()
    if (stats.removed > 0) {
        console.log(`[AntiSpam] Cleanup: removed ${stats.removed} stale entries, ${stats.remaining} remaining`)
    }
}, 5 * 60 * 1000)

module.exports = { recordMessage, markMuted, isMuted, MUTE_DURATION_MS, cleanupAntiSpam }
