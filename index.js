const { Client, Events, GatewayIntentBits, REST, Routes } = require("discord.js")
require("dotenv/config")
const mongoose = require("mongoose")

const REQUIRED_ENV = ["BOT_TOKEN"]
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key])
if (missingEnv.length) {
    console.error(`Missing required environment variables: ${missingEnv.join(", ")}`)
    process.exit(1)
}

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("MongoDB connected"))
        .catch(error => console.error("MongoDB connection error:", error.message))
} else {
    console.warn("MONGO_URI not set — persistent stores will use their configured fallback behavior")
}

if (!process.env.HF_TOKEN) {
    console.warn("HF_TOKEN not set — image generation commands will be unavailable")
}
if (!process.env.DISCORD_REDIRECT_URI) {
    console.warn("DISCORD_REDIRECT_URI not set — dashboard OAuth login will be unavailable")
}

const { callAI, getStatus: getAIStatus } = require("./utils/ai")
const { getUserMemory, appendUserMemory, cleanupMemory } = require("./utils/memory")
require("./utils/antiSpam")
const { getUser, saveEconomy, addXP, incrementStat, updateQuestProgress } = require("./utils/economy")
const { checkRateLimit } = require("./utils/cooldowns")
const { getProfile } = require("./utils/profiles")
const { isChannelAllowed, getServerConfig, saveConfig } = require("./utils/serverConfig")
const { normalizeControlConfig, isCommandEnabled } = require("./utils/dashboardControl")
const { startWebhookServer, setClient } = require("./webhook")
const { setClient: setModLogClient } = require("./utils/modlog")
const { runAutoMod } = require("./utils/automod")
const { sendSafe, replySafe } = require("./utils/mentionSanitizer")
const { statusLine, commandDisabled, SAFE_MENTIONS } = require("./utils/responseBuilder")
const { recordTiming } = require("./utils/runtimeMetrics")
const { sanitizeUserInput, sanitizeAIOutput, sanitizeName } = require("./utils/sanitizer")
const { buildSystemPrompt } = require("./utils/prompts")
const { getUserPersonality } = require("./utils/personalities")
const { extractAndStoreMemories, buildMemoryContext } = require("./utils/longTermMemory")
const { needsDiscordContext, buildDiscordContext } = require("./utils/discordContext")
const { trackMessage, trackCommand, startVoiceSession, endVoiceSession, getActivity } = require("./utils/activityTracker")
const { formatError } = require("./utils/errorFormatter")
const { getGuildPrefix } = require("./utils/prefix")
const { buildRecommendedInvite } = require("./utils/botPermissions")
const { startGiveawayScheduler } = require("./utils/giveawayService")
const { assignJoinRoles } = require("./utils/autoroleAdvanced")
const logger = require("./utils/logger")
const log = logger.child("Index")
const { loadCommands, dispatchCommand } = require("./handlers/commandLoader")
const moderationCmd = require("./commands/moderation")
const { sendWelcome, getWelcome } = require("./utils/welcome")

const RAGE_TRIGGERS = ["randi"]
const MODERATION_SLASH_COMMANDS = new Set([
    "warn", "warnings", "clearwarns", "mute", "unmute", "kick", "ban",
    "welcome", "autorole",
])
const LEVELING_SLASH_COMMANDS = new Set(["rank", "levels", "leveling"])

const commandModules = loadCommands()

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
})

client.once(Events.ClientReady, async clientUser => {
    log.info(`Ready as ${clientUser.user.tag} in ${clientUser.guilds.cache.size} server(s)`)

    const ai = getAIStatus()
    log.info(`AI providers: Gemini=${ai.geminiConfigured} Groq=${ai.groqConfigured} OpenRouter=${ai.openRouterConfigured}`)

    const inviteLink = buildRecommendedInvite(clientUser.user.id)
    if (inviteLink) log.info(`Recommended invite link: ${inviteLink}`)

    setModLogClient(client)
    startGiveawayScheduler(client)

    try {
        const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN)
        const commandData = moderationCmd.commands.map(command => command.toJSON())
        const existingCommands = await rest.get(Routes.applicationCommands(clientUser.user.id))
        const entryPoint = existingCommands.find(command => command.type === 4)
        const commandsToRegister = entryPoint ? [...commandData, entryPoint] : commandData

        await rest.put(Routes.applicationCommands(clientUser.user.id), { body: commandsToRegister })
        log.info(`Registered ${commandData.length} slash command(s)`)
    } catch (error) {
        log.error(`Slash command registration failed: ${error.message}`)
    }

    cleanupMemory()
    const cleanupTimer = setInterval(cleanupMemory, 60 * 60 * 1000)
    cleanupTimer.unref?.()
    log.info("Startup cleanup complete")
})

