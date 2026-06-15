/**
 * @fileoverview Structured logging system for CURSED Bot.
 * Provides leveled logging (DEBUG, INFO, WARN, ERROR) with timestamps,
 * context labels, and ANSI color output for readability.
 */

"use strict"

// ─── Log Levels ───────────────────────────────────────────────────────────────

const LEVELS = {
    DEBUG: 0,
    INFO:  1,
    WARN:  2,
    ERROR: 3,
}

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const ANSI = {
    RESET:   "\x1b[0m",
    BOLD:    "\x1b[1m",
    DIM:     "\x1b[2m",
    // Foreground
    BLACK:   "\x1b[30m",
    RED:     "\x1b[31m",
    GREEN:   "\x1b[32m",
    YELLOW:  "\x1b[33m",
    BLUE:    "\x1b[34m",
    MAGENTA: "\x1b[35m",
    CYAN:    "\x1b[36m",
    WHITE:   "\x1b[37m",
    GREY:    "\x1b[90m",
}

const LEVEL_STYLES = {
    DEBUG: { color: ANSI.GREY,    label: "DEBUG" },
    INFO:  { color: ANSI.CYAN,    label: "INFO " },
    WARN:  { color: ANSI.YELLOW,  label: "WARN " },
    ERROR: { color: ANSI.RED,     label: "ERROR" },
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** Minimum level to output. Set LOG_LEVEL env var to override. */
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO

// ─── Formatter ────────────────────────────────────────────────────────────────

/**
 * Format a timestamp as HH:MM:SS.mmm
 * @returns {string}
 */
function formatTime() {
    const now = new Date()
    const hh  = String(now.getHours()).padStart(2, "0")
    const mm  = String(now.getMinutes()).padStart(2, "0")
    const ss  = String(now.getSeconds()).padStart(2, "0")
    const ms  = String(now.getMilliseconds()).padStart(3, "0")
    return `${hh}:${mm}:${ss}.${ms}`
}

/**
 * Core log function.
 * @param {string} levelName - One of DEBUG | INFO | WARN | ERROR
 * @param {string} context   - Module/feature label, e.g. "AI" or "Economy"
 * @param {string} message   - Log message
 * @param {*}      [extra]   - Optional extra data (object, error, etc.)
 */
function log(levelName, context, message, extra) {
    const level = LEVELS[levelName]
    if (level < MIN_LEVEL) return

    const style     = LEVEL_STYLES[levelName]
    const timestamp = `${ANSI.GREY}${formatTime()}${ANSI.RESET}`
    const levelTag  = `${style.color}${ANSI.BOLD}[${style.label}]${ANSI.RESET}`
    const ctx       = context ? `${ANSI.MAGENTA}[${context}]${ANSI.RESET}` : ""
    const msg       = message

    const line = `${timestamp} ${levelTag} ${ctx} ${msg}`

    if (levelName === "ERROR") {
        console.error(line)
        if (extra) console.error(extra)
    } else if (levelName === "WARN") {
        console.warn(line)
        if (extra) console.warn(extra)
    } else {
        console.log(line)
        if (extra) console.log(extra)
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const logger = {
    /**
     * Debug-level log. Only shown when LOG_LEVEL=DEBUG.
     * @param {string} context
     * @param {string} message
     * @param {*}      [extra]
     */
    debug(context, message, extra) {
        log("DEBUG", context, message, extra)
    },

    /**
     * Informational log.
     * @param {string} context
     * @param {string} message
     * @param {*}      [extra]
     */
    info(context, message, extra) {
        log("INFO", context, message, extra)
    },

    /**
     * Warning log.
     * @param {string} context
     * @param {string} message
     * @param {*}      [extra]
     */
    warn(context, message, extra) {
        log("WARN", context, message, extra)
    },

    /**
     * Error log.
     * @param {string} context
     * @param {string} message
     * @param {*}      [extra]
     */
    error(context, message, extra) {
        log("ERROR", context, message, extra)
    },

    /**
     * Log a command invocation.
     * @param {string} guild   - Guild name
     * @param {string} channel - Channel name
     * @param {string} user    - Username
     * @param {string} command - Command string
     */
    command(guild, channel, user, command) {
        log("INFO", "CMD", `[${guild}] #${channel} | ${user}: ${command.slice(0, 80)}`)
    },

    /**
     * Log an AI response.
     * @param {string} provider - "groq" or "gemini"
     * @param {string} preview  - First 60 chars of response
     */
    ai(provider, preview) {
        log("INFO", "AI", `[${provider}] ${preview.slice(0, 60)}...`)
    },

    /**
     * Log a startup event.
     * @param {string} message
     */
    startup(message) {
        log("INFO", "STARTUP", message)
    },

    /**
     * Log a shutdown event.
     * @param {string} message
     */
    shutdown(message) {
        log("INFO", "SHUTDOWN", message)
    },
}

module.exports = logger
