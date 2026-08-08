/**
 * Lightweight anti-spam tracker used by the legacy AutoMod switch.
 *
 * Reboot changes:
 * - thresholds are configurable per call instead of hard-coded internally
 * - timers are non-blocking
 * - runtime state is bounded and pruned
 * - no message content is stored here
 */

const DEFAULT_SPAM_THRESHOLD = 5
const DEFAULT_SPAM_WINDOW_MS = 5_000
const DEFAULT_MUTE_DURATION_MS = 30_000
const MAX_TRACKED_USERS = 5000

const messageLog = new Map()
const mutedUsers = new Map()

function keyFor(guildId, userId) {
    return `${guildId}_${userId}`
}

function clamp(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeOptions(options = {}) {
    return {
        threshold: clamp(options.threshold, DEFAULT_SPAM_THRESHOLD, 3, 50),
        windowMs: clamp(options.windowMs, DEFAULT_SPAM_WINDOW_MS, 1_000, 60_000),
        muteDurationMs: clamp(options.muteDurationMs, DEFAULT_MUTE_DURATION_MS, 5_000, 24 * 60 * 60 * 1000),
    }
}

function recordMessage(guildId, userId, options = {}) {
    const config = normalizeOptions(options)
    const key = keyFor(guildId, userId)
    const current = Date.now()
    const timestamps = (messageLog.get(key) || []).filter(timestamp => current - timestamp < config.windowMs)
    timestamps.push(current)
    messageLog.set(key, timestamps)

    if (messageLog.size > MAX_TRACKED_USERS) cleanupMessageLog()
    return {
        spam: timestamps.length >= config.threshold,
        count: timestamps.length,
        threshold: config.threshold,
        windowMs: config.windowMs,
    }
}

function markMuted(guildId, userId, onUnmute, options = {}) {
    const config = normalizeOptions(options)
    const key = keyFor(guildId, userId)
    if (mutedUsers.has(key)) return false

    const expiresAt = Date.now() + config.muteDurationMs
    mutedUsers.set(key, expiresAt)
    messageLog.delete(key)

    const timer = setTimeout(async () => {
        mutedUsers.delete(key)
        try {
            await onUnmute?.()
        } catch (error) {
            console.error("Anti-spam unmute callback failed:", error.message)
        }
    }, config.muteDurationMs)
    timer.unref?.()
    return true
}

function isMuted(guildId, userId) {
    const key = keyFor(guildId, userId)
    const expiresAt = mutedUsers.get(key)
    if (!expiresAt) return false
    if (expiresAt <= Date.now()) {
        mutedUsers.delete(key)
        return false
    }
    return true
}

function cleanupMessageLog() {
    const current = Date.now()
    let pruned = 0

    for (const [key, timestamps] of messageLog.entries()) {
        // Keep entries that could still be relevant to the largest supported window.
        const recent = timestamps.filter(timestamp => current - timestamp < 60_000)
        if (!recent.length) {
            messageLog.delete(key)
            pruned += 1
        } else {
            messageLog.set(key, recent.slice(-50))
        }
    }

    for (const [key, expiresAt] of mutedUsers.entries()) {
        if (expiresAt <= current) mutedUsers.delete(key)
    }

    while (messageLog.size > MAX_TRACKED_USERS) {
        messageLog.delete(messageLog.keys().next().value)
        pruned += 1
    }
    return pruned
}

const cleanupTimer = setInterval(cleanupMessageLog, 30_000)
cleanupTimer.unref?.()

module.exports = {
    recordMessage,
    markMuted,
    isMuted,
    cleanupMessageLog,
    MUTE_DURATION_MS: DEFAULT_MUTE_DURATION_MS,
    DEFAULT_MUTE_DURATION_MS,
    DEFAULT_SPAM_THRESHOLD,
    DEFAULT_SPAM_WINDOW_MS,
    __testing: process.env.NODE_ENV === "test" ? { messageLog, mutedUsers, normalizeOptions } : undefined,
}
