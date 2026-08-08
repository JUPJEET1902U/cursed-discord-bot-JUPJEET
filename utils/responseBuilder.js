/**
 * Professional presentation primitives for CURSED.
 *
 * Presentation only. Permissions, persistence, moderation decisions, cooldowns
 * and feature behavior belong elsewhere. Every serious CURSED system should be
 * able to produce predictable output through this module.
 */

const { EmbedBuilder } = require("discord.js")
const { BRAND } = require("./productSystem")

const COLORS = Object.freeze({
    primary: 0x5865F2,
    success: 0x57F287,
    warning: 0xF0B232,
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
    neutral: 0x2B2D31,
})

const FOOTER_TEXT = BRAND.name
const SAFE_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false })
const STATUS_ICONS = Object.freeze({
    success: "✅",
    error: "❌",
    warning: "⚠️",
    cooldown: "⏳",
    security: "🛡️",
    lock: "🔒",
})

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
    author = null,
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
    if (author?.name) embed.setAuthor({ name: cleanText(author.name, 256), iconURL: author.iconURL || undefined })
    if (timestamp) embed.setTimestamp()
    return embed
}

function resultEmbed(state, {
    title,
    description,
    fields = [],
    footer,
    timestamp = true,
} = {}) {
    const normalized = ["success", "warning", "error", "security", "info"].includes(state) ? state : "info"
    const titles = {
        success: "Success",
        warning: "Attention required",
        error: "Action failed",
        security: "Server protection",
        info: "Information",
    }
    const colors = {
        success: COLORS.success,
        warning: COLORS.warning,
        error: COLORS.error,
        security: COLORS.security,
        info: COLORS.info,
    }
    return buildEmbed({
        title: title || titles[normalized],
        description,
        color: colors[normalized],
        fields,
        footer,
        timestamp,
    })
}

function success(description, { title = "Success", fields = [], footer } = {}) {
    return resultEmbed("success", { title, description, fields, footer })
}

function error(description, { title = "Action failed", fields = [], footer } = {}) {
    return resultEmbed("error", { title, description, fields, footer })
}

function warning(description, { title = "Attention required", fields = [], footer } = {}) {
    return resultEmbed("warning", { title, description, fields, footer })
}

function info(description, { title = "Information", fields = [], footer, timestamp = false } = {}) {
    return resultEmbed("info", { title, description, fields, footer, timestamp })
}

function featureEmbed(color, footer, title, description, options = {}) {
    return buildEmbed({
        title,
        description,
        color,
        fields: options.fields || [],
        footer: options.footer || footer,
        timestamp: options.timestamp === true,
        thumbnail: options.thumbnail || null,
        author: options.author || null,
    })
}

function security(title, description, { fields = [], footer = BRAND.securityFooter, color = COLORS.security } = {}) {
    return buildEmbed({ title, description, color, fields, footer, timestamp: true })
}

function moderation(title, description, { fields = [], footer = BRAND.moderationFooter, color = COLORS.moderation } = {}) {
    return buildEmbed({ title, description, color, fields, footer, timestamp: true })
}

function economy(title, description, { fields = [], footer = "CURSED • Economy", timestamp = true } = {}) {
    return buildEmbed({ title, description, color: COLORS.economy, fields, footer, timestamp })
}

function gambling(title, description, options = {}) {
    return featureEmbed(COLORS.gambling, "CURSED • Games", title, description, options)
}

function games(title, description, options = {}) {
    return featureEmbed(COLORS.games, "CURSED • Games", title, description, options)
}

function pets(title, description, options = {}) {
    return featureEmbed(COLORS.pets, "CURSED • Pets", title, description, options)
}

function fun(title, description, { fields = [], footer = "CURSED", timestamp = false } = {}) {
    return buildEmbed({ title, description, color: COLORS.fun, fields, footer, timestamp })
}

function profile(title, description, { fields = [], footer = "CURSED • Profile", thumbnail = null, timestamp = false } = {}) {
    return buildEmbed({ title, description, color: COLORS.profile, fields, footer, thumbnail, timestamp })
}

function memory(title, description, options = {}) {
    return featureEmbed(COLORS.memory, "CURSED • Memory", title, description, options)
}

function premium(title, description, options = {}) {
    return featureEmbed(COLORS.premium, "CURSED • Premium", title, description, options)
}

function admin(title, description, options = {}) {
    return featureEmbed(COLORS.admin, "CURSED • Server Management", title, description, options)
}

function statusLine(type, message) {
    const icon = STATUS_ICONS[type] || ""
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
    return statusLine("error", `Missing permission: **${cleanText(permission, 120)}**.`)
}

function botPermissionMissing(permission) {
    return statusLine("error", `I need **${cleanText(permission, 120)}** to do that.`)
}

function commandDisabled() {
    return statusLine("error", "This command is disabled in this server.")
}

function invalidUsage(usage) {
    return statusLine("warning", `Usage: \`${cleanText(usage, 240)}\``)
}

function caseSuffix(caseRecord) {
    return caseRecord?.caseNumber ? ` • Case #${caseRecord.caseNumber}` : ""
}

function safePayload(payload = {}) {
    if (typeof payload === "string") {
        return { content: cleanText(payload, 2000), allowedMentions: SAFE_MENTIONS }
    }
    return {
        ...payload,
        allowedMentions: { ...SAFE_MENTIONS, ...(payload.allowedMentions || {}) },
    }
}

async function replyInteraction(interaction, payload, { ephemeral = true } = {}) {
    const body = safePayload(typeof payload === "string" ? { content: payload } : payload)
    if (ephemeral && body.ephemeral === undefined) body.ephemeral = true

    if (interaction.deferred) {
        const { ephemeral: _ephemeral, ...editBody } = body
        return interaction.editReply(editBody)
    }
    if (interaction.replied) return interaction.followUp(body)
    return interaction.reply(body)
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
    STATUS_ICONS,
    cleanText,
    cleanFields,
    buildEmbed,
    resultEmbed,
    featureEmbed,
    success,
    error,
    warning,
    info,
    security,
    moderation,
    economy,
    gambling,
    games,
    pets,
    fun,
    profile,
    memory,
    premium,
    admin,
    statusLine,
    cooldownMessage,
    permissionDenied,
    botPermissionMissing,
    commandDisabled,
    invalidUsage,
    caseSuffix,
    safePayload,
    replyInteraction,
    sendEmbed,
    sendSafe,
}
