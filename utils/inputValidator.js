/**
 * @fileoverview Input sanitization and validation utilities for CURSED Bot.
 * Prevents @everyone/@here mentions, validates amounts, sanitizes user input,
 * and provides consistent validation error messages.
 */

"use strict"

// ─── Mention Sanitization ─────────────────────────────────────────────────────

/**
 * Strip @everyone and @here from a string to prevent mass pings.
 * @param {string} text
 * @returns {string}
 */
function sanitizeMentions(text) {
    if (typeof text !== "string") return ""
    return text
        .replace(/@everyone/gi, "@\u200beveryone")
        .replace(/@here/gi,     "@\u200bhere")
}

/**
 * Strip all Discord mentions (@user, @role, @everyone, @here) from a string.
 * @param {string} text
 * @returns {string}
 */
function stripAllMentions(text) {
    if (typeof text !== "string") return ""
    return text
        .replace(/<@[!&]?\d+>/g, "[mention]")
        .replace(/@everyone/gi,  "[everyone]")
        .replace(/@here/gi,      "[here]")
}

// ─── Amount Validation ────────────────────────────────────────────────────────

/**
 * Parse and validate a coin amount from user input.
 * @param {string|number} input
 * @param {object} [options]
 * @param {number} [options.min=1]
 * @param {number} [options.max=Infinity]
 * @returns {{ ok: boolean, value?: number, error?: string }}
 */
function validateAmount(input, { min = 1, max = Infinity } = {}) {
    const value = parseInt(input, 10)
    if (isNaN(value))          return { ok: false, error: "Please provide a valid number." }
    if (value < min)           return { ok: false, error: `Minimum amount is **${min}**.` }
    if (value > max)           return { ok: false, error: `Maximum amount is **${max}**.` }
    if (!isFinite(value))      return { ok: false, error: "That number is too large." }
    return { ok: true, value }
}

// ─── String Validation ────────────────────────────────────────────────────────

/**
 * Validate a user-provided text string.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.minLength=1]
 * @param {number} [options.maxLength=500]
 * @param {boolean} [options.allowMentions=false]
 * @returns {{ ok: boolean, value?: string, error?: string }}
 */
function validateText(text, { minLength = 1, maxLength = 500, allowMentions = false } = {}) {
    if (typeof text !== "string") return { ok: false, error: "Invalid input." }
    const trimmed = text.trim()
    if (trimmed.length < minLength) return { ok: false, error: `Input must be at least ${minLength} character(s).` }
    if (trimmed.length > maxLength) return { ok: false, error: `Input must be under ${maxLength} characters.` }
    const sanitized = allowMentions ? trimmed : sanitizeMentions(trimmed)
    return { ok: true, value: sanitized }
}

// ─── Permission Checks ────────────────────────────────────────────────────────

/**
 * Check if a guild member has Administrator or Manage Guild permission.
 * @param {import("discord.js").GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
    return member?.permissions.has("Administrator") || member?.permissions.has("ManageGuild")
}

/**
 * Check if a guild member has Moderate Members permission.
 * @param {import("discord.js").GuildMember} member
 * @returns {boolean}
 */
function isModerator(member) {
    return member?.permissions.has("ModerateMembers") || isAdmin(member)
}

// ─── API Response Validation ──────────────────────────────────────────────────

/**
 * Validate that an AI response object has the expected shape.
 * @param {*} result
 * @returns {boolean}
 */
function isValidAIResponse(result) {
    return (
        result !== null &&
        typeof result === "object" &&
        typeof result.content === "string" &&
        result.content.trim().length > 0
    )
}

/**
 * Sanitize AI output before sending to Discord.
 * Prevents the bot from accidentally pinging @everyone or @here.
 * @param {string} text
 * @returns {string}
 */
function sanitizeAIOutput(text) {
    if (typeof text !== "string") return "..."
    return sanitizeMentions(text).slice(0, 2000) // Discord message limit
}

// ─── URL Validation ───────────────────────────────────────────────────────────

/**
 * Check if a string is a valid HTTP/HTTPS URL.
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
    try {
        const parsed = new URL(url)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
    } catch {
        return false
    }
}

module.exports = {
    sanitizeMentions,
    stripAllMentions,
    validateAmount,
    validateText,
    isAdmin,
    isModerator,
    isValidAIResponse,
    sanitizeAIOutput,
    isValidUrl,
}
