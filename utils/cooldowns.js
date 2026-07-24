const cooldowns = new Map()

function checkCooldown(userId, command, ms) {
    if (!cooldowns.has(command)) cooldowns.set(command, new Map())
    const map = cooldowns.get(command)
    const now = Date.now()
    const last = map.get(userId) || 0
    const remaining = last + ms - now
    if (remaining > 0) return { ok: false, remaining: Math.ceil(remaining / 1000) }
    map.set(userId, now)
    return { ok: true, remaining: 0 }
}

/**
 * AI chat is unlimited in both plans. Free users only have a five-second
 * per-user pacing delay; Premium users have no delay. The guild scope keeps
 * one user's cooldown independent from every other member and server.
 */
function checkRateLimit(userId, options = {}) {
    const { checkAiReplyCooldown } = require("./premium")
    const result = checkAiReplyCooldown(userId, String(options.scope || "global"))
    return {
        ok: result.ok,
        remaining: result.remainingSeconds,
    }
}

module.exports = { checkCooldown, checkRateLimit }
