/**
 * handlers/eventLoader.js
 * Dynamic event registration helper (Phase 13)
 * Provides utilities for registering Discord.js events cleanly.
 */

const logger = require("../utils/logger")
const log = logger.child("EventLoader")

/**
 * Register a Discord.js event with automatic error handling.
 * @param {import("discord.js").Client} client
 * @param {string} eventName
 * @param {Function} handler
 * @param {boolean} once
 */
function registerEvent(client, eventName, handler, once = false) {
    const wrapped = async (...args) => {
        try {
            await handler(...args)
        } catch (err) {
            log.error(`Unhandled error in event "${eventName}": ${err.message}`, { stack: err.stack })
        }
    }

    if (once) {
        client.once(eventName, wrapped)
    } else {
        client.on(eventName, wrapped)
    }

    log.debug(`Registered event: ${eventName} (once=${once})`)
}

/**
 * Register multiple events from a map.
 * @param {import("discord.js").Client} client
 * @param {Array<{name: string, handler: Function, once?: boolean}>} events
 */
function registerEvents(client, events) {
    for (const { name, handler, once } of events) {
        registerEvent(client, name, handler, once || false)
    }
    log.info(`Registered ${events.length} event(s)`)
}

module.exports = { registerEvent, registerEvents }
