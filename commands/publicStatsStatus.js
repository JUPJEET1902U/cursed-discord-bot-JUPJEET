/**
 * Public read-only access to server activity-tracking status.
 *
 * Normal members can view whether server activity tracking is enabled through
 * `/stats status`, `c!server stats`, or the configured prefix equivalent.
 * Manage Server members continue to receive the full private slash view.
 */

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const moderation = require("./moderation")
const { getStatsConfig } = require("../utils/activityTracker")
const logger = require("../utils/logger")
const log = logger.child("PublicStatsStatus")
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

function discordTimestamp(date, style = "F") {
    const value = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(value.getTime())) return "Unknown"
    return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`
}

function buildPublicStatsEmbed(config) {
    return new EmbedBuilder()
        .setColor(config.enabled ? 0x22C55E : 0x6B7280)
        .setTitle("📊 Server Activity Tracking")
        .setDescription("This is a public, read-only view. Only members with **Manage Server** can change these settings.")
        .addFields(
            { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Bots", value: config.excludeBots ? "Excluded" : "Included", inline: true },
            {
                name: "Tracking since",
                value: config.trackingStartedAt
                    ? `${discordTimestamp(config.trackingStartedAt, "F")}\n${discordTimestamp(config.trackingStartedAt, "R")}`
                    : "Not started",
                inline: false,
            },
            {
                name: "Privacy",
                value: "CURSED stores IDs, UTC dates, and numerical activity counts only—never message content, attachments, links, or voice audio.",
                inline: false,
            },
        )
        .setFooter({ text: "Read-only server statistics status" })
        .setTimestamp()
}

async function loadPublicStatsEmbed(guildId) {
    const config = await getStatsConfig(guildId, { fresh: true })
    return buildPublicStatsEmbed(config)
}

async function handlePublicStatsStatus(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "stats") return false
    if (interaction.options.getSubcommand(false) !== "status") return false

    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "❌ This command can only be used inside a server.",
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        }).catch(() => {})
        return true
    }

    // Administrators keep the full private configuration view, including
    // excluded channels, through the original server-insights handler.
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return false

    try {
        const embed = await loadPublicStatsEmbed(interaction.guildId)
        await interaction.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        return true
    } catch (err) {
        log.error(`Public stats status failed: ${err.message}`, {
            guildId: interaction.guildId,
            userId: interaction.user?.id,
            stack: err.stack,
        })
        await interaction.reply({
            content: "❌ CURSED could not load the server statistics status.",
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        }).catch(() => {})
        return true
    }
}

function isPublicStatsPrefix(content) {
    const normalized = String(content || "").trim().toLowerCase().replace(/\s+/g, " ")
    return normalized === "!server stats" || normalized === "!stats status"
}

async function handle(message) {
    if (!message.guild || !isPublicStatsPrefix(message.content)) return false

    try {
        const embed = await loadPublicStatsEmbed(message.guild.id)
        await message.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS }).catch(() =>
            message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        )
    } catch (err) {
        log.error(`Public prefix stats status failed: ${err.message}`, {
            guildId: message.guild.id,
            userId: message.author?.id,
            stack: err.stack,
        })
        await message.reply({
            content: "❌ CURSED could not load the server statistics status.",
            allowedMentions: SAFE_MENTIONS,
        }).catch(() => {})
    }
    return true
}

if (!moderation.__publicStatsStatusPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedPublicStatsStatusInteraction(interaction) {
        const handled = await handlePublicStatsStatus(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__publicStatsStatusPatched", {
        value: true,
        enumerable: false,
    })
}

module.exports = {
    handle,
    handlePublicStatsStatus,
    buildPublicStatsEmbed,
    loadPublicStatsEmbed,
    isPublicStatsPrefix,
}
