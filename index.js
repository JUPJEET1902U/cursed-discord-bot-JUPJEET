const { Client, Events, GatewayIntentBits, REST, Routes, ChannelType } = require("discord.js")
require("dotenv/config")
const mongoose = require("mongoose")

// ── Environment validation ─────────────────────────────────────────────────────
const REQUIRED_ENV = ["BOT_TOKEN"]
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k])
if (missingEnv.length) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(", ")}`)
    process.exit(1)
}

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("✅ MongoDB Connected"))
        .catch(err => console.error("❌ MongoDB error:", err.message))
} else {
    console.warn("⚠️  MONGO_URI not set — using in-memory fallback for all data stores")
}

// ── Optional feature availability ─────────────────────────────────────────────
if (!process.env.HF_TOKEN) {
    console.warn("⚠️  HF_TOKEN not set — !imagine and !meme commands will be disabled")
}
if (!process.env.DISCORD_REDIRECT_URI) {
    console.warn("⚠️  DISCORD_REDIRECT_URI not set — dashboard OAuth login will not work")
}

const { callAI, getStatus: getAIStatus } = require("./utils/ai")
const { getUserMemory, appendUserMemory, cleanupMemory } = require("./utils/memory")
require("./utils/antiSpam") // side-effect: registers the 30s messageLog cleanup interval
const { getUser, saveEconomy, addXP, incrementStat, updateQuestProgress } = require("./utils/economy")
const { checkRateLimit } = require("./utils/cooldowns")
const { getProfile } = require("./utils/profiles")
const { isChannelAllowed, getServerConfig, saveConfig } = require("./utils/serverConfig")
const { startWebhookServer, setClient } = require("./webhook")
const { setClient: setModLogClient } = require("./utils/modlog")
const { runAutoMod } = require("./utils/automod")
const { sendSafe } = require("./utils/mentionSanitizer")
const { sanitizeUserInput, sanitizeAIOutput, sanitizeName } = require("./utils/sanitizer")
const { buildSystemPrompt } = require("./utils/prompts")
const { getUserPersonality } = require("./utils/personalities")
const { extractAndStoreMemories, buildMemoryContext } = require("./utils/longTermMemory")
const { needsDiscordContext, buildDiscordContext } = require("./utils/discordContext")
const { trackMessage, trackCommand, startVoiceSession, endVoiceSession, getActivity } = require("./utils/activityTracker")
const { handleCommandError } = require("./utils/errorFormatter")
const logger = require("./utils/logger")
const log = logger.child("Index")
const { loadCommands, dispatchCommand } = require("./handlers/commandLoader")
const moderationCmd = require("./commands/moderation")
const { sendWelcome, getWelcome } = require("./utils/welcome")
const { getAutorole } = require("./utils/autorole")

const RAGE_TRIGGERS = ["randi"]

// Load all command modules once at startup
const commandModules = loadCommands()

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ]
})

client.once(Events.ClientReady, async (clientUser) => {
    console.log(`Logged in as ${clientUser.user.tag}`)
    console.log(`Serving ${clientUser.guilds.cache.size} server(s)`)

    const ai = getAIStatus()
    console.log(`AI: Groq=${ai.groqConfigured} | Gemini=${ai.geminiConfigured}`)

    try {
        await clientUser.user.setUsername("CURSED")
        console.log("Bot name set to CURSED")
    } catch (err) {
        console.error("Could not change username:", err.message)
    }

    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${clientUser.user.id}&permissions=8&scope=bot%20applications.commands`
    console.log(`\n=== BOT INVITE LINK ===\n${inviteLink}\n======================\n`)

    // ── Pass client to mod-log utility ─────────────────────────────────────────
    // logAction() already reads each guild's modLogChannelId from serverConfig
    // per-call, with MOD_LOG_CHANNEL_ID as an optional global fallback — no
    // startup restoration step is needed (and copying one guild's saved
    // channel into the global env var would leak across guilds).
    setModLogClient(client)

    // ── Register slash commands globally ──────────────────────────────────────
    try {
        const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN)
        const commandData = moderationCmd.commands.map(c => c.toJSON())

