/**
 * handlers/commandLoader.js
 * Dynamic command loading and dispatch (Phase 13)
 * Loads all command modules and provides a unified dispatch function.
 */

const logger = require("../utils/logger")
const log = logger.child("CommandLoader")

/**
 * Load all command handlers in priority order.
 * Each handler exports a { handle(message) } function returning true if handled.
 */
function loadCommands() {
    const commandModules = [
        { name: "help",             module: require("../commands/help")             },
        { name: "premium",          module: require("../commands/premium")          },
        { name: "fun",              module: require("../commands/fun")              },
        { name: "economy",          module: require("../commands/economy")          },
        { name: "economy-advanced", module: require("../commands/economy-advanced") },
        { name: "gambling",         module: require("../commands/gambling")         },
        { name: "games",            module: require("../commands/games")            },
        { name: "quests",           module: require("../commands/quests")           },
        { name: "battle",           module: require("../commands/battle")           },
        { name: "pets",             module: require("../commands/pets")             },
        { name: "profiles",         module: require("../commands/profiles")         },
        { name: "leaderboards",     module: require("../commands/leaderboards")     },
        { name: "images",           module: require("../commands/images")           },
        { name: "admin",            module: require("../commands/admin")            },
        { name: "memory",           module: require("../commands/memory")           },
    ]

    log.info(`Loaded ${commandModules.length} command modules`)
    return commandModules
}

/**
 * Dispatch a message to all command handlers in order.
 * Returns true if any handler consumed the message.
 * @param {import("discord.js").Message} message
 * @param {Array} commandModules
 * @returns {Promise<boolean>}
 */
async function dispatchCommand(message, commandModules) {
    for (const { name, module } of commandModules) {
        try {
            const handled = await module.handle(message)
            if (handled) {
                log.debug(`Command handled by: ${name}`)
                return true
            }
        } catch (err) {
            log.error(`Error in command module "${name}": ${err.message}`, { stack: err.stack })
            try {
                await message.channel.send("⚠️ Something went wrong. Try again!")
            } catch {}
            return true
        }
    }
    return false
}

module.exports = { loadCommands, dispatchCommand }
