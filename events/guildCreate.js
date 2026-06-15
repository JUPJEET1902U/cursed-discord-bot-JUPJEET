/**
 * @fileoverview GuildCreate event handler.
 * Fires when the bot joins a new server. Sends a welcome message.
 */

"use strict"

const logger = require("../utils/logger")

/**
 * @param {import("discord.js").Guild} guild
 */
async function execute(guild) {
    logger.info("GuildCreate", `Joined new server: ${guild.name} (${guild.memberCount} members)`)

    const channel = guild.systemChannel
        || guild.channels.cache.find(c =>
            c.isTextBased() &&
            c.permissionsFor(guild.members.me)?.has("SendMessages")
        )

    if (!channel) return

    try {
        await channel.send(
            `👹 **CURSED has arrived.** I'm your new AI bot with roasting energy and a kind heart.\n\n` +
            `Type \`!help\` to see all commands. Admins: use \`!addchannel\` to limit me to specific channels, or I'll respond everywhere.\n\n` +
            `💎 Want to set up **Premium roles**? Use \`!setpremiumrole @role\` and \`!setpayment kofi/patreon/bmc [url]\`.`
        )
    } catch (err) {
        logger.warn("GuildCreate", `Could not send welcome message in ${guild.name}: ${err.message}`)
    }
}

module.exports = { name: "GuildCreate", once: false, execute }
