const { EmbedBuilder } = require("discord.js")

// Presentation only. This module must never decide whether an event should log,
// who is trusted, what action should run, or what data is persisted.
const LOG_COLORS = Object.freeze({
    primary: 0x8B5CF6,
    info: 0x5865F2,
    success: 0x22C55E,
    warning: 0xF59E0B,
    danger: 0xEF4444,
    critical: 0xDC2626,
    moderation: 0x7C3AED,
    securityHigh: 0xF97316,
    securityMedium: 0xEAB308,
    neutral: 0x64748B,
})

function cleanText(value, max = 4000) {
    return String(value ?? "").trim().slice(0, max)
}

function botIcon(guild) {
    try {
        return guild?.client?.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || null
    } catch {
        return null
    }
}

function userAvatar(subject) {
    const user = subject?.user || subject
    try {
        return user?.displayAvatarURL?.({ extension: "png", size: 256 }) || null
    } catch {
        return null
    }
}

function quoteBlock(value, max = 900) {
    const text = cleanText(value, max) || "No content"
    return text
        .split(/\r?\n/)
        .map(line => `> ${line || " "}`)
        .join("\n")
        .slice(0, 1024)
}

function compactMetadata(parts = []) {
    return parts
        .filter(Boolean)
        .map(part => cleanText(part, 300))
        .filter(Boolean)
        .join(" • ")
        .slice(0, 1800)
}

function cleanFields(fields = []) {
    return (Array.isArray(fields) ? fields : [])
        .filter(field => field?.name && field?.value !== undefined && field?.value !== null)
        .slice(0, 25)
        .map(field => ({
            name: cleanText(field.name, 256) || "Details",
            value: cleanText(field.value, 1024) || "—",
            inline: field.inline === true,
        }))
}

function buildLogEmbed({
    guild = null,
    category = "Activity",
    event = "Event",
    icon = "✦",
    color = LOG_COLORS.primary,
    description = null,
    fields = [],
    thumbnail = null,
    footerMeta = null,
    timestamp = true,
} = {}) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${cleanText(icon, 16)} ${cleanText(event, 220).toUpperCase()}`)

    const author = { name: `CURSED • ${cleanText(category, 80).toUpperCase()} LOGS` }
    const authorIcon = botIcon(guild)
    if (authorIcon) author.iconURL = authorIcon
    embed.setAuthor(author)

    const safeDescription = cleanText(description, 4000)
    if (safeDescription) embed.setDescription(safeDescription)

    const safeFields = cleanFields(fields)
    if (safeFields.length) embed.addFields(safeFields)

    if (thumbnail) embed.setThumbnail(String(thumbnail))

    const footer = compactMetadata([
        `CURSED • ${cleanText(category, 80)} Logs`,
        footerMeta,
    ])
    if (footer) embed.setFooter({ text: footer })
    if (timestamp) embed.setTimestamp()
    return embed
}

module.exports = {
    LOG_COLORS,
    cleanText,
    botIcon,
    userAvatar,
    quoteBlock,
    compactMetadata,
    buildLogEmbed,
}
