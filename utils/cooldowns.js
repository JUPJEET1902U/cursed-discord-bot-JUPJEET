const cooldowns = new Map()

function effectiveCooldown(userId, command, requestedMs) {
    const { getPlanLimits } = require("./premium")
    const limits = getPlanLimits(userId)
    if (command === "imagine") return limits.imageCooldownMs
    if (command === "meme") return limits.memeCooldownMs
    return Math.max(0, Math.floor(Number(requestedMs || 0) * limits.commandCooldownMultiplier))
}

function checkCooldown(userId, command, ms) {
    const effectiveMs = effectiveCooldown(userId, command, ms)
    if (effectiveMs <= 0) return { ok: true, remaining: 0 }
    if (!cooldowns.has(command)) cooldowns.set(command, new Map())
    const map = cooldowns.get(command)
    const now = Date.now()
    const last = map.get(userId) || 0
    const remaining = last + effectiveMs - now
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
