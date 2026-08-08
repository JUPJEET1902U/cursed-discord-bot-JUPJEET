/**
 * Fast, conservative Discord audit-log attribution.
 *
 * Security response must be quick, but never at the cost of punishing the
 * wrong person. This resolver fetches multiple audit types in parallel, keeps a
 * tiny per-guild cache, retries briefly when Discord's audit entry arrives late,
 * and only returns entries that satisfy target + recency constraints.
 */

const { recordTiming } = require("./runtimeMetrics")

const CACHE_TTL_MS = 1_500
const MAX_CACHE_KEYS = 500
const cache = new Map()

function now() {
    return Date.now()
}

function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

function auditTypeKey(type) {
    return String(type)
}

function cacheKey(guildId, type) {
    return `${guildId}:${auditTypeKey(type)}`
}

function pruneCache(nowMs = now()) {
    for (const [key, entry] of cache.entries()) {
        if (nowMs - entry.at > CACHE_TTL_MS) cache.delete(key)
    }
    while (cache.size > MAX_CACHE_KEYS) cache.delete(cache.keys().next().value)
}

async function fetchType(guild, type, { limit = 8, bypassCache = false } = {}) {
    const key = cacheKey(guild.id, type)
    const nowMs = now()
    const cached = cache.get(key)
    if (!bypassCache && cached && nowMs - cached.at <= CACHE_TTL_MS) return cached.entries

    try {
        const logs = await guild.fetchAuditLogs({ type, limit })
        const entries = [...logs.entries.values()]
        cache.set(key, { at: nowMs, entries })
        pruneCache(nowMs)
        return entries
    } catch {
        return []
    }
}

function targetIdForEntry(entry) {
    return String(entry?.targetId || entry?.target?.id || "")
}

function uniqueEntries(entries) {
    const seen = new Set()
    const result = []
    for (const entry of entries) {
        const key = String(entry?.id || `${entry?.createdTimestamp}:${entry?.executorId}:${targetIdForEntry(entry)}`)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(entry)
    }
    return result
}

function selectCandidate(entries, {
    targetId = null,
    maxAgeMs = 15_000,
    nowMs = now(),
} = {}) {
    const target = targetId ? String(targetId) : null
    const candidates = uniqueEntries(entries)
        .filter(entry => Number.isFinite(entry?.createdTimestamp))
        .filter(entry => nowMs - entry.createdTimestamp >= -2_000)
        .filter(entry => nowMs - entry.createdTimestamp <= maxAgeMs)
        .filter(entry => !target || targetIdForEntry(entry) === target)
        .sort((left, right) => right.createdTimestamp - left.createdTimestamp)

    return candidates[0] || null
}

async function fetchCandidates(guild, types, options = {}) {
    const settled = await Promise.allSettled(types.map(type => fetchType(guild, type, options)))
    return settled.flatMap(result => result.status === "fulfilled" ? result.value : [])
}

async function resolveAuditEntry(guild, auditTypes, {
    targetId = null,
    maxAgeMs = 15_000,
    limit = 8,
    retryDelaysMs = [0, 120, 280],
} = {}) {
    if (!guild?.id || typeof guild.fetchAuditLogs !== "function") return null
    const types = [...new Set((Array.isArray(auditTypes) ? auditTypes : [auditTypes]).filter(value => value !== null && value !== undefined))]
    if (!types.length) return null

    const startedAt = now()
    try {
        for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
            const delay = Math.max(0, Number(retryDelaysMs[attempt]) || 0)
            if (delay) await sleep(delay)

            const entries = await fetchCandidates(guild, types, {
                limit,
                bypassCache: attempt > 0,
            })
            const candidate = selectCandidate(entries, { targetId, maxAgeMs, nowMs: now() })
            if (candidate) return candidate
        }
        return null
    } finally {
        recordTiming("security.audit-attribution", now() - startedAt)
    }
}

function clearAuditCache(guildId = null) {
    if (!guildId) {
        cache.clear()
        return
    }
    const prefix = `${guildId}:`
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key)
    }
}

const cleanupTimer = setInterval(pruneCache, 30_000)
cleanupTimer.unref?.()

module.exports = {
    CACHE_TTL_MS,
    resolveAuditEntry,
    selectCandidate,
    clearAuditCache,
    __testing: process.env.NODE_ENV === "test" ? { cache, fetchType, pruneCache } : undefined,
}
