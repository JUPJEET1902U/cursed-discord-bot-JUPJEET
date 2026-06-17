/**
 * utils/helpGenerator.js
 * Auto-generates help data from the command registry.
 * Add new commands here and they appear in !help automatically.
 */

const COMMAND_REGISTRY = {
    // ── Fun ───────────────────────────────────────────────────────────────────
    fun: {
        name: "🎉 Fun",
        emoji: "🎉",
        color: 0xFF6B6B,
        commands: [
            {
                name: "!roast",
                usage: "!roast [@user or name]",
                description: "Generate a savage AI roast for someone",
                examples: ["!roast", "!roast @friend", "!roast John"],
                cooldown: "15s",
                aliases: [],
            },
            {
                name: "!story",
                usage: "!story [theme]",
                description: "Generate a wild, cursed short story",
                examples: ["!story", "!story a dragon who codes"],
                cooldown: "20s",
                aliases: [],
            },
            {
                name: "!fortune",
                usage: "!fortune",
                description: "Get your cursed fortune from the oracle",
                examples: ["!fortune"],
                cooldown: "30s",
                aliases: [],
            },
            {
                name: "!trivia",
                usage: "!trivia",
                description: "Start a trivia question — answer with A/B/C/D",
                examples: ["!trivia"],
                cooldown: "20s",
                aliases: [],
            },
            {
                name: "!challenge",
                usage: "!challenge",
                description: "Get a daily challenge from CURSED",
                examples: ["!challenge"],
                cooldown: "60s",
                aliases: [],
            },
            {
                name: "!roleplay",
                usage: "!roleplay [scenario]",
                description: "Start an interactive roleplay scenario",
                examples: ["!roleplay a heist gone wrong"],
                cooldown: "20s",
                aliases: [],
            },
            {
                name: "!imagine",
                usage: "!imagine [prompt]",
                description: "Generate an AI image from your description",
                examples: ["!imagine a cursed cat on a skateboard"],
                cooldown: "30s",
                aliases: [],
            },
            {
                name: "!meme",
                usage: "!meme [topic]",
                description: "Generate a meme image about any topic",
                examples: ["!meme mondays", "!meme coding at 3am"],
                cooldown: "30s",
                aliases: [],
            },
            {
                name: "!forget",
                usage: "!forget",
                description: "Clear your short-term chat history with CURSED",
                examples: ["!forget"],
                cooldown: "none",
                aliases: [],
            },
        ],
    },

    // ── Economy ───────────────────────────────────────────────────────────────
    economy: {
        name: "💰 Economy",
        emoji: "💰",
        color: 0xFFD700,
        commands: [
            {
                name: "!daily",
                usage: "!daily",
                description: "Claim your daily coin reward (resets at midnight)",
                examples: ["!daily"],
                cooldown: "24h",
                aliases: [],
            },
            {
                name: "!balance",
                usage: "!balance",
                description: "Check your coins, XP, level, and active perks",
                examples: ["!balance"],
                cooldown: "none",
                aliases: ["!bal"],
            },
            {
                name: "!rank",
                usage: "!rank",
                description: "See your server rank and XP progress",
                examples: ["!rank"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!shop",
                usage: "!shop",
                description: "Browse the CURSED shop for items and perks",
                examples: ["!shop"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!buy",
                usage: "!buy [item]",
                description: "Purchase an item from the shop",
                examples: ["!buy shield", "!buy vip", "!buy xpboost"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!give",
                usage: "!give @user [amount]",
                description: "Transfer coins to another user",
                examples: ["!give @friend 100"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!richlist",
                usage: "!richlist",
                description: "Top 10 richest users on the server",
                examples: ["!richlist"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!levels",
                usage: "!levels",
                description: "Top 10 highest-level users on the server",
                examples: ["!levels"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!work",
                usage: "!work",
                description: "Work a job to earn coins",
                examples: ["!work"],
                cooldown: "30m",
                aliases: [],
            },
            {
                name: "!invest",
                usage: "!invest [amount]",
                description: "Invest coins for potential returns",
                examples: ["!invest 500"],
                cooldown: "none",
                aliases: [],
            },
        ],
    },

    // ── Gambling ──────────────────────────────────────────────────────────────
    gambling: {
        name: "🎰 Gambling",
        emoji: "🎰",
        color: 0x9B59B6,
        commands: [
            {
                name: "!coinflip",
                usage: "!coinflip [amount] [heads/tails]",
                description: "Bet coins on a coin flip",
                examples: ["!coinflip 100 heads"],
                cooldown: "5s",
                aliases: ["!cf"],
            },
            {
                name: "!slots",
                usage: "!slots [amount]",
                description: "Spin the slot machine",
                examples: ["!slots 50"],
                cooldown: "10s",
                aliases: [],
            },
            {
                name: "!dice",
                usage: "!dice [amount]",
                description: "Roll dice against CURSED — higher roll wins",
                examples: ["!dice 200"],
                cooldown: "10s",
                aliases: [],
            },
            {
                name: "!blackjack",
                usage: "!blackjack [amount]",
                description: "Play blackjack against the dealer",
                examples: ["!blackjack 100"],
                cooldown: "15s",
                aliases: ["!bj"],
            },
            {
                name: "!roulette",
                usage: "!roulette [amount] [color/number]",
                description: "Bet on roulette — red, black, or a number",
                examples: ["!roulette 100 red", "!roulette 50 7"],
                cooldown: "10s",
                aliases: [],
            },
            {
                name: "!duel",
                usage: "!duel @user [amount]",
                description: "Challenge another user to a coin duel",
                examples: ["!duel @friend 500"],
                cooldown: "30s",
                aliases: [],
            },
        ],
    },

    // ── Games ─────────────────────────────────────────────────────────────────
    games: {
        name: "🎮 Games",
        emoji: "🎮",
        color: 0x2ECC71,
        commands: [
            {
                name: "!battle",
                usage: "!battle [@user]",
                description: "Battle the AI or challenge another user",
                examples: ["!battle", "!battle @friend"],
                cooldown: "30s",
                aliases: [],
            },
            {
                name: "!hunt",
                usage: "!hunt",
                description: "Go hunting for rare creatures and loot",
                examples: ["!hunt"],
                cooldown: "30m",
                aliases: [],
            },
            {
                name: "!fish",
                usage: "!fish",
                description: "Go fishing for coins and rare catches",
                examples: ["!fish"],
                cooldown: "15m",
                aliases: [],
            },
            {
                name: "!mine",
                usage: "!mine",
                description: "Mine for gems and resources",
                examples: ["!mine"],
                cooldown: "20m",
                aliases: [],
            },
            {
                name: "!treasure",
                usage: "!treasure",
                description: "Search for hidden treasure",
                examples: ["!treasure"],
                cooldown: "1h",
                aliases: [],
            },
            {
                name: "!rps",
                usage: "!rps [rock/paper/scissors]",
                description: "Play rock-paper-scissors against CURSED",
                examples: ["!rps rock", "!rps scissors"],
                cooldown: "5s",
                aliases: [],
            },
        ],
    },

    // ── Pets ──────────────────────────────────────────────────────────────────
    pets: {
        name: "🐾 Pets",
        emoji: "🐾",
        color: 0xE67E22,
        commands: [
            {
                name: "!adopt",
                usage: "!adopt [pet name]",
                description: "Adopt a random pet companion",
                examples: ["!adopt Fluffy"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!pet",
                usage: "!pet",
                description: "View your current pet's stats and status",
                examples: ["!pet"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!feed",
                usage: "!feed",
                description: "Feed your pet to restore hunger",
                examples: ["!feed"],
                cooldown: "4h",
                aliases: [],
            },
            {
                name: "!play",
                usage: "!play",
                description: "Play with your pet to boost mood",
                examples: ["!play"],
                cooldown: "2h",
                aliases: [],
            },
            {
                name: "!train",
                usage: "!train",
                description: "Train your pet to gain XP and level up",
                examples: ["!train"],
                cooldown: "6h",
                aliases: [],
            },
        ],
    },

    // ── Profiles ──────────────────────────────────────────────────────────────
    profiles: {
        name: "👤 Profiles",
        emoji: "👤",
        color: 0x3498DB,
        commands: [
            {
                name: "!profile",
                usage: "!profile [@user]",
                description: "View your profile or another user's profile",
                examples: ["!profile", "!profile @friend"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!setpersonality",
                usage: "!setpersonality [type]",
                description: "Set how CURSED talks to you",
                examples: ["!setpersonality friendly", "!setpersonality savage"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!personality",
                usage: "!personality",
                description: "View available personality modes",
                examples: ["!personality"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!achievements",
                usage: "!achievements",
                description: "View your earned achievements",
                examples: ["!achievements"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!quests",
                usage: "!quests",
                description: "View your daily quests and progress",
                examples: ["!quests"],
                cooldown: "none",
                aliases: [],
            },
        ],
    },

    // ── Memory ────────────────────────────────────────────────────────────────
    memory: {
        name: "🧠 Memory",
        emoji: "🧠",
        color: 0x1ABC9C,
        commands: [
            {
                name: "!memories",
                usage: "!memories",
                description: "View everything CURSED remembers about you",
                examples: ["!memories"],
                cooldown: "none",
                aliases: ["!memory"],
            },
            {
                name: "!remember",
                usage: "!remember [fact]",
                description: "Tell CURSED something to remember about you",
                examples: ["!remember I love playing Minecraft"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!forgetmemory",
                usage: "!forgetmemory [id]",
                description: "Delete a specific memory by its ID",
                examples: ["!forgetmemory a1b2"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!clearmemory",
                usage: "!clearmemory",
                description: "Wipe ALL memories CURSED has about you",
                examples: ["!clearmemory"],
                cooldown: "none",
                aliases: [],
            },
        ],
    },

    // ── Premium ───────────────────────────────────────────────────────────────
    premium: {
        name: "💎 Premium",
        emoji: "💎",
        color: 0xF1C40F,
        commands: [
            {
                name: "!premium",
                usage: "!premium",
                description: "View Premium benefits and payment links",
                examples: ["!premium"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!verify",
                usage: "!verify [code]",
                description: "Activate a Premium code to get your role",
                examples: ["!verify ABC123"],
                cooldown: "none",
                aliases: [],
            },
        ],
    },

    // ── Admin ─────────────────────────────────────────────────────────────────
    admin: {
        name: "⚙️ Admin",
        emoji: "⚙️",
        color: 0x95A5A6,
        adminOnly: true,
        commands: [
            {
                name: "!addchannel",
                usage: "!addchannel",
                description: "Allow CURSED to respond in this channel",
                examples: ["!addchannel"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!removechannel",
                usage: "!removechannel",
                description: "Stop CURSED from responding in this channel",
                examples: ["!removechannel"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!channels",
                usage: "!channels",
                description: "List all channels CURSED is active in",
                examples: ["!channels"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!setmodlog",
                usage: "!setmodlog",
                description: "Set this channel as the moderation log",
                examples: ["!setmodlog"],
                cooldown: "none",
                permissions: ["Administrator"],
                aliases: [],
            },
            {
                name: "!antispam",
                usage: "!antispam [on/off]",
                description: "Enable or disable anti-spam protection",
                examples: ["!antispam on", "!antispam off"],
                cooldown: "none",
                permissions: ["Administrator"],
                aliases: [],
            },
            {
                name: "!antilink",
                usage: "!antilink [on/off]",
                description: "Enable or disable link blocking",
                examples: ["!antilink on"],
                cooldown: "none",
                permissions: ["Administrator"],
                aliases: [],
            },
            {
                name: "!antiinvite",
                usage: "!antiinvite [on/off]",
                description: "Enable or disable Discord invite blocking",
                examples: ["!antiinvite on"],
                cooldown: "none",
                permissions: ["Administrator"],
                aliases: [],
            },
            {
                name: "!setpremiumrole",
                usage: "!setpremiumrole @role",
                description: "Set the Premium role for this server",
                examples: ["!setpremiumrole @Premium"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!setpayment",
                usage: "!setpayment [platform] [url]",
                description: "Set a payment link for Premium (kofi/patreon/bmc)",
                examples: ["!setpayment kofi https://ko-fi.com/you"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!gencode",
                usage: "!gencode",
                description: "Generate a one-time Premium activation code",
                examples: ["!gencode"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!givepremium",
                usage: "!givepremium @user",
                description: "Manually grant Premium to a user",
                examples: ["!givepremium @friend"],
                cooldown: "none",
                permissions: ["Administrator", "Manage Server"],
                aliases: [],
            },
            {
                name: "!botstats",
                usage: "!botstats",
                description: "View bot uptime, memory, and server stats",
                examples: ["!botstats"],
                cooldown: "none",
                permissions: ["Administrator"],
                aliases: [],
            },
        ],
    },

    // ── Moderation ────────────────────────────────────────────────────────────
    moderation: {
        name: "🛡️ Moderation",
        emoji: "🛡️",
        color: 0xE74C3C,
        adminOnly: true,
        commands: [
            {
                name: "/warn",
                usage: "/warn @user [reason]",
                description: "Issue a warning to a user",
                examples: ["/warn @user Breaking rules"],
                cooldown: "none",
                permissions: ["Moderate Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/warnings",
                usage: "/warnings @user",
                description: "View all warnings for a user",
                examples: ["/warnings @user"],
                cooldown: "none",
                permissions: ["Moderate Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/clearwarns",
                usage: "/clearwarns @user",
                description: "Clear all warnings for a user",
                examples: ["/clearwarns @user"],
                cooldown: "none",
                permissions: ["Moderate Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/mute",
                usage: "/mute @user [duration]",
                description: "Timeout a user (default: 10 minutes)",
                examples: ["/mute @user 30"],
                cooldown: "none",
                permissions: ["Moderate Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/unmute",
                usage: "/unmute @user",
                description: "Remove a timeout from a user",
                examples: ["/unmute @user"],
                cooldown: "none",
                permissions: ["Moderate Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/kick",
                usage: "/kick @user [reason]",
                description: "Kick a user from the server",
                examples: ["/kick @user Spamming"],
                cooldown: "none",
                permissions: ["Kick Members"],
                aliases: [],
                slashOnly: true,
            },
            {
                name: "/ban",
                usage: "/ban @user [reason]",
                description: "Ban a user from the server",
                examples: ["/ban @user Repeated violations"],
                cooldown: "none",
                permissions: ["Ban Members"],
                aliases: [],
                slashOnly: true,
            },
        ],
    },
}

/**
 * Get all categories as an array.
 * @param {boolean} includeAdmin - Whether to include admin-only categories
 * @returns {Array}
 */
function getCategories(includeAdmin = false) {
    return Object.entries(COMMAND_REGISTRY)
        .filter(([, cat]) => includeAdmin || !cat.adminOnly)
        .map(([key, cat]) => ({ key, ...cat }))
}

/**
 * Get a specific category by key.
 * @param {string} key
 * @returns {object|null}
 */
function getCategory(key) {
    return COMMAND_REGISTRY[key] || null
}

/**
 * Search commands by name or description.
 * @param {string} query
 * @returns {Array}
 */
function searchCommands(query) {
    const q = query.toLowerCase()
    const results = []
    for (const [catKey, cat] of Object.entries(COMMAND_REGISTRY)) {
        for (const cmd of cat.commands) {
            if (
                cmd.name.toLowerCase().includes(q) ||
                cmd.description.toLowerCase().includes(q) ||
                cmd.aliases.some(a => a.toLowerCase().includes(q))
            ) {
                results.push({ ...cmd, category: cat.name, categoryKey: catKey })
            }
        }
    }
    return results
}

/**
 * Get total command count.
 * @returns {number}
 */
function getTotalCommandCount() {
    return Object.values(COMMAND_REGISTRY).reduce((sum, cat) => sum + cat.commands.length, 0)
}

module.exports = {
    COMMAND_REGISTRY,
    getCategories,
    getCategory,
    searchCommands,
    getTotalCommandCount,
}
