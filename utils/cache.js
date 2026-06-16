/**
 * utils/cache.js
 * In-memory caching system with TTL support for CURSED bot
 */

const logger = require("./logger")
const log = logger.child("Cache")

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL || "300") * 1000 // default 5 minutes

class CacheEntry {
    constructor(value, ttl) {
        this.value = value
        this.expiresAt = Date.now() + ttl
    }
    isExpired() { return Date.now() > this.expiresAt }
}

class Cache {
    constructor(name = "default") {
        this.name = name
        this.store = new Map()
        // Periodic cleanup every 5 minutes
        setInterval(() => this._cleanup(), 5 * 60 * 1000)
    }

    set(key, value, ttl = DEFAULT_TTL) {
        this.store.set(key, new CacheEntry(value, ttl))
        log.debug(`[${this.name}] SET ${key} (ttl=${ttl}ms)`)
    }

    get(key) {
        const entry = this.store.get(key)
        if (!entry) return null
        if (entry.isExpired()) {
            this.store.delete(key)
            log.debug(`[${this.name}] EXPIRED ${key}`)
            return null
        }
        log.debug(`[${this.name}] HIT ${key}`)
        return entry.value
    }

    has(key) { return this.get(key) !== null }

    delete(key) { this.store.delete(key) }

    clear() { this.store.clear() }

    size() { return this.store.size }

    _cleanup() {
        let removed = 0
        for (const [key, entry] of this.store.entries()) {
            if (entry.isExpired()) { this.store.delete(key); removed++ }
        }
        if (removed > 0) log.debug(`[${this.name}] Cleaned up ${removed} expired entries`)
    }
}

// Shared cache instances
const leaderboardCache = new Cache("leaderboard")
const questCache       = new Cache("quest")
const profileCache     = new Cache("profile")

module.exports = { Cache, leaderboardCache, questCache, profileCache }
