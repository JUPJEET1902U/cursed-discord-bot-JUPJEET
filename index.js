const { Client, Events, GatewayIntentBits, REST, Routes } = require("discord.js")
require("dotenv/config")
const mongoose = require("mongoose")

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB error:", err))

const { callAI, getStatus: getAIStatus } = require("./utils/ai")
const { getUserMemory, appendUserMemory } = require("./utils/memory")
const { getUser, saveEconomy, addXP, checkAndGrantAchievements, incrementStat, updateQuestProgress } = require("./utils/economy")
const { checkRateLimit } = require("./utils/cooldowns")
const { getProfile } = require("./utils/profiles")
const { isChannelAllowed, loadConfig } = require("./utils/serverConfig")
const { startWebhookServer, setClient } = require("./webhook")
const { setClient: setModLogClient } = require("./utils/modlog")
const { runAutoMod } = require("./utils/automod")
const {
    sanitizeMentions,
    createSafeReply,
    createSafeMessage,
    createSafeInteractionReply,
    createSafeInteractionFollowUp
} = require("./utils/sanitizeMentions")
const { sanitizeUserInput, sanitizeAIOutput, sanitizeName } = require("./utils/sanitizer")
const { buildSystemPrompt } = require("./utils/prompts")
const { getUserPersonality } = require("./utils/personalities")
const { extractAndStoreMemories, buildMemoryContext } = require("./utils/longTermMemory")
const logger = require("./utils/logger")
const log = logger.child("Index")
const { loadCommands, dispatchCommand } = require("./handlers/commandLoader")
const moderationCmd = require("./commands/moderation")

const RAGE_TRIGGERS = ["randi"]

// Load all command modules once at startup
const commandModules = loadCommands()

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
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
    setModLogClient(client)

    // ── Restore mod-log channel IDs from persisted serverConfig ───────────────
    const savedConfig = loadConfig()
    for (const [guildId, cfg] of Object.entries(savedConfig)) {
        if (cfg.modLogChannelId && !process.env.MOD_LOG_CHANNEL_ID) {
            // Use the first guild's saved channel as the default if env var not set
            process.env.MOD_LOG_CHANNEL_ID = cfg.modLogChannelId
            console.log(`Mod-log channel restored: ${cfg.modLogChannelId} (guild ${guildId})`)
            break
        }
    }

    // ── Register slash commands globally ──────────────────────────────────────
    try {
        const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN)
        const commandData = moderationCmd.commands.map(c => c.toJSON())
        await rest.put(
            Routes.applicationCommands(clientUser.user.id),
            { body: commandData }
        )
        console.log(`✅ Registered ${commandData.length} slash command(s)`)
    } catch (err) {
        console.error("Slash command registration error:", err.message)
    }

    setClient(client)
    startWebhookServer()
})

client.on(Events.GuildCreate, async (guild) => {
    console.log(`✅ Joined new server: ${guild.name} (${guild.memberCount} members)`)
    const channel = guild.systemChannel
        || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has("SendMessages"))
    if (channel) {
        await createSafeMessage(
    channel,
            `👹 **CURSED has arrived.** I'm your new AI bot with roasting energy and a kind heart.\n\n` +
            `Type \`!help\` to see all commands. Admins: use \`!addchannel\` to limit me to specific channels, or I'll respond everywhere.\n\n` +
            `💎 Want to set up **Premium roles**? Use \`!setpremiumrole @role\` and \`!setpayment kofi/patreon/bmc [url]\`.`
        ).catch(() => {})
    }
})

