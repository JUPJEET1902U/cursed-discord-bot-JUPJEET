/**
 * @fileoverview InteractionCreate event handler.
 * Routes slash command interactions to the moderation command handler.
 */

"use strict"

const logger        = require("../utils/logger")
const { replyWithError } = require("../utils/errorHandler")
const moderationCmd = require("../commands/moderation")

/**
 * @param {import("discord.js").Interaction} interaction
 */
async function execute(interaction) {
    if (!interaction.isChatInputCommand()) return

    logger.debug(
        "InteractionCreate",
        `/${interaction.commandName} by ${interaction.user.tag} in ${interaction.guild?.name || "DM"}`
    )

    try {
        await moderationCmd.handleInteraction(interaction)
    } catch (err) {
        logger.error("InteractionCreate", `Interaction error: ${err.message}`, err.stack)
        await replyWithError(interaction)
    }
}

module.exports = { name: "InteractionCreate", once: false, execute }
