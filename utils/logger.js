/**
 * utils/logger.js
 * Structured logging system for CURSED bot
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const LEVEL_LABELS = { 0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR" }
const LEVEL_COLORS = { 0: "\x1b[36m", 1: "\x1b[32m", 2: "\x1b[33m", 3: "\x1b[31m" }
const RESET = "\x1b[0m"

const configuredLevel = LOG_LEVELS[String(process.env.LOG_LEVEL || "INFO").toUpperCase()] ?? LOG_LEVELS.INFO

function log(level, context, message, data) {
    if (level < configuredLevel) return
    const ts = new Date().toISOString()
    const label = LEVEL_LABELS[level]
    const color = LEVEL_COLORS[level]
    const prefix = `${color}[${ts}] [${label}] [${context}]${RESET}`
    if (data !== undefined) {
        console.log(`${prefix} ${message}`, typeof data === "object" ? JSON.stringify(data) : data)
    } else {
        console.log(`${prefix} ${message}`)
    }
}

const logger = {
    debug: (ctx, msg, data) => log(LOG_LEVELS.DEBUG, ctx, msg, data),
    info:  (ctx, msg, data) => log(LOG_LEVELS.INFO,  ctx, msg, data),
    warn:  (ctx, msg, data) => log(LOG_LEVELS.WARN,  ctx, msg, data),
    error: (ctx, msg, data) => log(LOG_LEVELS.ERROR, ctx, msg, data),
    child: (ctx) => ({
        debug: (msg, data) => log(LOG_LEVELS.DEBUG, ctx, msg, data),
        info:  (msg, data) => log(LOG_LEVELS.INFO,  ctx, msg, data),
        warn:  (msg, data) => log(LOG_LEVELS.WARN,  ctx, msg, data),
        error: (msg, data) => log(LOG_LEVELS.ERROR, ctx, msg, data),
    })
}

module.exports = logger
