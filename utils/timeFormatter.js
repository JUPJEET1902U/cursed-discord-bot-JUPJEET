/**
 * @fileoverview Time formatting utilities for CURSED Bot.
 * Converts milliseconds, seconds, and Date objects into human-readable strings.
 */

"use strict"

/**
 * Format a duration in milliseconds into a human-readable string.
 * e.g. 3_661_000 → "1h 1m 1s"
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms < 0) ms = 0
    const totalSeconds = Math.floor(ms / 1000)
    const days    = Math.floor(totalSeconds / 86400)
    const hours   = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const parts = []
    if (days)    parts.push(`${days}d`)
    if (hours)   parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    if (seconds || parts.length === 0) parts.push(`${seconds}s`)

    return parts.join(" ")
}

/**
 * Format a duration in seconds into a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
function formatSeconds(seconds) {
    return formatDuration(seconds * 1000)
}

/**
 * Format process uptime (from process.uptime()) into a readable string.
 * @returns {string}
 */
function formatUptime() {
    return formatDuration(process.uptime() * 1000)
}

/**
 * Format a Date object or ISO string into a short date string.
 * e.g. "Jan 15, 2025"
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
    return new Date(date).toLocaleDateString("en-US", {
        year:  "numeric",
        month: "short",
        day:   "numeric",
    })
}

/**
 * Format a Date object or ISO string into a date+time string.
 * e.g. "Jan 15, 2025 at 14:30"
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateTime(date) {
    return new Date(date).toLocaleString("en-US", {
        year:   "numeric",
        month:  "short",
        day:    "numeric",
        hour:   "2-digit",
        minute: "2-digit",
    })
}

/**
 * Return a relative time string like "2 hours ago" or "in 5 minutes".
 * @param {Date|string|number} date
 * @returns {string}
 */
function timeAgo(date) {
    const now   = Date.now()
    const then  = new Date(date).getTime()
    const diff  = now - then
    const abs   = Math.abs(diff)
    const future = diff < 0

    const seconds = Math.floor(abs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours   = Math.floor(minutes / 60)
    const days    = Math.floor(hours / 24)

    let str
    if (seconds < 60)       str = `${seconds} second${seconds !== 1 ? "s" : ""}`
    else if (minutes < 60)  str = `${minutes} minute${minutes !== 1 ? "s" : ""}`
    else if (hours < 24)    str = `${hours} hour${hours !== 1 ? "s" : ""}`
    else                    str = `${days} day${days !== 1 ? "s" : ""}`

    return future ? `in ${str}` : `${str} ago`
}

module.exports = {
    formatDuration,
    formatSeconds,
    formatUptime,
    formatDate,
    formatDateTime,
    timeAgo,
}
