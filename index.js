const { Client, Events, GatewayIntentBits, REST, Routes } = require("discord.js")
require("dotenv/config")
const mongoose = require("mongoose")

const { callAI, getStatus: getAIStatus } = require("./utils/ai")
const { getUserMemory, appendUserMemory } = require("./utils/memory")
const { getUser, saveEconomy, addXP, checkAndGrantAchievements, incrementStat, updateQuestProgress } = require("./utils/economy")
const { checkRateLimit } = require("./utils/cooldowns")
const { getProfile } = require("./utils/profiles")
const { isChannelAllowed, loadConfig } = require("./utils/serverConfig")
const { startWebhookServer, setClient } = require("./webhook")
const { setClient: setModLogClient } = require("./utils/modlog")
const { runAutoMod } = require("./utils/automod")

const funCmd          = require("./commands/fun")
const economyCmd      = require("./commands/economy")
const gamblingCmd     = require("./commands/gambling")
const questsCmd       = require("./commands/quests")
const petsCmd         = require("./commands/pets")
const profilesCmd     = require("./commands/profiles")
const achievementsCmd = require("./commands/achievements")
const premiumCmd      = require("./commands/premium")
const moderationCmd   = require("./commands/moderation")

const SYSTEM_PROMPT = `You are CURSED, a Discord bot with a split personality: you are genuinely kind and helpful, always giving useful answers and assisting people — but you can't help yourself fro[...]
You mix sincere helpfulness with playful jabs and witty insults. Keep responses short and punchy. Never be mean-spirited to the point of being hurtful, but don't hold back on the banter.
IMPORTANT: Always detect the language of the user's message and reply in that same language. If they write in Hindi, reply in Hindi. If they write in Spanish, reply in Spanish. Match their language ex[...]

const RAGE_PROMPT = `You are CURSED in FULL RAGE MODE. Someone said the forbidden word. You are absolutely unhinged, furious, and going completely off the rails.
Respond with maximum chaotic energy — all caps where it feels right, dramatic overreactions, wild accusations, pure madness.
Be hilariously over-the-top angry. Keep it funny and absurd, not genuinely hurtful. Go FULL CURSED.
IMPORTANT: Always detect the language of the user's message and reply in that same language. Match their language exactly.`

