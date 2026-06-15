/**
 * @fileoverview CURSED Bot — Main Entry Point
 *
 * Responsibilities:
 *   1. Register global error handlers
 *   2. Create the Discord client
 *   3. Load event handlers
 *   4. Load command modules
 *   5. Connect to MongoDB (optional)
 *   6. Login to Discord
 *
 * All business logic lives in events/ and commands/.
 * All configuration lives in config/constants.js.
 */

"use strict"

require("dotenv/config")

const { Client, GatewayIntentBits } = require("discord.js")
const logger           = require("./utils/logger")
const { registerGlobalHandlers, setClient } = require("./utils/errorHandler")
const { loadEvents }   = require("./handlers/eventHandler")
const { loadCommands } = require("./handlers/commandHandler")
const { startBackupScheduler } = require("./database/Database")

// ─── Register Global Error Handlers First ─────────────────────────────────────
registerGlobalHandlers()

// ─── Optional MongoDB Connection ──────────────────────────────────────────────
if (process.env.MONGO_URI) {
    const mongoose = require("mongoose")
    mongoose.connect(process.env.MONGO_URI)
        .then(() => logger.startup("MongoDB", "Connected successfully"))
        .catch(err => logger.error("MongoDB", `Connection failed: ${err.message}`))
}

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
})

// Provide client to error handler for graceful shutdown
setClient(client)

// ─── Load Handlers ────────────────────────────────────────────────────────────
loadCommands()
loadEvents(client)

// ─── Start Database Backup Scheduler ─────────────────────────────────────────
startBackupScheduler()

// ─── Login ────────────────────────────────────────────────────────────────────
const token = process.env.BOT_TOKEN
if (!token) {
    logger.error("Startup", "BOT_TOKEN environment variable is not set!")
    process.exit(1)
}

logger.startup("Startup", "Connecting to Discord...")
client.login(token).catch(err => {
    logger.error("Startup", `Failed to login: ${err.message}`)
    process.exit(1)
})
