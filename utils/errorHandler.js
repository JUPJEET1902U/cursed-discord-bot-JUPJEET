/**
 * utils/errorHandler.js
 * Centralized error handling for CURSED bot
 */

const logger = require("./logger")
const log = logger.child("ErrorHandler")

/**
 * Handle a command error gracefully — log it and reply to the user.
 * @param {Error} err
 * @param {import("discord.js").Message} message
 * @param {string} commandName
 */
async function handleCommandError(err, message, commandName = "unknown") {
    log.error(`Command error in ${commandName}: ${err.message}`, { stack: err.stack })
    try {
        if (err.status === 429 || err.code === "rate_limit_exceeded" || (err.message && err.message.includes("rate"))) {
            await message.channel.send("⚠️ AI is rate limited right now. Try again in a moment!")
        } else {
            await message.channel.send("⚠️ Something went wrong. Try again!")
        }
    } catch (sendErr) {
        log.error(`Failed to send error message: ${sendErr.message}`)
    }
}

/**
 * Wrap an async command handler with error handling.
 * @param {Function} fn  async (message) => boolean
 * @param {string} commandName
 * @returns {Function}
 */
function withErrorHandling(fn, commandName) {
    return async (message) => {
        try {
            return await fn(message)
        } catch (err) {
            await handleCommandError(err, message, commandName)
            return true
        }
    }
}

module.exports = { handleCommandError, withErrorHandling }