const existingCommands = await rest.get(
    Routes.applicationCommands(clientUser.user.id)
)

const entryPoint = existingCommands.find(
    cmd => cmd.type === 4
)

const commandsToRegister = entryPoint
    ? [...commandData, entryPoint]
    : commandData

await rest.put(
    Routes.applicationCommands(clientUser.user.id),
    {
        body: commandsToRegister
    }
)
        console.log(`✅ Registered ${commandData.length} slash command(s)`)
    } catch (err) {
        console.error("Slash command registration error:", err.message)
    }


    // ── Startup cleanup ────────────────────────────────────────────────────────
    // Run once immediately to clear any stale data from a previous run, then
    // schedule periodic cleanup. antiSpam and sessions have their own internal
    // intervals; memory cleanup is added here since it has no internal timer.
    cleanupMemory()
    setInterval(cleanupMemory, 60 * 60 * 1000) // every hour

    log.info("Startup cleanup complete. Periodic cleanup intervals registered.")
})

client.on(Events.GuildCreate, async (guild) => {
    log.info(`Joined new server: ${guild.name} (${guild.memberCount} members)`)

    // Persist a default per-guild config immediately so Welcome, Autorole,
    // logging, and other settings are ready with no manual setup required.
    try {
        const { data } = getServerConfig(guild.id)
        saveConfig(data)
    } catch (err) {
        log.error(`Failed to initialize server config for ${guild.id}: ${err.message}`)
    }

    const channel = guild.systemChannel
        || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has("SendMessages"))
    if (channel) {
        await sendSafe(channel,
            `👹 **CURSED has arrived.** I'm your AI-powered Discord companion with roasting energy and a kind heart.\n\n` +
            `📖 Type \`!help\` to see all **${require("./utils/helpGenerator").getTotalCommandCount()} commands**.\n` +
            `⚙️ Admins: use \`!addchannel\` to limit me to specific channels.\n` +
            `💎 Set up Premium: \`!setpremiumrole @role\` and \`!setpayment kofi/patreon/bmc [url]\`.`
        ).catch(() => {})
    }
})

client.on(Events.GuildMemberAdd, async (member) => {
    // ── Autorole — per-guild config takes precedence over env-var fallback ─────
    const { autoroleId } = getAutorole(member.guild.id)
    const roleToAdd = autoroleId || process.env.DEFAULT_ROLE_ID || null
    if (roleToAdd) {
        try { await member.roles.add(roleToAdd) } catch { }
    }

    // Send welcome message (custom or AI)
    const welcomeConfig = getWelcome(member.guild.id)

    if (welcomeConfig.welcomeChannelId) {
        // Custom welcome is configured
        sendWelcome(member, welcomeConfig, callAI).catch(err =>
            log.error(`[Welcome] Error: ${err.message}`)
        )
    } else {
        // Fall back to default AI welcome in system channel
        const channel = member.guild.systemChannel
            || member.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(member.guild.members.me)?.has("SendMessages"))
        if (!channel) return

        const name = sanitizeName(member.displayName || member.user.username)
        try {
            const result = await callAI([
                {
                    role: "system",
                    content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. Keep it to 2-3 sentences, funny but not mean. Never use @mentions or Discord IDs."
                },
                { role: "user", content: `Welcome this new member: ${name}` }
            ], { maxTokens: 150 })
            const safeWelcome = sanitizeAIOutput(result.content)
            await sendSafe(channel, `👋 **Welcome, ${name}!** ${safeWelcome}`)
        } catch {
            await sendSafe(channel, `👋 **Welcome to the server, ${name}!** CURSED is watching you. 👀`)
        }
    }
})

// ── Voice activity tracking ────────────────────────────────────────────────────
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild.id
    const userId  = newState.member?.user?.bot ? null : (newState.id || oldState.id)
    if (!userId) return

    const joinedChannel  = !oldState.channelId && newState.channelId
    const leftChannel    = oldState.channelId && !newState.channelId
    const switchedChannel = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId

    if (joinedChannel) {
        startVoiceSession(guildId, userId)
    } else if (leftChannel) {
        endVoiceSession(guildId, userId).catch(err =>
            log.error(`endVoiceSession (leave) failed: ${err.message}`)
        )
    } else if (switchedChannel) {
        // Treat as leave + join so time in old channel is saved
        endVoiceSession(guildId, userId).catch(err =>
            log.error(`endVoiceSession (switch) failed: ${err.message}`)
        )
        startVoiceSession(guildId, userId)
    }
})

