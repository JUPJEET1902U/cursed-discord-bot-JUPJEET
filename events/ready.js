/**
 * @fileoverview ClientReady event handler.
 * Fires once when the Discord client is fully connected and ready.
 */

"use strict"

const { REST, Routes } = require("discord.js")
const logger           = require("../utils/logger")
const { setClient: setModLogClient } = require("../utils/modlog")
const { loadConfig }   = require("../utils/serverConfig")
const { startWebhookServer, setClient: setWebhookClient } = require("../webhook")
const { getAIStatus }  = require("../utils/aiHelper")
const { BOT }          = require("../config/constants")
const moderationCmd    = require("../commands/moderation")

/**
 * @param {import("discord.js").Client} client
 */
async function execute(client) {
    logger.startup("Ready", `Logged in as ${client.user.tag}`)
    logger.startup("Ready", `Serving ${client.guilds.cache.size} server(s)`)

    // ── AI Status ──────────────────────────────────────────────────────────────
    const ai = getAIStatus()
    logger.startup("Ready", `AI: Groq=${ai.groqConfigured} | Gemini=${ai.geminiConfigured}`)

    // ── Set Bot Username ───────────────────────────────────────────────────────
    try {
        await client.user.setUsername(BOT.DEFAULT_USERNAME)
        logger.startup("Ready", `Bot username set to ${BOT.DEFAULT_USERNAME}`)
    } catch (err) {
        logger.warn("Ready", `Could not change username: ${err.message}`)
    }

    // ── Invite Link ────────────────────────────────────────────────────────────
    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${BOT.INVITE_PERMISSIONS}&scope=bot%20applications.commands`
    logger.startup("Ready", `\n=== BOT INVITE LINK ===\n${inviteLink}\n======================`)

    // ── Mod-Log Client ─────────────────────────────────────────────────────────
    setModLogClient(client)

    // ── Restore Mod-Log Channel from Persisted Config ──────────────────────────
    const savedConfig = loadConfig()
    for (const [guildId, cfg] of Object.entries(savedConfig)) {
        if (cfg.modLogChannelId && !process.env.MOD_LOG_CHANNEL_ID) {
            process.env.MOD_LOG_CHANNEL_ID = cfg.modLogChannelId
            logger.startup("Ready", `Mod-log channel restored: ${cfg.modLogChannelId} (guild ${guildId})`)
            break
        }
    }

    // ── Register Slash Commands ────────────────────────────────────────────────
    try {
        const rest        = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN)
        const commandData = moderationCmd.commands.map(c => c.toJSON())
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandData }
        )
        logger.startup("Ready", `Registered ${commandData.length} slash command(s)`)
    } catch (err) {
        logger.error("Ready", `Slash command registration failed: ${err.message}`)
    }

    // ── Webhook Server ─────────────────────────────────────────────────────────
    setWebhookClient(client)
    startWebhookServer()

    logger.startup("Ready", `${BOT.NAME} v${BOT.VERSION} is online and ready! 👹`)
}

module.exports = { name: "ClientReady", once: true, execute }
