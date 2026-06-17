/**
 * utils/errorHandler.js
 * Centralized error handling for CURSED bot.
 * Delegates to errorFormatter for consistent CURSED-personality errors.
 */

// Re-export from the new errorFormatter for backwards compatibility
const { handleCommandError, withErrorHandling, formatError } = require("./errorFormatter")

module.exports = { handleCommandError, withErrorHandling, formatError }
