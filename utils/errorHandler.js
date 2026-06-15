/**
 * @fileoverview Global error handling for CURSED Bot.
 * Registers process-level handlers for uncaught exceptions and unhandled
 * promise rejections, and provides graceful shutdown logic.
 */

"use strict"

const logger = require("./logger")

// ─── Discord client reference (set during startup) ────────────────────────────

let _client = null

/**
 * Provide the Discord client so the shutdown handler can destroy it cleanly.
 * @param {import("discord.js").Client} client
 */
function setClient(client) {
    _client = client
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

let _isShuttingDown = false

/**
 * Perform a graceful shutdown: destroy the Discord client, then exit.
 * @param {string} reason - Human-readable reason for shutdown
 * @param {number} [code=0] - Process exit code
 */
async function gracefulShutdown(reason, code = 0) {
    if (_isShuttingDown) return
    _isShuttingDown = true

    logger.shutdown("ErrorHandler", `Initiating graceful shutdown — ${reason}`)

    try {
        if (_client?.isReady()) {
            logger.shutdown("ErrorHandler", "Destroying Discord client...")
            _client.destroy()
        }
    } catch (err) {
        logger.error("ErrorHandler", "Error during client destroy", err)
    }

    logger.shutdown("ErrorHandler", `Process exiting with code ${code}`)
    process.exit(code)
}

// ─── Process-Level Handlers ───────────────────────────────────────────────────

/**
 * Register global process error handlers.
 * Call this once during bot startup, before client.login().
 */
function registerGlobalHandlers() {
    // Unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
        logger.error(
            "Process",
            "Unhandled promise rejection",
            { reason: reason?.message || reason, stack: reason?.stack }
        )
        // Do not exit — Discord.js can recover from most rejections
    })

    // Uncaught synchronous exceptions
    process.on("uncaughtException", (err) => {
        logger.error("Process", `Uncaught exception: ${err.message}`, err.stack)
        // Exit after logging — the process is in an undefined state
        gracefulShutdown("uncaughtException", 1)
    })

    // SIGTERM (e.g. Railway/Docker stop)
    process.on("SIGTERM", () => {
        logger.shutdown("Process", "Received SIGTERM")
        gracefulShutdown("SIGTERM", 0)
    })

    // SIGINT (Ctrl+C in development)
    process.on("SIGINT", () => {
        logger.shutdown("Process", "Received SIGINT")
        gracefulShutdown("SIGINT", 0)
    })

    logger.info("ErrorHandler", "Global error handlers registered")
}

// ─── Command Error Helper ─────────────────────────────────────────────────────

/**
 * Safely reply to a Discord interaction with an error message.
 * Handles already-replied and deferred states.
 *
 * @param {import("discord.js").Interaction} interaction
 * @param {string} [message]
 */
async function replyWithError(interaction, message = "❌ An error occurred while processing that command.") {
    const payload = { content: message, ephemeral: true }
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload)
        } else {
            await interaction.reply(payload)
        }
    } catch {
        // Interaction may have expired — nothing we can do
    }
}

/**
 * Wrap an async command handler with standardized error catching.
 * Logs the error and sends a user-facing error message.
 *
 * @param {Function} fn       - Async function to wrap
 * @param {string}   context  - Label for logging (e.g. "Economy:daily")
 * @returns {Function}
 */
function withErrorHandling(fn, context) {
    return async (...args) => {
        try {
            return await fn(...args)
        } catch (err) {
            logger.error(context, `Command error: ${err.message}`, err.stack)
            // If first arg is a message object, try to notify the user
            const message = args[0]
            if (message?.channel?.send) {
                try {
                    await message.channel.send("⚠️ Something went wrong. Please try again!")
                } catch { /* ignore */ }
            }
        }
    }
}

module.exports = {
    setClient,
    registerGlobalHandlers,
    gracefulShutdown,
    replyWithError,
    withErrorHandling,
}
