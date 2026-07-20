const { Events, REST, Routes } = require("discord.js")
const logger = require("./logger")
const securityCommands = require("../commands/securityProtection")
const suiteCommands = require("../commands/securitySuite")
const { attachSecurityProtection } = require("./securityProtection")
const {
    attachSecurityRecoveryListeners,
    startSecurityRecoveryScheduler,
} = require("./securityRecoverySuite")

const log = logger.child("SecurityPhase3")
let initialized = false

function allCommandBuilders() {
    return [...securityCommands.commands, ...suiteCommands.commands]
}

async function registerSecurityCommands(client) {
    const token = process.env.BOT_TOKEN
    if (!token || !client?.user?.id) {
        log.warn("Skipped server-protection registration: bot token or application ID unavailable")
        return false
    }
    const rest = new REST({ version: "10" }).setToken(token)
    const existing = await rest.get(Routes.applicationCommands(client.user.id))
    const byKey = new Map(existing.map(command => {
        const {
            id,
            application_id,
            guild_id,
            version,
            integration_types,
            contexts,
            ...definition
        } = command
        if (integration_types !== undefined) definition.integration_types = integration_types
        if (contexts !== undefined) definition.contexts = contexts
        return [`${definition.type || 1}:${definition.name}`, definition]
    }))
    for (const builder of allCommandBuilders()) {
        const data = builder.toJSON()
        byKey.set(`${data.type || 1}:${data.name}`, data)
    }
    await rest.put(Routes.applicationCommands(client.user.id), { body: [...byKey.values()] })
    log.info(`Registered ${allCommandBuilders().length} server-protection slash commands`)
    return true
}

function scheduleRegistration(client, attempt = 0) {
    const delay = attempt === 0 ? 30000 : Math.min(90000, 20000 * (attempt + 1))
    const timer = setTimeout(async () => {
        try {
            await registerSecurityCommands(client)
        } catch (err) {
            log.error(`Server-protection slash registration failed: ${err.message}`)
            if (attempt < 4) scheduleRegistration(client, attempt + 1)
        }
    }, delay)
    timer.unref?.()
}

async function dispatchSecurityInteraction(interaction) {
    const handled = await securityCommands.handleInteraction(interaction)
    if (handled) return true
    return suiteCommands.handleInteraction(interaction)
}

function isSecurityCommand(name) {
    return securityCommands.COMMAND_NAMES.has(name) || suiteCommands.COMMAND_NAMES.has(name)
}

function initializeSecurityPhase3(client) {
    if (initialized || !client) return
    initialized = true

    client.on(Events.InteractionCreate, interaction => {
        dispatchSecurityInteraction(interaction).catch(async err => {
            log.error(`Security command failed safely: ${err.message}`)
            if (!isSecurityCommand(interaction.commandName)) return
            const payload = {
                content: "❌ Server Protection failed safely. Existing CURSED features were not changed.",
                ephemeral: true,
                allowedMentions: { parse: [] },
            }
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {})
            else await interaction.reply(payload).catch(() => {})
        })
    })

    attachSecurityRecoveryListeners(client)
    attachSecurityProtection(client)
    startSecurityRecoveryScheduler(client)
    scheduleRegistration(client)
    log.info("Moderation Phase 3 Server Protection and Recovery Suite initialized")
}

module.exports = {
    initializeSecurityPhase3,
    registerSecurityCommands,
}