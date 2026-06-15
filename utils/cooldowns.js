const { RATE_LIMIT: RATE_LIMIT_CONFIG } = require("../config/constants")

const cooldowns  = new Map()
const rateLimits = new Map()

const RATE_LIMIT  = RATE_LIMIT_CONFIG.MAX_MESSAGES
const RATE_WINDOW = RATE_LIMIT_CONFIG.WINDOW_MS

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

function checkRateLimit(userId) {
    const now = Date.now()
    if (!rateLimits.has(userId)) rateLimits.set(userId, { count: 0, resetAt: now + RATE_WINDOW })
    const rl = rateLimits.get(userId)
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + RATE_WINDOW }
    if (rl.count >= RATE_LIMIT) {
        const remaining = Math.ceil((rl.resetAt - now) / 1000)
        return { ok: false, remaining }
    }
    rl.count++
    return { ok: true }
}

module.exports = { checkCooldown, checkRateLimit }