client.on(Events.GuildMemberAdd, async (member) => {
    try { await member.roles.add("1514144073555116202") } catch { }
    const channel = member.guild.systemChannel
        || member.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(member.guild.members.me)?.has("SendMessages"))
    if (!channel) return
    const name = member.displayName || member.user.username
    try {
        const result = await callAI([
            { role: "system", content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. 2-3 sentences, funny." },
            { role: "user", content: `Welcome this new member: ${name}` }
        ], { maxTokens: 150 })
        await createSafeMessage(
    channel,
    `👋 ${member} ${result.content}`
)
    } catch {
       await createSafeMessage(
    channel,
    `👋 Welcome to the server, ${member}! CURSED is watching you. 👀`
)
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
    if (await runAutoMod(message)) return

    // ── Moderation prefix commands (admin config) ─────────────────────────────
    if (await moderationCmd.handlePrefixCommand(message)) return

    if (!isChannelAllowed(guildId, channelId)) return

    message.channel.sendTyping()

    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower === "!help") {
        await createSafeMessage(message.channel,
            `**👹 CURSED BOT v3.0 — ALL COMMANDS**\n\n` +
            `**💰 Economy**\n` +
            `🎁 \`!daily\` | 💰 \`!balance\` | ⭐ \`!rank\` | 💸 \`!give @user [amt]\`\n` +
            `🏦 \`!richlist\` | 📊 \`!levels\` | 🛒 \`!shop\` | 🛍️ \`!buy [item]\`\n\n` +
            `**💼 Advanced Economy**\n` +
            `💼 \`!work\` | 🦹 \`!crime\` | 🏦 \`!heist\` | 📈 \`!invest [amt]\` | 💹 \`!collect\`\n` +
            `🏢 \`!business\` | 🏭 \`!factory\` | 🏦 \`!bank\` | 💹 \`!interest\`\n\n` +
            `**🎮 Fun & Games**\n` +
            `🔥 \`!roast @user\` | 🧠 \`!trivia\` | 🔮 \`!fortune\` | 📖 \`!story [theme]\`\n` +
            `🎭 \`!roleplay [scenario]\` | 🎨 \`!imagine [prompt]\` | 😂 \`!meme [topic]\` | 🧹 \`!forget\`\n\n` +
            `**🎲 Gambling & Mini-Games**\n` +
            `🎲 \`!gamble [amt]\` | 🟡 \`!coinflip [amt] [h/t]\` | 🎰 \`!slots [amt]\`\n` +
            `🔢 \`!guess [bet]\` | 💣 \`!mines [bet]\` | 🃏 \`!blackjack [bet]\` | ✊ \`!rps [choice]\`\n` +
            `⚔️ \`!duel @user [bet]\` | 🗺️ \`!treasure\` | 🎮 \`!dailygame\`\n\n` +
            `**⚔️ Battle Arena**\n` +
            `⚔️ \`!battle @user\` | 🤖 \`!battleai\` | 👹 \`!bossfight\` | 📊 \`!battlestats\`\n\n` +
            `**📋 Quests & Achievements**\n` +
            `📋 \`!quests\` | ✅ \`!claimquests\` | 🏆 \`!achievements\`\n\n` +
            `**🐾 Pets**\n` +
            `🐾 \`!petshop\` | \`!adopt [type] [name]\` | \`!mypet\` | \`!feedpet\` | \`!petplay\`\n` +
            `🏋️ \`!pettrain\` | ⚔️ \`!petbattle\` | 💊 \`!petheal\` | ✏️ \`!petrename [name]\`\n` +
            `📊 \`!petstats\` | 🎒 \`!petinventory\` | 💬 \`!petsay [msg]\`\n\n` +
            `**📊 Leaderboards**\n` +
            `📊 \`!leaderboard xp\` | \`!leaderboard coins\` | \`!leaderboard battles\`\n` +
            `\`!leaderboard pets\` | \`!leaderboard quests\`\n\n` +
            `**🖼️ Image Analysis**\n` +
            `🖼️ \`!analyze\` | 🔥 \`!roastimage\` | 📝 \`!ocr\` *(attach an image)*\n\n` +
            `**👤 Profile & Personality**\n` +
            `👤 \`!profile [@user]\` | ✏️ \`!setprofile [instruction]\` | 🗑️ \`!clearprofile\`\n` +
            `🎭 \`!personality [type]\` — cursed/friendly/savage/anime/pirate/wise/developer/chaos\n\n` +
            `**🧠 Memory**\n` +
            `🧠 \`!memories\` | 📝 \`!remember [fact]\` | 🗑️ \`!forgetmemory [id]\` | 🧹 \`!clearmemory\`\n\n` +
            `**💎 Premium**\n` +
            `💎 \`!premium\` | 🔑 \`!verify [code]\`\n\n` +
            `**🛡️ Moderation (Slash Commands)**\n` +
            `⚠️ \`/warn\` | 📋 \`/warnings\` | 🗑️ \`/clearwarns\` | 🔇 \`/mute\` | 🔊 \`/unmute\` | 👢 \`/kick\` | 🔨 \`/ban\`\n\n` +
            `**⚙️ Admin Only**\n` +
            `📢 \`!addchannel\` | \`!removechannel\` | \`!channels\`\n` +
            `🎭 \`!setpremiumrole @role\` | \`!setpayment [platform] [url]\` | \`!gencode\` | \`!givepremium @user\`\n` +
            `📝 \`!setmodlog\` | \`!antispam on|off\` | \`!antilink on|off\` | \`!antiinvite on|off\`\n` +
            `📊 \`!botstats\` | \`!aistats\` | \`!economystats\` *(admin)*\n\n` +
            `💬 *Chat normally — I remember you, give XP per message, and adapt to your personality!*`)
        return
    }

    // ── Dispatch to command modules ────────────────────────────────────────────
    const handled = await dispatchCommand(message, commandModules)
    if (handled) return

    // ── Rate limiting for AI chat ──────────────────────────────────────────────
    const rl = checkRateLimit(userId)
    if (!rl.ok) {
        await createSafeMessage(message.channel,
            `⚠️ **${senderName}**, slow down! Wait **${rl.remaining}s** — even I need to breathe. 😤`)
        return
    }

    // ── Prompt injection check ─────────────────────────────────────────────────
    const { safe, sanitized: sanitizedInput } = sanitizeUserInput(message.content)
    if (!safe) {
        await createSafeMessage(message.channel, `🛡️ Nice try, **${senderName}**. I see what you're doing. 😏`)
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

    const systemPrompt = buildSystemPrompt({
        personality,
        profileInstruction: userProfile?.personality || null,
        hasShield,
        rageMode: isRageMode,
    }) + memoryContext

    const userHistory = getUserMemory(userId)
    const chatMessages = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${sanitizedInput}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    log.info(`[${message.guild.name}] #${message.channel.name} | ${senderName}: ${message.content.slice(0, 50)}`)

    try {
        const result = await callAI(chatMessages, { maxTokens: 500 })
        log.info(`[${result.provider}] response: ${result.content.slice(0, 60)}...`)

        const safeOutput = sanitizeAIOutput(result.content)
        await createSafeMessage(message.channel, safeOutput)

        appendUserMemory(userId, currentUserMsg, safeOutput)

        // Extract long-term memories asynchronously (non-blocking)
        extractAndStoreMemories(userId, sanitizedInput, safeOutput).catch(() => {})

        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")

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
            await createSafeMessage(message.channel, `🎉 **${senderName}** leveled up to **Level ${newLevel}**! Congrats, I guess. 💀`)
        }

        const newAchs = checkAndGrantAchievements(userId, senderName)
        for (const a of newAchs) {
            await createSafeMessage(message.channel, `🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`)
        }
    } catch (err) {
        log.error(`AI error: ${err.message}`)
        if (err.status === 429) await createSafeMessage(message.channel, "⚠️ AI is rate limited right now. Try again in a moment!")
        else await createSafeMessage(message.channel, "⚠️ Something went wrong. Try again!")
    }
})

process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err)
})

client.login(process.env.BOT_TOKEN)
