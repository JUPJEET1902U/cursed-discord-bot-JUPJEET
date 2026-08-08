/**
 * Lightweight in-process runtime metrics for CURSED.
 *
 * The goal is to measure the things users feel: command dispatch, security
 * attribution/response, and AI latency. Metrics are intentionally bounded and
 * contain no message content, tokens, IDs, or other user data.
 */

const MAX_SAMPLES_PER_METRIC = 120
const metrics = new Map()

function cleanMetricName(name) {
    return String(name || "unknown")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .slice(0, 120) || "unknown"
}

function recordTiming(name, durationMs) {
    const key = cleanMetricName(name)
    const value = Math.max(0, Math.round(Number(durationMs) || 0))
    const entry = metrics.get(key) || { count: 0, totalMs: 0, maxMs: 0, samples: [] }
    entry.count += 1
    entry.totalMs += value
    entry.maxMs = Math.max(entry.maxMs, value)
    entry.samples.push(value)
    if (entry.samples.length > MAX_SAMPLES_PER_METRIC) entry.samples.splice(0, entry.samples.length - MAX_SAMPLES_PER_METRIC)
    metrics.set(key, entry)
    return value
}

function percentile(values, fraction) {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
    return sorted[index]
}

function getMetric(name) {
    const key = cleanMetricName(name)
    const entry = metrics.get(key)
    if (!entry) return null
    return {
        name: key,
        count: entry.count,
        averageMs: entry.count ? Math.round(entry.totalMs / entry.count) : 0,
        p50Ms: percentile(entry.samples, 0.50),
        p95Ms: percentile(entry.samples, 0.95),
        maxMs: entry.maxMs,
        sampleCount: entry.samples.length,
    }
}

function getMetrics(prefix = "") {
    const wanted = cleanMetricName(prefix)
    return [...metrics.keys()]
        .filter(key => !prefix || key.startsWith(wanted))
        .sort()
        .map(getMetric)
        .filter(Boolean)
}

async function withTiming(name, fn) {
    const startedAt = Date.now()
    try {
        return await fn()
    } finally {
        recordTiming(name, Date.now() - startedAt)
    }
}

function resetMetrics() {
    metrics.clear()
}

module.exports = {
    MAX_SAMPLES_PER_METRIC,
    recordTiming,
    getMetric,
    getMetrics,
    withTiming,
    resetMetrics,
}
