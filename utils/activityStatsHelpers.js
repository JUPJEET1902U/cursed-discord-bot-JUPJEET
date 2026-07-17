function utcDateKey(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new Error("Invalid date")
    return date.toISOString().slice(0, 10)
}

function splitDurationByUtcDay(startValue, endValue) {
    const start = startValue instanceof Date ? startValue.getTime() : Number(startValue)
    const end = endValue instanceof Date ? endValue.getTime() : Number(endValue)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

    const segments = []
    let cursor = start
    while (cursor < end) {
        const current = new Date(cursor)
        const nextBoundary = Date.UTC(
            current.getUTCFullYear(),
            current.getUTCMonth(),
            current.getUTCDate() + 1
        )
        const segmentEnd = Math.min(end, nextBoundary)
        const seconds = Math.floor((segmentEnd - cursor) / 1000)
        if (seconds > 0) segments.push({ date: utcDateKey(cursor), seconds })
        cursor = segmentEnd
    }
    return segments
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    const parts = []
    if (days) parts.push(`${days}d`)
    if (hours) parts.push(`${hours}h`)
    if (minutes || parts.length === 0) parts.push(`${minutes}m`)
    return parts.slice(0, 2).join(" ")
}

function humanizeEnum(value) {
    return String(value ?? "Unknown")
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase())
}

module.exports = { utcDateKey, splitDurationByUtcDay, formatDuration, humanizeEnum }