client.on(Events.GuildCreate, async guild => {
    log.info(`Joined server ${guild.id} (${guild.memberCount} members)`)

    try {
        const { data } = getServerConfig(guild.id)
        saveConfig(data)
    } catch (error) {
        log.error(`Failed to initialize server config for ${guild.id}: ${error.message}`)
    }

    const channel = guild.systemChannel
        || guild.channels.cache.find(candidate => candidate.isTextBased() && candidate.permissionsFor(guild.members.me)?.has("SendMessages"))
    if (!channel) return

    const totalCommands = require("./utils/helpGenerator").getTotalCommandCount()
    const prefix = getGuildPrefix(guild.id)
    await sendSafe(
        channel,
        `**CURSED is ready.**\nProtection, moderation, automation, AI, community tools, economy and games.\n\nUse \`${prefix}help\` to browse **${totalCommands} commands**. Server managers can run \`${prefix}doctor\` to verify permissions and configuration.`
    ).catch(() => {})
})

client.on(Events.GuildMemberAdd, async member => {
    const rawConfig = getServerConfig(member.guild.id).config

    let assignedRoleId = null
    try {
        const roleResult = await assignJoinRoles(member)
        assignedRoleId = roleResult.assigned[0] || null
        if (roleResult.failed.length) {
            log.warn(`[${member.guild.id}] ${roleResult.failed.length} autorole assignment(s) failed for ${member.id}`)
        }
    } catch (error) {
        log.warn(`[${member.guild.id}] Autorole processing failed for ${member.id}: ${error.message}`)
    }

    if (rawConfig.welcomeEnabled === false) return

    const welcomeConfig = getWelcome(member.guild.id)
    if (welcomeConfig.welcomeChannelId) {
        const welcomeArgs = [member, welcomeConfig, callAI]
        if (assignedRoleId) welcomeArgs.push(assignedRoleId)
        sendWelcome(...welcomeArgs).catch(error => log.error(`[Welcome] ${error.message}`))
        return
    }

    const channel = member.guild.systemChannel
        || member.guild.channels.cache.find(candidate => candidate.isTextBased() && candidate.permissionsFor(member.guild.members.me)?.has("SendMessages"))
    if (!channel) return

    const name = sanitizeName(member.displayName || member.user.username)
    try {
        const result = await callAI([
            {
                role: "system",
                content: "You are CURSED, a professional Discord community bot. Welcome a new member warmly in one or two short sentences. Friendly personality is fine, but avoid insults, exaggerated wording, @mentions, and Discord IDs.",
            },
            { role: "user", content: `Welcome this new member: ${name}` },
        ], { maxTokens: 120 })
        const safeWelcome = sanitizeAIOutput(result.content)
        await sendSafe(channel, `**Welcome, ${name}.** ${safeWelcome}`)
    } catch {
        await sendSafe(channel, `**Welcome, ${name}.** Glad to have you here.`)
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
        endVoiceSession(guildId, userId).catch(error => log.error(`Voice session close failed: ${error.message}`))
    } else if (switchedChannel) {
        endVoiceSession(guildId, userId).catch(error => log.error(`Voice session switch close failed: ${error.message}`))
        startVoiceSession(guildId, userId)
    }
})

