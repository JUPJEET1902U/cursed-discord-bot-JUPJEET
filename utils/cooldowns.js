const cooldowns = new Map()

const DEFAULT_RATE_LIMIT = 8
const DEFAULT_RATE_WINDOW = 60 * 1000
const rateLimits = new Map()

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

function checkRateLimit(userId, options = {}) {
    const limit = Math.max(1, Math.min(30, Math.floor(Number(options.limit) || DEFAULT_RATE_LIMIT)))
    const windowMs = Math.max(
        10 * 1000,
        Math.min(10 * 60 * 1000, Math.floor(Number(options.windowMs) || DEFAULT_RATE_WINDOW))
    )
    const scope = String(options.scope || "global")
    const key = `${scope}:${userId}`
    const now = Date.now()

    if (!rateLimits.has(key)) rateLimits.set(key, { count: 0, resetAt: now + windowMs, windowMs })
    const rl = rateLimits.get(key)

    if (now > rl.resetAt || rl.windowMs !== windowMs) {
        rl.count = 0
        rl.windowMs = windowMs
        rl.resetAt = now + windowMs
    }
    if (rl.count >= limit) {
        const remaining = Math.ceil((rl.resetAt - now) / 1000)
        return { ok: false, remaining }
    }
    rl.count++
    return { ok: true, remaining: 0 }
}

module.exports = { checkCooldown, checkRateLimit }