const RAGE_TRIGGERS = ["randi"]

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
        await channel.send(
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
        await channel.send(`👋 ${member} ${result.content}`)
    } catch {
        await channel.send(`👋 Welcome to the server, ${member}! CURSED is watching you. 👀`)
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
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower === "!help") {
        await message.channel.send(
            `**👹 CURSED BOT — ALL COMMANDS**\n\n` +
            `**💰 Economy**\n` +
            `🎁 \`!daily\` | 💰 \`!balance\` | ⭐ \`!rank\` | 💸 \`!give @user [amt]\`\n` +
            `🏦 \`!richlist\` | 📊 \`!levels\` | 🛒 \`!shop\` | 🛍️ \`!buy [item]\`\n\n` +
            `**🎮 Fun & Games**\n` +
            `🔥 \`!roast @user\` | 🏆 \`!leaderboard\` | 🧠 \`!trivia\` | 🔮 \`!fortune\`\n` +
            `📖 \`!story [theme]\` | 🎭 \`!roleplay [scenario]\` | ⚔️ \`!challenge\`\n` +
            `🎨 \`!imagine [prompt]\` | 😂 \`!meme [topic]\` | 🧹 \`!forget\`\n\n` +
            `**🎲 Gambling**\n` +
            `🎲 \`!gamble [amt]\` | 🟡 \`!coinflip [amt] [heads/tails]\` | 🎰 \`!slots [amt]\`\n\n` +
            `**📋 Quests & Achievements**\n` +
            `📋 \`!quests\` | ✅ \`!claimquests\` | 🏆 \`!achievements\`\n\n` +
            `**🐾 Pets**\n` +
            `🐾 \`!adopt [type] [name]\` | 😺 \`!mypet\` | 🍖 \`!feedpet\` | 🎾 \`!petplay\` | 💬 \`!petsay [msg]\`\n\n` +
            `**👤 Profile**\n` +
            `👤 \`!profile [@user]\` | ✏️ \`!setprofile [personality]\` | 🗑️ \`!clearprofile\`\n\n` +
            `**💎 Premium**\n` +
            `💎 \`!premium\` | 🔑 \`!verify [code]\`\n\n` +
            `**🛡️ Moderation (Slash Commands)**\n` +
            `⚠️ \`/warn @user reason\` | 📋 \`/warnings @user\` | 🗑️ \`/clearwarns @user\`\n` +
            `🔇 \`/mute @user [minutes]\` | 🔊 \`/unmute @user\` | 👢 \`/kick @user reason\` | 🔨 \`/ban @user reason\`\n\n` +
            `**⚙️ Admin Only**\n` +
            `📢 \`!addchannel\` | \`!removechannel\` | \`!channels\`\n` +
            `🎭 \`!setpremiumrole @role\` | \`!setpayment [platform] [url]\` | \`!gencode\` | \`!givepremium @user\`\n` +
            `📝 \`!setmodlog\` | \`!antispam on|off\` | \`!antilink on|off\` | \`!antiinvite on|off\`\n` +
            `🔗 \`!whitelist add|remove <domain>\`\n\n` +
            `💬 *Chat normally — I remember you & give XP per message! Works in all channels.*`
        )
        return
    }

    if (await premiumCmd.handle(message)) return
    if (await funCmd.handle(message)) return
    if (await economyCmd.handle(message)) return
    if (await gamblingCmd.handle(message)) return
    if (await questsCmd.handle(message)) return
    if (await petsCmd.handle(message)) return
    if (await profilesCmd.handle(message)) return
    if (await achievementsCmd.handle(message)) return

    const rl = checkRateLimit(userId)
    if (!rl.ok) {
        await message.channel.send(`⚠️ **${senderName}**, slow down! Wait **${rl.remaining}s** — even I need to breathe. 😤`)
        return
    }

    const isRageMode = RAGE_TRIGGERS.some(t => msgLower.includes(t))
    if (isRageMode) console.log("🔥 RAGE MODE ACTIVATED")

    const { data: ecoData, user: ecoUser } = getUser(userId, senderName)

    const hasShield = (ecoUser.roastShield || 0) > 0
    if (hasShield) { ecoUser.roastShield--; saveEconomy(ecoData) }

    const userProfile = getProfile(userId)
    let systemPrompt
    if (isRageMode) {
        systemPrompt = RAGE_PROMPT
    } else {
        systemPrompt = userProfile?.personality
            ? `${SYSTEM_PROMPT}\n\nSPECIAL INSTRUCTION for this user: ${userProfile.personality}`
            : SYSTEM_PROMPT
        if (hasShield) systemPrompt += "\n\nIMPORTANT: This user has a Roast Shield active. Be KIND and helpful only — NO roasting or insults this message."
    }

    const userHistory = getUserMemory(userId)
    const chatMessages = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${message.content}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    console.log(`[${message.guild.name}] #${message.channel.name} | ${senderName}: ${message.content.slice(0, 50)}`)

    try {
        const result = await callAI(chatMessages, { maxTokens: 500 })
        console.log(`[${result.provider}] response: ${result.content.slice(0, 60)}...`)
        await message.channel.send(result.content)
        appendUserMemory(userId, currentUserMsg, result.content)

        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")

        let xpGain = Math.floor(Math.random() * 11) + 5
        const freshEco = getUser(userId, senderName)
        if ((freshEco.user.xpBoost || 0) > 0) {
            xpGain *= 2
            freshEco.user.xpBoost--
            saveEconomy(freshEco.data)
        }
        const { leveledUp, newLevel } = addXP(userId, senderName, xpGain)
        if (leveledUp) {
            await message.channel.send(`🎉 **${senderName}** leveled up to **Level ${newLevel}**! Congrats, I guess. 💀`)
        }

        const newAchs = checkAndGrantAchievements(userId, senderName)
        for (const a of newAchs) {
            await message.channel.send(`🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`)
        }
    } catch (err) {
        console.error("AI error:", err.message)
        if (err.status === 429) await message.channel.send("⚠️ AI is rate limited right now. Try again in a moment!")
        else await message.channel.send("⚠️ Something went wrong. Try again!")
    }
})

process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err)
})

client.login(process.env.BOT_TOKEN)