client.on(Events.InteractionCreate, async interaction => {
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
                    content: commandDisabled(),
                    ephemeral: true,
                    allowedMentions: SAFE_MENTIONS,
                }).catch(() => {})
                return
            }
        }

        await moderationCmd.handleInteraction(interaction)
    } catch (error) {
        log.error(`Interaction error: ${error.message}`)
        const payload = {
            content: statusLine("error", "The command could not be completed. No partial action will be reported as successful."),
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        }
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => {})
        } else {
            await interaction.reply(payload).catch(() => {})
        }
    }
})

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return

    const guildId = message.guild.id
    const channelId = message.channel.id
    const control = normalizeControlConfig(getServerConfig(guildId).config)

    try {
        if (await runAutoMod(message)) return
    } catch (error) {
        log.error(`AutoMod failed: ${error.message}`, { guildId, channelId })
    }

    try {
        if (await moderationCmd.handlePrefixCommand(message)) return
    } catch (error) {
        log.error(`Prefix moderation failed: ${error.message}`, { guildId, channelId })
    }

    if (!isChannelAllowed(guildId, channelId)) return

    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    trackMessage(guildId, userId).catch(() => {})

    const handled = await dispatchCommand(message, commandModules)
    if (handled) {
        trackCommand(guildId, userId).catch(() => {})
        return
    }

    const botMentioned = message.mentions.users.has(client.user.id)
    const repliedToBot = message.reference?.messageId
        ? await message.fetchReference().then(reference => reference.author.id === client.user.id).catch(() => false)
        : false

    if (!botMentioned && !repliedToBot) return
    if (!control.aiEnabled) {
        await replySafe(message, statusLine("error", "AI chat is disabled in this server."))
        return
    }

    message.channel.sendTyping().catch(() => {})

    const aiInput = botMentioned
        ? message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim()
        : message.content

    if (!aiInput) {
        await replySafe(message, "What can I help with?")
        return
    }

    const msgLower = aiInput.toLowerCase()
    const rateLimit = checkRateLimit(userId, {
        limit: control.aiRateLimit,
        windowMs: control.aiRateWindowSeconds * 1000,
        scope: guildId,
    })
    if (!rateLimit.ok) {
        await replySafe(message, statusLine("cooldown", `AI rate limit reached. Try again in **${rateLimit.remaining}s**.`))
        return
    }

    const { safe, sanitized: sanitizedInput } = sanitizeUserInput(aiInput)
    if (!safe) {
        await replySafe(message, statusLine("warning", "I can't process that request safely."))
        return
    }

    const isRageMode = RAGE_TRIGGERS.some(trigger => msgLower.includes(trigger))
    if (isRageMode) log.debug("AI rage personality trigger matched")

    const { data: economyData, user: economyUser } = getUser(userId, senderName)
    const hasShield = (economyUser.roastShield || 0) > 0
    if (hasShield) {
        economyUser.roastShield--
        economyUser.stats = economyUser.stats || {}
        economyUser.stats.shieldUsed = (economyUser.stats.shieldUsed || 0) + 1
        saveEconomy(economyData)
    }

    const userProfile = getProfile(userId)
    const personality = await getUserPersonality(userId)
    const memoryContext = control.aiLongTermMemoryEnabled ? await buildMemoryContext(userId) : ""

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
            const mentionedActivity = mentionedMember && mentionedMember.id !== userId
                ? await getActivity(guildId, mentionedMember.id)
                : null
            systemPrompt += buildDiscordContext({ message, selfActivity, mentionedActivity })
        } catch (error) {
            log.error(`Discord context injection failed: ${error.message}`)
        }
    }

    const userHistory = control.aiMemoryEnabled ? getUserMemory(guildId, userId) : []
    const chatMessages = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${sanitizedInput}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    log.debug(`AI request guild=${guildId} channel=${channelId} user=${userId}`)

    let safeOutput = null
    const aiStartedAt = Date.now()
    try {
        const result = await callAI(chatMessages, { maxTokens: control.aiMaxTokens })
        recordTiming("ai.chat.total", Date.now() - aiStartedAt)
        log.debug(`AI response provider=${result.provider} latency=${result.latencyMs ?? "unknown"}ms`)
        safeOutput = sanitizeAIOutput(result.content)
        await replySafe(message, safeOutput)
    } catch (error) {
        recordTiming("ai.chat.failure", Date.now() - aiStartedAt)
        const userMessage = formatError(error, "ai-chat", { guildId, channelId, userId })
        await replySafe(message, userMessage)
        return
    }

    if (control.aiMemoryEnabled) {
        try {
            appendUserMemory(guildId, userId, currentUserMsg, safeOutput)
        } catch (error) {
            log.error(`Short-term memory update failed: ${error.message}`, { userId })
        }
    }

    if (control.aiLongTermMemoryEnabled) {
        extractAndStoreMemories(userId, sanitizedInput, safeOutput).catch(error => {
            log.error(`Long-term memory extraction failed: ${error.message}`, { userId })
        })
    }

    try {
        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")
    } catch (error) {
        log.error(`AI activity update failed: ${error.message}`, { userId })
    }

    if (control.legacyEconomyXpEnabled) {
        try {
            let xpGain = Math.floor(Math.random() * 11) + 5
            const freshEconomy = getUser(userId, senderName)
            if ((freshEconomy.user.xpBoost || 0) > 0) {
                xpGain *= 2
                freshEconomy.user.xpBoost--
                freshEconomy.user.stats = freshEconomy.user.stats || {}
                freshEconomy.user.stats.xpBoostUsed = (freshEconomy.user.stats.xpBoostUsed || 0) + 1
                saveEconomy(freshEconomy.data)
            }
            addXP(userId, senderName, xpGain)
        } catch (error) {
            log.error(`Legacy XP update failed: ${error.message}`, { userId })
        }
    }
})

async function shutdown(signal) {
    log.info(`Received ${signal}; shutting down gracefully`)
    try {
        client.destroy()
        if (mongoose.connection.readyState === 1) await mongoose.connection.close()
        log.info("Shutdown complete")
    } catch (error) {
        log.error(`Shutdown error: ${error.message}`)
    }
    process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

process.on("unhandledRejection", error => {
    log.error(`Unhandled rejection: ${error?.message || error}`, { stack: error?.stack })
})

process.on("uncaughtException", error => {
    log.error(`Uncaught exception: ${error?.message || error}`, { stack: error?.stack })
})

setClient(client)
startWebhookServer()
client.login(process.env.BOT_TOKEN)