// ── Slash command interactions ─────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await moderationCmd.handleInteraction(interaction)
    } catch (err) {
        console.error("Interaction error:", err.message)
        const reply = { content: "❌ An error occurred while processing that command.", ephemeral: true }
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(() => {})
        } else {
            await interaction.reply(reply).catch(() => {})
        }
    }
})

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return
    if (!message.guild) return

    const guildId = message.guild.id
    const channelId = message.channel.id

    // ── Auto-moderation (runs before channel allow-list check) ────────────────
    // Isolated so a filter throwing here can't become an unhandled rejection
    // that silently kills the rest of the message pipeline (including AI chat).
    try {
        if (await runAutoMod(message)) return
    } catch (err) {
        log.error(`runAutoMod failed: ${err.message}`, { stack: err.stack, guildId, channelId })
    }

    // ── Moderation prefix commands (admin config) ─────────────────────────────
    try {
        if (await moderationCmd.handlePrefixCommand(message)) return
    } catch (err) {
        log.error(`handlePrefixCommand failed: ${err.message}`, { stack: err.stack, guildId, channelId })
    }

    if (!isChannelAllowed(guildId, channelId)) return

    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── Activity tracking — message count (fire-and-forget) ───────────────────
    trackMessage(guildId, message.author.id).catch(() => {})

    // ── Dispatch to command modules ────────────────────────────────────────────
    const handled = await dispatchCommand(message, commandModules)
    if (handled) {
        trackCommand(guildId, message.author.id).catch(() => {})
        return
    }

    // ── Trigger check: only respond when mentioned or replied to ──────────────
    const botMentioned = message.mentions.users.has(client.user.id)
    const repliedToBot = message.reference?.messageId
        ? await message.fetchReference()
            .then(ref => ref.author.id === client.user.id)
            .catch(() => false)
        : false

    if (!botMentioned && !repliedToBot) return

    message.channel.sendTyping().catch(() => {})

    // ── Build AI input (strip only the bot's own mention when tagged) ──────────
    const aiInput = botMentioned
        ? message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim()
        : message.content

    if (!aiInput) {
        await sendSafe(message.channel, "You called? What do you need?")
        return
    }

    const msgLower = aiInput.toLowerCase()

    // ── Rate limiting for AI chat ──────────────────────────────────────────────
    const rl = checkRateLimit(userId)
    if (!rl.ok) {
        await sendSafe(message.channel,
            `⏳ **${senderName}**, slow down! Wait **${rl.remaining}s** before sending another message. 😤`)
        return
    }

    // ── Prompt injection check ─────────────────────────────────────────────────
    const { safe, sanitized: sanitizedInput } = sanitizeUserInput(aiInput)
    if (!safe) {
        await sendSafe(message.channel, `🛡️ Nice try, **${senderName}**. I see what you're doing. 😏`)
        return
    }

    const isRageMode = RAGE_TRIGGERS.some(t => msgLower.includes(t))
    if (isRageMode) log.info("RAGE MODE ACTIVATED")

    const { data: ecoData, user: ecoUser } = getUser(userId, senderName)

    const hasShield = (ecoUser.roastShield || 0) > 0
    if (hasShield) {
        ecoUser.roastShield--
        ecoUser.stats = ecoUser.stats || {}
        ecoUser.stats.shieldUsed = (ecoUser.stats.shieldUsed || 0) + 1
        saveEconomy(ecoData)
    }

    // ── Build system prompt with personality + profile + memory ───────────────
    const userProfile = getProfile(userId)
    const personality = await getUserPersonality(userId)
    const memoryContext = await buildMemoryContext(userId)

    let systemPrompt = buildSystemPrompt({
        personality,
        profileInstruction: userProfile?.personality || null,
        hasShield,
        rageMode: isRageMode,
    }) + memoryContext

    // ── Inject real Discord context when the question warrants it ─────────────
    if (needsDiscordContext(sanitizedInput)) {
        try {
            const selfActivity = await getActivity(guildId, userId)
            const mentionedMember = message.mentions.members?.first()
            const mentionedActivity = (mentionedMember && mentionedMember.id !== userId)
                ? await getActivity(guildId, mentionedMember.id)
                : null
            systemPrompt += buildDiscordContext({ message, selfActivity, mentionedActivity })
        } catch (err) {
            log.error(`Discord context injection failed: ${err.message}`)
        }
    }

    const userHistory = getUserMemory(guildId, userId)
    const chatMessages = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${sanitizedInput}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    log.info(`[${message.guild.name}] #${message.channel.name} | ${senderName}: ${message.content.slice(0, 50)}`)

    let safeOutput = null
    try {
        const result = await callAI(chatMessages, { maxTokens: 500 })
        log.info(`[${result.provider}] response: ${result.content.slice(0, 60)}...`)

        safeOutput = sanitizeAIOutput(result.content)
        await sendSafe(message.channel, safeOutput)
    } catch (err) {
        // Only a genuine AI-generation or reply-send failure reaches here —
        // the user has NOT received a response yet, so the error is real.
        await handleCommandError(err, message, "ai-chat")
        return
    }

    // ── Post-reply side effects ────────────────────────────────────────────────
    // The AI reply was already generated and sent successfully above. Everything
    // below is optional bookkeeping (memory, stats, XP, achievements) — each is
    // isolated so a failure here is logged but NEVER surfaces a user-facing
    // "Something went wrong" message for a request that already succeeded.
    try {
        appendUserMemory(guildId, userId, currentUserMsg, safeOutput)
    } catch (err) {
        log.error(`appendUserMemory failed: ${err.message}`, { stack: err.stack, userId })
    }

    // Extract long-term memories asynchronously (non-blocking, already isolated)
    extractAndStoreMemories(userId, sanitizedInput, safeOutput).catch(err => {
        log.error(`extractAndStoreMemories failed: ${err.message}`, { stack: err.stack, userId })
    })

    try {
        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")
    } catch (err) {
        log.error(`chat stat/quest update failed: ${err.message}`, { stack: err.stack, userId })
    }

    try {
        let xpGain = Math.floor(Math.random() * 11) + 5
        const freshEco = getUser(userId, senderName)
        if ((freshEco.user.xpBoost || 0) > 0) {
            xpGain *= 2
            freshEco.user.xpBoost--
            freshEco.user.stats = freshEco.user.stats || {}
            freshEco.user.stats.xpBoostUsed = (freshEco.user.stats.xpBoostUsed || 0) + 1
            saveEconomy(freshEco.data)
        }
        const { leveledUp, newLevel } = addXP(userId, senderName, xpGain)
        if (leveledUp) {
            await sendSafe(message.channel, `🎉 **${senderName}** leveled up to **Level ${newLevel}**! Congrats, I guess. 💀`)
        }
    } catch (err) {
        log.error(`XP/level-up post-processing failed: ${err.message}`, { stack: err.stack, userId })
    }

})

// ── Graceful shutdown (Priority 11) ───────────────────────────────────────────
async function shutdown(signal) {
    log.info(`Received ${signal} — shutting down gracefully...`)
    try {
        client.destroy()
        log.info("Discord client destroyed")
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close()
            log.info("MongoDB connection closed")
        }
    } catch (err) {
        log.error(`Shutdown error: ${err.message}`)
    }
    process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

process.on("unhandledRejection", (err) => {
    log.error(`Unhandled rejection: ${err?.message || err}`, { stack: err?.stack })
})

process.on("uncaughtException", (err) => {
    log.error(`Uncaught exception: ${err?.message || err}`, { stack: err?.stack })
    // Don't exit — let Railway restart if truly fatal
})

setClient(client)
startWebhookServer()

client.login(process.env.BOT_TOKEN)
