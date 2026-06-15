/**
 * @fileoverview Professional help command for CURSED Bot.
 *
 * Commands:
 *   !help           — Full command list organized by category
 *   !help [command] — Detailed help for a specific command
 *
 * @category Help
 */

"use strict"

const embed  = require("../utils/embedBuilder")
const { BOT, COLORS, EMOJIS, HELP_CATEGORIES } = require("../config/constants")

/** @type {{ name: string, description: string, usage: string, category: string }} */
const metadata = {
    name:        "help",
    description: "Show all commands or get help for a specific command",
    usage:       "!help | !help [command]",
    category:    "Help",
}

// ─── Command Definitions ──────────────────────────────────────────────────────

const COMMANDS = {
    // Economy
    daily:        { category: "ECONOMY",    desc: "Claim your daily coin reward",                    usage: "!daily",                    cooldown: "24h" },
    balance:      { category: "ECONOMY",    desc: "Check your coin balance and XP",                  usage: "!balance",                  cooldown: null  },
    rank:         { category: "ECONOMY",    desc: "See your server rank and XP",                     usage: "!rank",                     cooldown: null  },
    give:         { category: "ECONOMY",    desc: "Give coins to another user",                      usage: "!give @user [amount]",      cooldown: null  },
    richlist:     { category: "ECONOMY",    desc: "Top 10 richest users",                            usage: "!richlist",                 cooldown: null  },
    levels:       { category: "ECONOMY",    desc: "Top 10 users by XP level",                       usage: "!levels",                   cooldown: null  },
    shop:         { category: "ECONOMY",    desc: "Browse the item shop",                            usage: "!shop",                     cooldown: null  },
    buy:          { category: "ECONOMY",    desc: "Buy an item from the shop",                       usage: "!buy [item]",               cooldown: null  },

    // Fun
    roast:        { category: "FUN",        desc: "Roast a user with AI-generated insults",          usage: "!roast [@user]",            cooldown: "15s" },
    leaderboard:  { category: "FUN",        desc: "Most roasted users leaderboard",                  usage: "!leaderboard",              cooldown: null  },
    trivia:       { category: "FUN",        desc: "Start a trivia question",                         usage: "!trivia",                   cooldown: "20s" },
    fortune:      { category: "FUN",        desc: "Get your fortune told",                           usage: "!fortune",                  cooldown: "30s" },
    story:        { category: "FUN",        desc: "Generate a short story",                          usage: "!story [theme]",            cooldown: "20s" },
    roleplay:     { category: "FUN",        desc: "Start an AI roleplay scenario",                   usage: "!roleplay [scenario]",      cooldown: "20s" },
    challenge:    { category: "FUN",        desc: "Get a daily challenge",                           usage: "!challenge",                cooldown: "60s" },
    imagine:      { category: "FUN",        desc: "Generate an AI image",                            usage: "!imagine [prompt]",         cooldown: "30s" },
    meme:         { category: "FUN",        desc: "Generate a meme image",                           usage: "!meme [topic]",             cooldown: "30s" },
    forget:       { category: "FUN",        desc: "Clear your conversation memory",                  usage: "!forget",                   cooldown: null  },

    // Gambling
    gamble:       { category: "GAMBLING",   desc: "Gamble coins (50/50 chance)",                     usage: "!gamble [amount]",          cooldown: "20s" },
    coinflip:     { category: "GAMBLING",   desc: "Flip a coin and bet on it",                       usage: "!coinflip [amount] [heads/tails]", cooldown: "15s" },
    slots:        { category: "GAMBLING",   desc: "Spin the slot machine",                           usage: "!slots [amount]",           cooldown: "20s" },

    // Quests
    quests:       { category: "QUESTS",     desc: "View your daily quests",                          usage: "!quests",                   cooldown: null  },
    claimquests:  { category: "QUESTS",     desc: "Claim completed quest rewards",                   usage: "!claimquests",              cooldown: null  },
    achievements: { category: "QUESTS",     desc: "View your achievements",                          usage: "!achievements",             cooldown: null  },

    // Pets
    adopt:        { category: "PETS",       desc: "Adopt a pet",                                     usage: "!adopt [type] [name]",      cooldown: null  },
    mypet:        { category: "PETS",       desc: "View your pet's status",                          usage: "!mypet",                    cooldown: null  },
    feedpet:      { category: "PETS",       desc: "Feed your pet (costs 10 coins)",                  usage: "!feedpet",                  cooldown: null  },
    petplay:      { category: "PETS",       desc: "Play with your pet (earn coins)",                 usage: "!petplay",                  cooldown: "1h"  },
    petsay:       { category: "PETS",       desc: "Make your pet say something",                     usage: "!petsay [message]",         cooldown: "30s" },

    // Profile
    profile:      { category: "PROFILE",    desc: "View your or another user's profile",             usage: "!profile [@user]",          cooldown: null  },
    setprofile:   { category: "PROFILE",    desc: "Set your AI personality",                         usage: "!setprofile [personality]", cooldown: null  },
    clearprofile: { category: "PROFILE",    desc: "Clear your AI personality",                       usage: "!clearprofile",             cooldown: null  },

    // Premium
    premium:      { category: "PREMIUM",    desc: "View premium benefits and payment links",         usage: "!premium",                  cooldown: null  },
    verify:       { category: "PREMIUM",    desc: "Verify a premium code",                           usage: "!verify [code]",            cooldown: null  },

    // Stats
    ping:         { category: "STATS",      desc: "Check bot latency",                               usage: "!ping",                     cooldown: null  },
    uptime:       { category: "STATS",      desc: "Check bot uptime",                                usage: "!uptime",                   cooldown: null  },
    stats:        { category: "STATS",      desc: "View bot statistics",                             usage: "!stats",                    cooldown: null  },
    botinfo:      { category: "STATS",      desc: "Detailed bot information",                        usage: "!botinfo",                  cooldown: null  },

    // Moderation (slash)
    warn:         { category: "MODERATION", desc: "Warn a user (slash command)",                     usage: "/warn @user reason",        cooldown: null, slash: true },
    warnings:     { category: "MODERATION", desc: "View warnings for a user",                        usage: "/warnings @user",           cooldown: null, slash: true },
    clearwarns:   { category: "MODERATION", desc: "Clear all warnings for a user",                   usage: "/clearwarns @user",         cooldown: null, slash: true },
    mute:         { category: "MODERATION", desc: "Timeout a user",                                  usage: "/mute @user [minutes]",     cooldown: null, slash: true },
    unmute:       { category: "MODERATION", desc: "Remove timeout from a user",                      usage: "/unmute @user",             cooldown: null, slash: true },
    kick:         { category: "MODERATION", desc: "Kick a user",                                     usage: "/kick @user reason",        cooldown: null, slash: true },
    ban:          { category: "MODERATION", desc: "Ban a user",                                      usage: "/ban @user reason",         cooldown: null, slash: true },

    // Admin
    addchannel:   { category: "ADMIN",      desc: "Allow bot in this channel",                       usage: "!addchannel",               cooldown: null, admin: true },
    removechannel:{ category: "ADMIN",      desc: "Remove bot from this channel",                    usage: "!removechannel",            cooldown: null, admin: true },
    channels:     { category: "ADMIN",      desc: "List allowed channels",                           usage: "!channels",                 cooldown: null, admin: true },
    setpremiumrole:{ category: "ADMIN",     desc: "Set the premium role",                            usage: "!setpremiumrole @role",     cooldown: null, admin: true },
    setpayment:   { category: "ADMIN",      desc: "Set a payment platform link",                     usage: "!setpayment [platform] [url]", cooldown: null, admin: true },
    gencode:      { category: "ADMIN",      desc: "Generate a premium code",                         usage: "!gencode",                  cooldown: null, admin: true },
    givepremium:  { category: "ADMIN",      desc: "Manually grant premium to a user",                usage: "!givepremium @user",        cooldown: null, admin: true },
    setmodlog:    { category: "ADMIN",      desc: "Set this channel as the mod-log",                 usage: "!setmodlog",                cooldown: null, admin: true },
    antispam:     { category: "ADMIN",      desc: "Toggle anti-spam",                                usage: "!antispam on|off",          cooldown: null, admin: true },
    antilink:     { category: "ADMIN",      desc: "Toggle anti-link",                                usage: "!antilink on|off",          cooldown: null, admin: true },
    antiinvite:   { category: "ADMIN",      desc: "Toggle anti-invite",                              usage: "!antiinvite on|off",        cooldown: null, admin: true },
    whitelist:    { category: "ADMIN",      desc: "Manage link whitelist",                           usage: "!whitelist add|remove [domain]", cooldown: null, admin: true },
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js").Message} message
 * @returns {Promise<boolean>}
 */
async function handle(message) {
    const content  = message.content.trim()
    const msgLower = content.toLowerCase()

    if (!msgLower.startsWith("!help")) return false

    const query = content.slice(5).trim().toLowerCase()

    // ── !help [command] — specific command lookup ──────────────────────────────
    if (query) {
        const cmd = COMMANDS[query]
        if (!cmd) {
            await message.channel.send(
                `${EMOJIS.ERROR} No command found for \`${query}\`. Type \`!help\` to see all commands.`
            )
            return true
        }

        const cat = HELP_CATEGORIES[cmd.category]
        const cmdEmbed = embed.help(`Help: !${query}`)
            .addFields(
                { name: "📝 Description", value: cmd.desc,                                    inline: false },
                { name: "💡 Usage",       value: `\`${cmd.usage}\``,                          inline: true  },
                { name: "📂 Category",    value: `${cat?.emoji || ""} ${cat?.label || cmd.category}`, inline: true },
            )

        if (cmd.cooldown) {
            cmdEmbed.addFields({ name: "⏱️ Cooldown", value: cmd.cooldown, inline: true })
        }
        if (cmd.admin) {
            cmdEmbed.addFields({ name: "🔒 Permission", value: "Administrator / Manage Server", inline: true })
        }
        if (cmd.slash) {
            cmdEmbed.addFields({ name: "⚡ Type", value: "Slash Command (`/`)", inline: true })
        }

        await message.channel.send({ embeds: [cmdEmbed] })
        return true
    }

    // ── !help — full command list ──────────────────────────────────────────────
    const helpEmbed = embed.help(`${BOT.NAME} Bot — All Commands`)
        .setDescription(
            `Use \`!help [command]\` for detailed info on any command.\n` +
            `💬 *Chat normally — I remember you & give XP per message!*`
        )

    // Group commands by category
    const grouped = {}
    for (const [name, cmd] of Object.entries(COMMANDS)) {
        if (!grouped[cmd.category]) grouped[cmd.category] = []
        grouped[cmd.category].push({ name, ...cmd })
    }

    // Add a field per category
    const categoryOrder = ["ECONOMY", "FUN", "GAMBLING", "QUESTS", "PETS", "PROFILE", "PREMIUM", "STATS", "MODERATION", "ADMIN"]
    for (const catKey of categoryOrder) {
        const cmds = grouped[catKey]
        if (!cmds || cmds.length === 0) continue
        const cat = HELP_CATEGORIES[catKey]

        const lines = cmds.map(c => {
            const prefix = c.slash ? "/" : "!"
            return `\`${prefix}${c.name}\` — ${c.desc}`
        })

        helpEmbed.addFields({
            name:   `${cat?.emoji || ""} ${cat?.label || catKey}`,
            value:  lines.join("\n"),
            inline: false,
        })
    }

    helpEmbed.setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot v${BOT.VERSION} • !help [command] for details` })

    await message.channel.send({ embeds: [helpEmbed] })
    return true
}

module.exports = { handle, metadata, COMMANDS }
