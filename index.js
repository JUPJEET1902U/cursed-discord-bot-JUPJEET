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
const { normalizeControlConfig, isCommandEnabled } = require("./utils/dashboardControl")
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
const MODERATION_SLASH_COMMANDS = new Set([
    "warn", "warnings", "clearwarns", "mute", "unmute", "kick", "ban",
    "welcome", "autorole",
])
const LEVELING_SLASH_COMMANDS = new Set(["rank", "levels", "leveling"])

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

    setModLogClient(client)

    // ── Register slash commands globally ──────────────────────────────────────
    try {
        const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN)
        const commandData = moderationCmd.commands.map(c => c.toJSON())
        const existingCommands = await rest.get(Routes.applicationCommands(clientUser.user.id))
        const entryPoint = existingCommands.find(cmd => cmd.type === 4)
        const commandsToRegister = entryPoint ? [...commandData, entryPoint] : commandData

        await rest.put(Routes.applicationCommands(clientUser.user.id), {
            body: commandsToRegister,
        })
        console.log(`✅ Registered ${commandData.length} slash command(s)`)
    } catch (err) {
        console.error("Slash command registration error:", err.message)
    }

    cleanupMemory()
    setInterval(cleanupMemory, 60 * 60 * 1000)
    log.info("Startup cleanup complete. Periodic cleanup intervals registered.")
})

