const { Events, REST, Routes } = require("discord.js")
const logger = require("./logger")
const advanced = require("../commands/moderationAdvanced")
const { startModerationTaskScheduler } = require("./moderationTasks")
const { attachModerationAuditLogging } = require("./moderationAuditLogger")

const log = logger.child("ModerationPhase2")
let initialized = false

async function registerAdvancedCommands(client) {
    const token = process.env.BOT_TOKEN
    if (!token || !client?.user?.id) {
        log.warn("Skipped advanced moderation registration: bot token or application ID unavailable")
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
    for (const builder of advanced.commands) {
        const data = builder.toJSON()
        byKey.set(`${data.type || 1}:${data.name}`, data)
    }
    await rest.put(Routes.applicationCommands(client.user.id), { body: [...byKey.values()] })
    log.info(`Registered ${advanced.commands.length} advanced moderation slash commands`)
    return true
}

function scheduleRegistration(client, attempt = 0) {
    const delay = attempt === 0 ? 8000 : Math.min(60000, 10000 * (attempt + 1))
    const timer = setTimeout(async () => {
        try {
            await registerAdvancedCommands(client)
        } catch (err) {
            log.error(`Advanced slash registration failed: ${err.message}`)
            if (attempt < 4) scheduleRegistration(client, attempt + 1)
        }
    }, delay)
    timer.unref?.()
}

function initializeModerationPhase2(client) {
    if (initialized || !client) return
    initialized = true

    client.on(Events.InteractionCreate, interaction => {
        advanced.handleInteraction(interaction).catch(async err => {
            log.error(`Advanced interaction failed: ${err.message}`)
            const payload = {
                content: "❌ Advanced moderation failed safely. No unrelated bot feature was changed.",
                ephemeral: true,
                allowedMentions: { parse: [] },
            }
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {})
            } else {
                await interaction.reply(payload).catch(() => {})
            }
        })
    })

    attachModerationAuditLogging(client)
    startModerationTaskScheduler(client)
    scheduleRegistration(client)
    log.info("Moderation Phase 2 initialized")
}

module.exports = {
    initializeModerationPhase2,
    registerAdvancedCommands,
}
