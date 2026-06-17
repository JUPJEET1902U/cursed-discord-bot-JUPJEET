/**
 * utils/responseBuilder.js
 * Consistent, professional embed-based response builder for CURSED bot.
 * All bot responses should use these helpers for a unified look.
 */

const { EmbedBuilder } = require("discord.js")

// Brand colors
const COLORS = {
    primary:   0xFF4444,  // CURSED red
    success:   0x44FF88,  // green
    warning:   0xFFAA00,  // amber
    error:     0xFF3333,  // bright red
    info:      0x00AAFF,  // blue
    economy:   0xFFD700,  // gold
    gambling:  0x9B59B6,  // purple
    fun:       0xFF6B6B,  // coral
    games:     0x2ECC71,  // emerald
    pets:      0xE67E22,  // orange
    profile:   0x3498DB,  // blue
    memory:    0x1ABC9C,  // teal
    premium:   0xF1C40F,  // yellow
    admin:     0x95A5A6,  // grey
    mod:       0xE74C3C,  // red
    neutral:   0x2C2F33,  // dark
}

const FOOTER_TEXT = "👹 CURSED Bot"
const FOOTER_ICON = null // Set to bot avatar URL if desired

/**
 * Create a base embed with consistent branding.
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {number} [opts.color]
 * @param {Array}  [opts.fields]
 * @param {string} [opts.footer]
 * @param {boolean} [opts.timestamp]
 * @returns {EmbedBuilder}
 */
function buildEmbed({ title, description, color = COLORS.primary, fields = [], footer, timestamp = false } = {}) {
    const embed = new EmbedBuilder().setColor(color)
    if (title)       embed.setTitle(title)
    if (description) embed.setDescription(description)
    if (fields.length) embed.addFields(fields)
    embed.setFooter({ text: footer || FOOTER_TEXT })
    if (timestamp) embed.setTimestamp()
    return embed
}

/**
 * Success embed — green, checkmark title.
 */
function success(description, { title = "✅ Success", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.success, fields, footer, timestamp: true })
}

/**
 * Error embed — red, X title.
 */
function error(description, { title = "❌ Error", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.error, fields, footer, timestamp: true })
}

/**
 * Warning embed — amber, warning title.
 */
function warning(description, { title = "⚠️ Warning", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.warning, fields, footer, timestamp: true })
}

/**
 * Info embed — blue, info title.
 */
function info(description, { title = "ℹ️ Info", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.info, fields, footer })
}

/**
 * Economy embed — gold.
 */
function economy(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.economy, fields, footer, timestamp: true })
}

/**
 * Fun embed — coral.
 */
function fun(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.fun, fields, footer })
}

/**
 * Profile embed — blue.
 */
function profile(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.profile, fields, footer })
}

/**
 * Cooldown message — consistent format.
 * @param {string} name - User's display name
 * @param {number} seconds - Remaining cooldown in seconds
 * @param {string} [command] - Command name
 * @returns {string}
 */
function cooldownMessage(name, seconds, command = "") {
    const cmdNote = command ? ` for \`${command}\`` : ""
    return `⏳ **${name}**, you're on cooldown${cmdNote}! Wait **${seconds}s** before trying again.`
}

/**
 * Permission denied message.
 * @param {string} [permission]
 * @returns {string}
 */
function permissionDenied(permission = "Administrator") {
    return `🔒 You need **${permission}** permission to use this command.`
}

/**
 * Send an embed reply to a message channel.
 * @param {import("discord.js").Message} message
 * @param {EmbedBuilder} embed
 * @returns {Promise}
 */
async function sendEmbed(message, embed) {
    return message.channel.send({
        embeds: [embed],
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    })
}

/**
 * Send a plain safe message (no embeds).
 * @param {import("discord.js").Message} message
 * @param {string} content
 * @returns {Promise}
 */
async function sendSafe(message, content) {
    return message.channel.send({
        content,
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    })
}

module.exports = {
    COLORS,
    buildEmbed,
    success,
    error,
    warning,
    info,
    economy,
    fun,
    profile,
    cooldownMessage,
    permissionDenied,
    sendEmbed,
    sendSafe,
}
