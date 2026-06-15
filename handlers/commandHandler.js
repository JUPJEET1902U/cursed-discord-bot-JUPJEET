/**
 * @fileoverview Command handler for CURSED Bot.
 * Loads all command modules and routes incoming messages to the correct handler.
 * Provides unified error handling, logging, and metadata support.
 */

"use strict"

const logger = require("../utils/logger")

// ─── Command Module Registry ──────────────────────────────────────────────────

/**
 * Ordered list of command modules.
 * Each module must export a `handle(message)` function that returns true
 * if it handled the message, false otherwise.
 */
const COMMAND_MODULES = [
    { name: "Premium",      path: "../commands/premium"      },
    { name: "Fun",          path: "../commands/fun"          },
    { name: "Economy",      path: "../commands/economy"      },
    { name: "Gambling",     path: "../commands/gambling"     },
    { name: "Quests",       path: "../commands/quests"       },
    { name: "Pets",         path: "../commands/pets"         },
    { name: "Profiles",     path: "../commands/profiles"     },
    { name: "Achievements", path: "../commands/achievements" },
    { name: "Stats",        path: "../commands/stats"        },
    { name: "Help",         path: "../commands/help"         },
]

/** @type {Array<{ name: string, handle: Function }>} */
let loadedModules = []

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load all command modules. Call once during bot startup.
 */
function loadCommands() {
    loadedModules = []
    let loaded = 0
    let failed = 0

    for (const mod of COMMAND_MODULES) {
        try {
            const module = require(mod.path)
            if (typeof module.handle !== "function") {
                logger.warn("CommandHandler", `Module ${mod.name} has no handle() export — skipping`)
                failed++
                continue
            }
            loadedModules.push({ name: mod.name, handle: module.handle })
            loaded++
        } catch (err) {
            logger.error("CommandHandler", `Failed to load ${mod.name}: ${err.message}`, err.stack)
            failed++
        }
    }

    logger.info("CommandHandler", `Loaded ${loaded} command module(s)${failed > 0 ? `, ${failed} failed` : ""}`)
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Route a message to the appropriate command handler.
 * Returns true if a command handled the message.
 *
 * @param {import("discord.js").Message} message
 * @returns {Promise<boolean>}
 */
async function handleCommand(message) {
    for (const mod of loadedModules) {
        try {
            const handled = await mod.handle(message)
            if (handled) {
                logger.debug(
                    "CommandHandler",
                    `[${mod.name}] handled: ${message.content.slice(0, 60)}`
                )
                return true
            }
        } catch (err) {
            logger.error(
                "CommandHandler",
                `Error in ${mod.name} handler: ${err.message}`,
                err.stack
            )
            try {
                await message.channel.send("⚠️ Something went wrong processing that command. Please try again!")
            } catch { /* ignore */ }
            return true // Prevent further processing after an error
        }
    }
    return false
}

/**
 * Get the list of loaded command module names.
 * @returns {string[]}
 */
function getLoadedModules() {
    return loadedModules.map(m => m.name)
}

module.exports = { loadCommands, handleCommand, getLoadedModules }
