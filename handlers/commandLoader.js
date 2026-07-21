/**
 * handlers/commandLoader.js
 * Dynamic command loading and dispatch (Phase 13)
 * Loads all command modules and provides a unified dispatch function.
 */

const logger = require("../utils/logger")
const { trackDetailedCommand } = require("../utils/activityTracker")
const { getServerConfig } = require("../utils/serverConfig")
const {
    extractCommandName,
    isCommandEnabled,
    isModuleEnabled,
} = require("../utils/dashboardControl")
const {
    createCommandMessage,
    resolveCommandPrefix,
} = require("../utils/prefix")

// Keep Help and dashboard command controls aligned with the command
// implementations that are actually deployed before consumers read the
// shared registry.
require("../commands/helpCatalog")
require("../commands/prefixCommandCatalog")

const log = logger.child("CommandLoader")

/**
 * Load all command handlers in priority order.
 * Each handler exports a { handle(message) } function returning true if handled.
 */
function loadCommands() {
    const commandModules = [
        { name: "moderation-prefix", module: require("../commands/moderationPrefix") },
        { name: "tickets",           module: require("../commands/ticketsPrefix")   },
        { name: "help",             module: require("../commands/help")             },
        { name: "premium",          module: require("../commands/premium")          },
        { name: "fun",              module: require("../commands/fun")              },
        { name: "shop",             module: require("../commands/shop")             },
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
        { name: "server-insights",  module: require("../commands/serverInsights")   },
        { name: "public-stats-status", module: require("../commands/publicStatsStatus") },
        { name: "leveling",         module: require("../commands/leveling")         },
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
    const guildConfig = message.guild
        ? getServerConfig(message.guild.id).config
        : {}
    const resolvedPrefix = resolveCommandPrefix(message.content, guildConfig)
    if (!resolvedPrefix) return false

    const commandMessage = createCommandMessage(message, resolvedPrefix.canonicalContent)
    const commandName = extractCommandName(commandMessage.content)

    if (commandName && !isCommandEnabled(guildConfig, commandName)) {
        await message.channel.send("⛔ That command is disabled in this server.").catch(() => {})
        return true
    }

    for (const { name, module } of commandModules) {
        if (!isModuleEnabled(guildConfig, name)) continue

        try {
            const handled = await module.handle(commandMessage)
            if (handled) {
                log.debug(`Command handled by: ${name}`)
                if (message.guild && !message.author.bot) {
                    trackDetailedCommand(
                        message.guild.id,
                        message.author.id,
                        message.channel.id,
                        message.channel.type,
                        { isBot: false }
                    ).catch(err => log.error(`Detailed prefix command tracking failed: ${err.message}`))
                }
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
