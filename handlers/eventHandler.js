/**
 * @fileoverview Event handler loader for CURSED Bot.
 * Dynamically loads and registers all Discord.js event handlers
 * from the events/ directory.
 */

"use strict"

const path   = require("path")
const logger = require("../utils/logger")

// ─── Event Module Registry ────────────────────────────────────────────────────

/**
 * List of event modules to load.
 * Each module must export: { name: string, once?: boolean, execute: Function }
 */
const EVENT_MODULES = [
    { file: "ready",           name: "ClientReady",    once: true  },
    { file: "messageCreate",   name: "MessageCreate",  once: false },
    { file: "interactionCreate", name: "InteractionCreate", once: false },
    { file: "guildCreate",     name: "GuildCreate",    once: false },
    { file: "guildMemberAdd",  name: "GuildMemberAdd", once: false },
    { file: "error",           name: "Error",          once: false },
]

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load all event handlers and register them on the Discord client.
 * @param {import("discord.js").Client} client
 */
function loadEvents(client) {
    let loaded = 0
    let failed = 0

    for (const mod of EVENT_MODULES) {
        try {
            const eventModule = require(`../events/${mod.file}`)

            if (typeof eventModule.execute !== "function") {
                logger.warn("EventHandler", `Event ${mod.file} has no execute() export — skipping`)
                failed++
                continue
            }

            const handler = (...args) => {
                try {
                    return eventModule.execute(...args)
                } catch (err) {
                    logger.error("EventHandler", `Sync error in ${mod.name} event: ${err.message}`, err.stack)
                }
            }

            if (mod.once) {
                client.once(mod.name, handler)
            } else {
                client.on(mod.name, handler)
            }

            loaded++
            logger.debug("EventHandler", `Registered ${mod.once ? "once" : "on"} handler: ${mod.name}`)
        } catch (err) {
            logger.error("EventHandler", `Failed to load event ${mod.file}: ${err.message}`, err.stack)
            failed++
        }
    }

    logger.info("EventHandler", `Registered ${loaded} event handler(s)${failed > 0 ? `, ${failed} failed` : ""}`)
}

module.exports = { loadEvents }
