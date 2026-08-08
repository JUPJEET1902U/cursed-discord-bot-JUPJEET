/**
 * Unified prefix command loading and dispatch.
 *
 * Reboot goals:
 * - one predictable command pipeline
 * - concise user-facing failures
 * - no feature-specific dispatch quirks
 * - bounded latency measurements without storing user content
 */

const logger = require("../utils/logger")
const { trackDetailedCommand } = require("../utils/activityTracker")
const { getServerConfig } = require("../utils/serverConfig")
const { checkCommandPlan } = require("../utils/premiumCommandGate")
const {
    extractCommandName,
    isCommandEnabled,
    isModuleEnabled,
} = require("../utils/dashboardControl")
const {
    createCommandMessage,
    resolveCommandPrefix,
} = require("../utils/prefix")
const { commandDisabled, statusLine, sendSafe } = require("../utils/responseBuilder")
const { recordTiming } = require("../utils/runtimeMetrics")

require("../commands/helpCatalog")
require("../commands/prefixCommandCatalog")
require("../commands/systemCatalog")
require("../commands/powerCatalog")
require("../commands/imageGenerationCatalog")
require("../commands/birthdayCatalog")
require("../commands/customRoleCatalog")

const log = logger.child("CommandLoader")

function loadCommands() {
    const commandModules = [
        { name: "moderation-prefix", module: require("../commands/moderationPrefix") },
        { name: "tickets", module: require("../commands/ticketsPrefix") },
        { name: "birthdays", module: require("../commands/birthdays") },
        { name: "help", module: require("../commands/help") },
        { name: "system", module: require("../commands/system") },
        { name: "power-modules", module: require("../commands/powerModules") },
        { name: "power-runtime", module: require("../commands/powerRuntime") },
        { name: "premium", module: require("../commands/premium") },
        { name: "fun", module: require("../commands/fun") },
        { name: "shop", module: require("../commands/shop") },
        { name: "economy", module: require("../commands/economy") },
        { name: "economy-advanced", module: require("../commands/economy-advanced") },
        { name: "gambling", module: require("../commands/gambling") },
        { name: "games", module: require("../commands/games") },
        { name: "quests", module: require("../commands/quests") },
        { name: "battle", module: require("../commands/battle") },
        { name: "pets", module: require("../commands/pets") },
        { name: "profiles", module: require("../commands/profiles") },
        { name: "leaderboards", module: require("../commands/leaderboards") },
        { name: "images", module: require("../commands/images") },
        // Bot-owner-only network inspection takes precedence over the legacy
        // !botservers alias in admin.js while keeping the old command as a fallback.
        { name: "owner-network", module: require("../commands/ownerNetwork") },
        { name: "admin", module: require("../commands/admin") },
        { name: "memory", module: require("../commands/memory") },
        { name: "server-insights", module: require("../commands/serverInsights") },
        { name: "public-stats-status", module: require("../commands/publicStatsStatus") },
        { name: "leveling", module: require("../commands/leveling") },
        // Deliberately last: built-in CURSED commands always win name collisions.
        { name: "custom-roles", module: require("../commands/customRoles") },
    ]

    log.info(`Loaded ${commandModules.length} command modules`)
    return commandModules
}

async function dispatchCommand(message, commandModules) {
    const guildConfig = message.guild ? getServerConfig(message.guild.id).config : {}
    const resolvedPrefix = resolveCommandPrefix(message.content, guildConfig)
    if (!resolvedPrefix) return false

    const dispatchStartedAt = Date.now()
    const commandMessage = createCommandMessage(message, resolvedPrefix.canonicalContent)
    const commandName = extractCommandName(commandMessage.content)

    if (commandName && !isCommandEnabled(guildConfig, commandName)) {
        await sendSafe(message, commandDisabled()).catch(() => {})
        recordTiming("command.prefix.disabled", Date.now() - dispatchStartedAt)
        return true
    }

    if (commandName) {
        const planCheck = await checkCommandPlan(commandMessage, commandName)
        if (!planCheck.ok) {
            recordTiming("command.prefix.plan-gate", Date.now() - dispatchStartedAt)
            return true
        }
    }

    for (const { name, module } of commandModules) {
        if (!isModuleEnabled(guildConfig, name)) continue

        const moduleStartedAt = Date.now()
        try {
            const handled = await module.handle(commandMessage)
            recordTiming(`command.module.${name}`, Date.now() - moduleStartedAt)
            if (!handled) continue

            recordTiming("command.prefix.total", Date.now() - dispatchStartedAt)
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
        } catch (err) {
            recordTiming(`command.module.${name}`, Date.now() - moduleStartedAt)
            recordTiming("command.prefix.error", Date.now() - dispatchStartedAt)
            log.error(`Error in command module "${name}": ${err.message}`, { stack: err.stack })
            await sendSafe(message, statusLine("error", "Command failed. Try again in a moment.")).catch(() => {})
            return true
        }
    }

    recordTiming("command.prefix.unhandled", Date.now() - dispatchStartedAt)
    return false
}

module.exports = { loadCommands, dispatchCommand }
