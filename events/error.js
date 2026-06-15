/**
 * @fileoverview Discord client Error event handler.
 * Logs Discord.js client-level errors without crashing the process.
 */

"use strict"

const logger = require("../utils/logger")

/**
 * @param {Error} error
 */
function execute(error) {
    logger.error("DiscordClient", `Client error: ${error.message}`, error.stack)
}

module.exports = { name: "Error", once: false, execute }
