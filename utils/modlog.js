/**
 * Mod Log utility — sends structured embeds to the configured mod-logs channel.
 *
 * Set MOD_LOG_CHANNEL_ID in your environment variables to the channel ID where
 * moderation actions should be logged.
 */

const { EmbedBuilder } = require("discord.js")
const logger = require("./logger")
const { MODERATION } = require("../config/constants")

const ACTION_COLORS = MODERATION.ACTION_COLORS
const ACTION_EMOJIS = MODERATION.ACTION_EMOJIS

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
        logger.error("ModLog", `Send error: ${err.message}`)
    }
}

module.exports = { setClient, logAction }
