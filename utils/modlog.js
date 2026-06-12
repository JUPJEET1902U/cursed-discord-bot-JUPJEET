/**
 * Mod Log utility — sends structured embeds to the configured mod-logs channel.
 *
 * Set MOD_LOG_CHANNEL_ID in your environment variables to the channel ID where
 * moderation actions should be logged.
 */

const { EmbedBuilder } = require("discord.js")

// Colour palette per action type
const ACTION_COLORS = {
    WARN:       0xFFAA00, // amber
    MUTE:       0xFF6600, // orange
    UNMUTE:     0x00CC88, // teal
    KICK:       0xFF4444, // red
    BAN:        0xCC0000, // dark red
    ANTI_LINK:  0xAA44FF, // purple
    ANTI_INVITE:0xDD44AA, // pink
    ANTI_SPAM:  0xFF8800, // deep orange
}

const ACTION_EMOJIS = {
    WARN:        "⚠️",
    MUTE:        "🔇",
    UNMUTE:      "🔊",
    KICK:        "👢",
    BAN:         "🔨",
    ANTI_LINK:   "🔗",
    ANTI_INVITE: "📨",
    ANTI_SPAM:   "🚫",
}

let _client = null

function setClient(client) {
    _client = client
}

/**
 * Send a mod-log embed to the designated channel.
 *
 * @param {object} guild   - Discord.js Guild object
 * @param {object} options
 * @param {string} options.action       - One of the ACTION_COLORS keys
 * @param {object} options.target       - { id, tag } of the affected user
 * @param {object} [options.moderator]  - { id, tag } of the acting moderator (omit for auto-actions)
 * @param {string} [options.reason]     - Reason for the action
 * @param {string} [options.extra]      - Any additional detail line
 */
async function logAction(guild, { action, target, moderator, reason, extra }) {
    if (!_client) return
    const channelId = process.env.MOD_LOG_CHANNEL_ID
    if (!channelId) return

    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased()) return

    const color  = ACTION_COLORS[action] ?? 0x99AABB
    const emoji  = ACTION_EMOJIS[action] ?? "🛡️"
    const label  = action.replace("_", " ")

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} ${label}`)
        .addFields(
            { name: "👤 User",      value: `<@${target.id}> (${target.tag})`,                    inline: true },
            { name: "🆔 User ID",   value: target.id,                                             inline: true },
        )
        .setTimestamp()

    if (moderator) {
        embed.addFields({ name: "🛡️ Moderator", value: `<@${moderator.id}> (${moderator.tag})`, inline: true })
    } else {
        embed.addFields({ name: "🤖 Action by", value: "Auto-Moderation",                        inline: true })
    }

    if (reason) embed.addFields({ name: "📝 Reason", value: reason, inline: false })
    if (extra)  embed.addFields({ name: "ℹ️ Details", value: extra,  inline: false })

    try {
        await channel.send({ embeds: [embed] })
    } catch (err) {
        console.error("Mod-log send error:", err.message)
    }
}

module.exports = { setClient, logAction }
