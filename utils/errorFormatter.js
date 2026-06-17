/**
 * utils/errorFormatter.js
 * Centralized error handling with CURSED personality.
 * Provides consistent, friendly error messages with debugging support.
 */

const logger = require("./logger")
const log = logger.child("ErrorFormatter")

// CURSED-personality error messages by category
const ERROR_MESSAGES = {
    rate_limit: [
        "⚠️ The AI is taking a breather. Even I need a moment. Try again soon!",
        "⚠️ Rate limited! The AI gods demand patience. Wait a moment.",
        "⚠️ Too many requests! Even CURSED has limits. Try again in a bit.",
    ],
    ai_failure: [
        "💀 My brain short-circuited. Try again and maybe I'll function properly.",
        "🤖 AI malfunction detected. Rebooting... or just try again.",
        "😤 Something broke on my end. It's not you, it's me. Try again!",
    ],
    permission: [
        "🔒 You don't have permission for that. Nice try though.",
        "🚫 Access denied! You're not the boss of me... well, you're not an admin.",
        "🔐 Insufficient permissions. Become an admin and then we'll talk.",
    ],
    not_found: [
        "🔍 Couldn't find that. Did you spell it right?",
        "❓ That doesn't exist. Or maybe it does and I just can't find it.",
        "🤷 Nothing found. Try something else.",
    ],
    invalid_input: [
        "📝 That input doesn't look right. Check the usage and try again.",
        "🤔 I don't understand that. Use `!help` to see the correct format.",
        "❌ Invalid input. Even I have standards.",
    ],
    generic: [
        "⚠️ Something went wrong. Try again!",
        "💥 An error occurred. Classic. Try again.",
        "😤 That didn't work. Give it another shot.",
    ],
    cooldown: [
        "⏳ Slow down! You're on cooldown.",
        "🕐 Too fast! Wait a moment before trying again.",
        "⏱️ Cooldown active. Patience is a virtue (apparently).",
    ],
    database: [
        "🗄️ Database hiccup. Your data is safe, just try again.",
        "💾 Storage issue. Give it a moment and retry.",
        "🔧 Backend trouble. Not your fault — try again soon.",
    ],
}

/**
 * Get a random message from a category.
 * @param {string} category
 * @returns {string}
 */
function getErrorMessage(category = "generic") {
    const messages = ERROR_MESSAGES[category] || ERROR_MESSAGES.generic
    return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Classify an error into a category.
 * @param {Error} err
 * @returns {string}
 */
function classifyError(err) {
    if (!err) return "generic"
    const msg = (err.message || "").toLowerCase()
    const status = err.status || err.code || 0

    if (status === 429 || msg.includes("rate") || msg.includes("rate_limit") || err.code === "rate_limit_exceeded") {
        return "rate_limit"
    }
    if (status === 403 || msg.includes("permission") || msg.includes("forbidden") || msg.includes("missing access")) {
        return "permission"
    }
    if (status === 404 || msg.includes("not found") || msg.includes("unknown")) {
        return "not_found"
    }
    if (msg.includes("database") || msg.includes("mongo") || msg.includes("connection")) {
        return "database"
    }
    if (msg.includes("ai") || msg.includes("groq") || msg.includes("gemini") || msg.includes("openai")) {
        return "ai_failure"
    }
    return "generic"
}

/**
 * Generate a short error ID for debugging.
 * @returns {string}
 */
function generateErrorId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase()
}

/**
 * Handle a command error: log it and return a user-friendly message.
 * @param {Error} err
 * @param {string} commandName
 * @param {object} [context] - Additional context for logging
 * @returns {string} User-facing error message
 */
function formatError(err, commandName = "unknown", context = {}) {
    const errorId = generateErrorId()
    const category = classifyError(err)

    log.error(`[${errorId}] Error in ${commandName}: ${err?.message || err}`, {
        stack: err?.stack,
        category,
        ...context,
    })

    const userMessage = getErrorMessage(category)

    // Append error ID for non-trivial errors so users can report them
    if (category !== "cooldown" && category !== "permission") {
        return `${userMessage} *(Error ID: \`${errorId}\`)*`
    }
    return userMessage
}

/**
 * Handle a command error and send it to the channel.
 * @param {Error} err
 * @param {import("discord.js").Message} message
 * @param {string} commandName
 * @returns {Promise<void>}
 */
async function handleCommandError(err, message, commandName = "unknown") {
    const userMessage = formatError(err, commandName, {
        guildId: message.guild?.id,
        channelId: message.channel?.id,
        userId: message.author?.id,
    })

    try {
        await message.channel.send({
            content: userMessage,
            allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
        })
    } catch (sendErr) {
        log.error(`Failed to send error message: ${sendErr.message}`)
    }
}

/**
 * Wrap an async command handler with centralized error handling.
 * @param {Function} fn - async (message) => boolean
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

module.exports = {
    formatError,
    handleCommandError,
    withErrorHandling,
    getErrorMessage,
    classifyError,
    generateErrorId,
    ERROR_MESSAGES,
}