client.on(Events.GuildCreate, async (guild) => {
    log.info(`Joined new server: ${guild.name} (${guild.memberCount} members)`)

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
    const rawConfig = getServerConfig(member.guild.id).config

    const { autoroleId } = getAutorole(member.guild.id)
    const roleToAdd = autoroleId || process.env.DEFAULT_ROLE_ID || null
    let assignedRoleId = null
    if (roleToAdd) {
        try {
            await member.roles.add(roleToAdd)
            assignedRoleId = roleToAdd
        } catch (err) {
            log.warn(`[${member.guild.name}] Autorole ${roleToAdd} was not assigned: ${err.message}`)
        }
    }

    // An explicit dashboard or slash-command disable must not fall back to the
    // default AI welcome.
    if (rawConfig.welcomeEnabled === false) return

    const welcomeConfig = getWelcome(member.guild.id)
    if (welcomeConfig.welcomeChannelId) {
        const welcomeArgs = [member, welcomeConfig, callAI]
        if (assignedRoleId) welcomeArgs.push(assignedRoleId)
        sendWelcome(...welcomeArgs).catch(err =>
            log.error(`[Welcome] Error: ${err.message}`)
        )
    } else {
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

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild.id
    const userId = newState.member?.user?.bot ? null : (newState.id || oldState.id)
    if (!userId) return

    const joinedChannel = !oldState.channelId && newState.channelId
    const leftChannel = oldState.channelId && !newState.channelId
    const switchedChannel = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId

    if (joinedChannel) {
        startVoiceSession(guildId, userId)
    } else if (leftChannel) {
        endVoiceSession(guildId, userId).catch(err =>
            log.error(`endVoiceSession (leave) failed: ${err.message}`)
        )
    } else if (switchedChannel) {
        endVoiceSession(guildId, userId).catch(err =>
            log.error(`endVoiceSession (switch) failed: ${err.message}`)
        )
        startVoiceSession(guildId, userId)
    }
})

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.inGuild() && interaction.isChatInputCommand()) {
            const control = normalizeControlConfig(getServerConfig(interaction.guildId).config)
            const slashName = `/${interaction.commandName}`
            const levelingDisabled = LEVELING_SLASH_COMMANDS.has(interaction.commandName)
                && control.disabledModules.includes("leveling")
            const moderationDisabled = MODERATION_SLASH_COMMANDS.has(interaction.commandName)
                && !control.moderationCommandsEnabled

            if (!isCommandEnabled(control, slashName) || levelingDisabled || moderationDisabled) {
                await interaction.reply({
                    content: "⛔ That command is disabled in this server.",
                    ephemeral: true,
                    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
                }).catch(() => {})
                return
            }
        }

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
    const control = normalizeControlConfig(getServerConfig(guildId).config)

    try {
        if (await runAutoMod(message)) return
    } catch (err) {
        log.error(`runAutoMod failed: ${err.message}`, { stack: err.stack, guildId, channelId })
    }

    try {
        if (await moderationCmd.handlePrefixCommand(message)) return
    } catch (err) {
        log.error(`handlePrefixCommand failed: ${err.message}`, { stack: err.stack, guildId, channelId })
    }

    if (!isChannelAllowed(guildId, channelId)) return

    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    trackMessage(guildId, message.author.id).catch(() => {})

    const handled = await dispatchCommand(message, commandModules)
    if (handled) {
        trackCommand(guildId, message.author.id).catch(() => {})
        return
    }

    const botMentioned = message.mentions.users.has(client.user.id)
    const repliedToBot = message.reference?.messageId
        ? await message.fetchReference()
            .then(ref => ref.author.id === client.user.id)
            .catch(() => false)
        : false

    if (!botMentioned && !repliedToBot) return
    if (!control.aiEnabled) {
        await sendSafe(message.channel, "⛔ AI chat is disabled in this server.")
        return
    }

    message.channel.sendTyping().catch(() => {})

    const aiInput = botMentioned
        ? message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim()
        : message.content

    if (!aiInput) {
        await sendSafe(message.channel, "You called? What do you need?")
        return
    }

    const msgLower = aiInput.toLowerCase()
    const rl = checkRateLimit(userId, {
        limit: control.aiRateLimit,
        windowMs: control.aiRateWindowSeconds * 1000,
        scope: guildId,
    })
    if (!rl.ok) {
        await sendSafe(message.channel,
            `⏳ **${senderName}**, slow down! Wait **${rl.remaining}s** before sending another message. 😤`)
        return
    }

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

    const userProfile = getProfile(userId)
    const personality = await getUserPersonality(userId)
    const memoryContext = control.aiLongTermMemoryEnabled
        ? await buildMemoryContext(userId)
        : ""

    let systemPrompt = buildSystemPrompt({
        personality,
        profileInstruction: userProfile?.personality || null,
        hasShield,
        rageMode: isRageMode,
    }) + memoryContext

    if (control.aiCustomPrompt) {
        systemPrompt += `\n\nSERVER-SPECIFIC INSTRUCTIONS:\n${control.aiCustomPrompt}`
    }

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

    const userHistory = control.aiMemoryEnabled ? getUserMemory(guildId, userId) : []
    const chatMessages = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${sanitizedInput}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    log.info(`[${message.guild.name}] #${message.channel.name} | ${senderName}: ${message.content.slice(0, 50)}`)

    let safeOutput = null
    try {
        const result = await callAI(chatMessages, { maxTokens: control.aiMaxTokens })
        log.info(`[${result.provider}] response: ${result.content.slice(0, 60)}...`)

        safeOutput = sanitizeAIOutput(result.content)
        await sendSafe(message.channel, safeOutput)
    } catch (err) {
        await handleCommandError(err, message, "ai-chat")
        return
    }

    if (control.aiMemoryEnabled) {
        try {
            appendUserMemory(guildId, userId, currentUserMsg, safeOutput)
        } catch (err) {
            log.error(`appendUserMemory failed: ${err.message}`, { stack: err.stack, userId })
        }
    }

    if (control.aiLongTermMemoryEnabled) {
        extractAndStoreMemories(userId, sanitizedInput, safeOutput).catch(err => {
            log.error(`extractAndStoreMemories failed: ${err.message}`, { stack: err.stack, userId })
        })
    }

    try {
        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")
    } catch (err) {
        log.error(`chat stat/quest update failed: ${err.message}`, { stack: err.stack, userId })
    }

    if (control.legacyEconomyXpEnabled) {
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
            addXP(userId, senderName, xpGain)
        } catch (err) {
            log.error(`XP post-processing failed: ${err.message}`, { stack: err.stack, userId })
        }
    }
})

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
process.on("SIGINT", () => shutdown("SIGINT"))

process.on("unhandledRejection", (err) => {
    log.error(`Unhandled rejection: ${err?.message || err}`, { stack: err?.stack })
})

process.on("uncaughtException", (err) => {
    log.error(`Uncaught exception: ${err?.message || err}`, { stack: err?.stack })
})

setClient(client)
startWebhookServer()

client.login(process.env.BOT_TOKEN)
