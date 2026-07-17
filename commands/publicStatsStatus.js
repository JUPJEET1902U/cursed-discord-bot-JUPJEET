/**
 * Public read-only access to /stats status.
 *
 * Normal members can view whether server activity tracking is enabled without
 * receiving private configuration details. Manage Server members continue to
 * use the full administrator handler from commands/serverInsights.js.
 */

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const moderation = require("./moderation")
const { getStatsConfig } = require("../utils/activityTracker")
const logger = require("../utils/logger")
const log = logger.child("PublicStatsStatus")

function discordTimestamp(date, style = "F") {
    const value = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(value.getTime())) return "Unknown"
    return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`
}

async function handlePublicStatsStatus(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "stats") return false
    if (interaction.options.getSubcommand(false) !== "status") return false

    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "❌ This command can only be used inside a server.",
            ephemeral: true,
            allowedMentions: { parse: [] },
        }).catch(() => {})
        return true
    }

    // Administrators keep the full private configuration view, including
    // excluded channels, through the original server-insights handler.
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return false

    try {
        const config = await getStatsConfig(interaction.guildId, { fresh: true })
        const embed = new EmbedBuilder()
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

        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } })
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
            allowedMentions: { parse: [] },
        }).catch(() => {})
        return true
    }
}

async function handle() {
    return false
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

module.exports = { handle, handlePublicStatsStatus }
