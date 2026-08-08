/**
 * utils/responseBuilder.js
 * Shared presentation primitives for CURSED.
 *
 * This module intentionally contains presentation only. It must never own
 * permissions, persistence, moderation decisions, cooldown state, or command
 * execution. Keeping those concerns separate lets the bot look consistent
 * without changing how any feature behaves.
 */

const { EmbedBuilder } = require("discord.js")

const COLORS = Object.freeze({
    primary: 0x5865F2,
    success: 0x57F287,
    warning: 0xFEE75C,
    error: 0xED4245,
    info: 0x5865F2,
    security: 0xED4245,
    moderation: 0x5865F2,
    economy: 0xF0B232,
    gambling: 0x9B59B6,
    fun: 0xEB459E,
    games: 0x57F287,
    pets: 0xE67E22,
    profile: 0x5865F2,
    memory: 0x1ABC9C,
    premium: 0xF0B232,
    admin: 0x99AAB5,
    mod: 0x5865F2,
    neutral: 0x2B2D31,
})

const FOOTER_TEXT = "CURSED"
const SAFE_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false })

function cleanText(value, max = 4000) {
    return String(value ?? "").trim().slice(0, max)
}

function cleanTitle(value, fallback = null) {
    const title = cleanText(value, 256)
    return title || fallback
}

function cleanFields(fields = []) {
    if (!Array.isArray(fields)) return []
    return fields
        .filter(field => field && field.name && field.value !== undefined && field.value !== null)
        .slice(0, 25)
        .map(field => ({
            name: cleanText(field.name, 256) || "Details",
            value: cleanText(field.value, 1024) || "—",
            inline: field.inline === true,
        }))
}

function buildEmbed({
    title,
    description,
    color = COLORS.primary,
    fields = [],
    footer = FOOTER_TEXT,
    timestamp = false,
    thumbnail = null,
} = {}) {
    const embed = new EmbedBuilder().setColor(color)
    const safeTitle = cleanTitle(title)
    const safeDescription = cleanText(description, 4000)
    const safeFields = cleanFields(fields)

    if (safeTitle) embed.setTitle(safeTitle)
    if (safeDescription) embed.setDescription(safeDescription)
    if (safeFields.length) embed.addFields(safeFields)
    if (footer) embed.setFooter({ text: cleanText(footer, 2048) || FOOTER_TEXT })
    if (thumbnail) embed.setThumbnail(String(thumbnail))
    if (timestamp) embed.setTimestamp()
    return embed
}

function success(description, { title = "Success", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.success, fields, footer, timestamp: true })
}

function error(description, { title = "Action failed", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.error, fields, footer, timestamp: true })
}

function warning(description, { title = "Warning", fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.warning, fields, footer, timestamp: true })
}

function info(description, { title = "Information", fields = [], footer, timestamp = false } = {}) {
    return buildEmbed({ title, description, color: COLORS.info, fields, footer, timestamp })
}

function security(title, description, { fields = [], footer = "CURSED • Server Protection", color = COLORS.security } = {}) {
    return buildEmbed({ title, description, color, fields, footer, timestamp: true })
}

function moderation(title, description, { fields = [], footer = "CURSED • Moderation", color = COLORS.moderation } = {}) {
    return buildEmbed({ title, description, color, fields, footer, timestamp: true })
}

function economy(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.economy, fields, footer, timestamp: true })
}

function fun(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.fun, fields, footer })
}

function profile(title, description, { fields = [], footer } = {}) {
    return buildEmbed({ title, description, color: COLORS.profile, fields, footer })
}

function statusLine(type, message) {
    const icons = {
        success: "✅",
        error: "❌",
        warning: "⚠️",
        cooldown: "⏳",
        security: "🛡️",
    }
    const icon = icons[type] || ""
    const text = cleanText(message, 1900)
    return [icon, text].filter(Boolean).join(" ")
}

function cooldownMessage(name, seconds, command = "") {
    const who = cleanText(name, 80)
    const commandText = command ? ` for \`${cleanText(command, 80)}\`` : ""
    const prefix = who ? `**${who}** • ` : ""
    return statusLine("cooldown", `${prefix}Cooldown active${commandText}. Try again in **${Math.max(0, Number(seconds) || 0)}s**.`)
}

function permissionDenied(permission = "Administrator") {
    return statusLine("error", `Missing permission. You need **${cleanText(permission, 120)}** to use this command.`)
}

async function sendEmbed(message, embed) {
    return message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
}

async function sendSafe(message, content) {
    return message.channel.send({ content: cleanText(content, 2000), allowedMentions: SAFE_MENTIONS })
}

module.exports = {
    COLORS,
    FOOTER_TEXT,
    SAFE_MENTIONS,
    cleanText,
    cleanFields,
    buildEmbed,
    success,
    error,
    warning,
    info,
    security,
    moderation,
    economy,
    fun,
    profile,
    statusLine,
    cooldownMessage,
    permissionDenied,
    sendEmbed,
    sendSafe,
}
