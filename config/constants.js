/**
 * @fileoverview Centralized configuration and constants for CURSED Bot.
 * All magic numbers, colors, cooldowns, limits, and data definitions live here.
 * Adjust values here without touching business logic.
 */

"use strict"

// ─── Bot Identity ─────────────────────────────────────────────────────────────

const BOT = {
    NAME: "CURSED",
    PREFIX: "!",
    VERSION: "2.0.0",
    /** Default username the bot attempts to set on startup */
    DEFAULT_USERNAME: "CURSED",
    /** Invite permission integer (Administrator) */
    INVITE_PERMISSIONS: "8",
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLORS = {
    PRIMARY:    0x9B59B6, // purple — main brand color
    SUCCESS:    0x2ECC71, // green
    WARNING:    0xF39C12, // amber
    ERROR:      0xE74C3C, // red
    INFO:       0x3498DB, // blue
    ECONOMY:    0xF1C40F, // gold
    GAMBLING:   0xE67E22, // orange
    PETS:       0x1ABC9C, // teal
    PROFILE:    0x9B59B6, // purple
    MODERATION: 0xE74C3C, // red
    PREMIUM:    0xFFD700, // gold
    FUN:        0xFF6B9D, // pink
    QUESTS:     0x27AE60, // dark green
    STATS:      0x2C3E50, // dark blue-grey
    HELP:       0x8E44AD, // dark purple
    NEUTRAL:    0x95A5A6, // grey
}

// ─── Emojis ───────────────────────────────────────────────────────────────────

const EMOJIS = {
    // Economy
    COIN:       "🪙",
    DAILY:      "🎁",
    BALANCE:    "💰",
    RANK:       "🏅",
    GIVE:       "💸",
    SHOP:       "🛒",
    BUY:        "🛍️",
    RICHLIST:   "🏦",
    LEVELS:     "⭐",

    // Gambling
    GAMBLE:     "🎲",
    COINFLIP:   "🟡",
    SLOTS:      "🎰",
    WIN:        "🎉",
    LOSE:       "💀",

    // Fun
    ROAST:      "🔥",
    IMAGINE:    "🎨",
    MEME:       "😂",
    TRIVIA:     "🧠",
    STORY:      "📖",
    ROLEPLAY:   "🎭",
    CHALLENGE:  "⚔️",
    FORTUNE:    "🔮",
    FORGET:     "🧹",
    LEADERBOARD:"🏆",

    // Pets
    PET:        "🐾",
    FEED:       "🍖",
    PLAY:       "🎾",

    // Profile
    PROFILE:    "👤",
    BADGE:      "🏆",
    PRESTIGE:   "🌟",
    VIP:        "⭐",
    CURSED_BADGE: "💀",

    // Quests & Achievements
    QUEST:      "📋",
    ACHIEVEMENT:"🏆",
    LOCKED:     "🔒",
    UNLOCKED:   "✅",

    // Premium
    PREMIUM:    "💎",
    KEY:        "🔑",

    // Moderation
    WARN:       "⚠️",
    MUTE:       "🔇",
    UNMUTE:     "🔊",
    KICK:       "👢",
    BAN:        "🔨",
    SHIELD:     "🛡️",

    // System
    SUCCESS:    "✅",
    ERROR:      "❌",
    LOADING:    "⏳",
    INFO:       "ℹ️",
    STATS:      "📊",
    PING:       "🏓",
    UPTIME:     "⏱️",
    BOT:        "🤖",
    SERVER:     "🌐",
    MEMORY:     "💾",
    HELP:       "❓",
    CURSED:     "👹",
}

// ─── Cooldowns (milliseconds) ─────────────────────────────────────────────────

const COOLDOWNS = {
    ROAST:      15_000,   // 15 seconds
    IMAGINE:    30_000,   // 30 seconds
    MEME:       30_000,   // 30 seconds
    TRIVIA:     20_000,   // 20 seconds (per channel)
    STORY:      20_000,   // 20 seconds
    ROLEPLAY:   20_000,   // 20 seconds
    CHALLENGE:  60_000,   // 60 seconds
    FORTUNE:    30_000,   // 30 seconds
    GAMBLE:     20_000,   // 20 seconds
    COINFLIP:   15_000,   // 15 seconds
    SLOTS:      20_000,   // 20 seconds
    PET_PLAY:   3_600_000,// 1 hour
    PET_SAY:    30_000,   // 30 seconds
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const RATE_LIMIT = {
    /** Max AI messages per window */
    MAX_MESSAGES:   8,
    /** Window duration in ms */
    WINDOW_MS:      60_000,
}

// ─── Anti-Spam ────────────────────────────────────────────────────────────────

const ANTI_SPAM = {
    /** Messages within window before triggering */
    THRESHOLD:      5,
    /** Detection window in ms */
    WINDOW_MS:      5_000,
    /** Mute duration in ms */
    MUTE_DURATION_MS: 30_000,
}

// ─── AI Configuration ─────────────────────────────────────────────────────────

const AI = {
    GROQ_MODEL:         "llama-3.1-8b-instant",
    GEMINI_MODEL:       "gemini-2.0-flash",
    DEFAULT_MAX_TOKENS: 500,
    /** Groq failures before switching to Gemini */
    GROQ_FAIL_THRESHOLD: 3,
    /** Max conversation history entries per user */
    MAX_MEMORY:         20,
}

// ─── Economy ──────────────────────────────────────────────────────────────────

const ECONOMY = {
    CURRENCY_NAME:  "Cursed Coins",
    CURRENCY_EMOJI: "🪙",
    /** Daily reward range */
    DAILY_MIN:      50,
    DAILY_MAX:      300,
    DAILY_XP:       50,
    /** XP per chat message */
    XP_MIN:         5,
    XP_MAX:         15,
    /** Pet feed cost */
    PET_FEED_COST:  10,
    PET_FEED_HUNGER: 30,
    PET_FEED_XP:    10,
    PET_PLAY_XP:    20,
    PET_PLAY_COIN_MIN: 10,
    PET_PLAY_COIN_MAX: 40,
    /** Profile personality max length */
    PROFILE_MAX_LENGTH: 200,
}

// ─── Shop Items ───────────────────────────────────────────────────────────────

const SHOP = {
    vip: {
        name:  "⭐ VIP Title",
        price: 500,
        desc:  "Shows a VIP badge on your profile",
        key:   "vip",
        once:  true,
    },
    shield: {
        name:  "🛡️ Roast Shield",
        price: 200,
        desc:  "CURSED goes easy on you for 5 messages",
        key:   "roastShield",
        once:  false,
        value: 5,
    },
    xpboost: {
        name:  "💥 XP Boost",
        price: 400,
        desc:  "Double XP on your next 10 messages",
        key:   "xpBoost",
        once:  false,
        value: 10,
    },
    dailyboost: {
        name:  "🎲 Daily Boost",
        price: 300,
        desc:  "Doubles your next daily reward",
        key:   "dailyBoost",
        once:  false,
        value: 1,
    },
    badge: {
        name:  "💀 Cursed Badge",
        price: 1000,
        desc:  "Permanent 💀 badge on your profile forever",
        key:   "badge",
        once:  true,
    },
    prestige: {
        name:  "🌟 Prestige",
        price: 2000,
        desc:  "Unlock prestige status — the ultimate flex",
        key:   "prestige",
        once:  true,
    },
}

// ─── Achievements ─────────────────────────────────────────────────────────────

const ACHIEVEMENTS = [
    { id: "first_msg",      name: "👋 First Words",      desc: "Send your first message to CURSED",      xp: 20,  coins: 50  },
    { id: "chat100",        name: "💬 Chatterbox",        desc: "Send 100 messages to CURSED",            xp: 100, coins: 200 },
    { id: "level5",         name: "⭐ Rising Star",       desc: "Reach Level 5",                          xp: 50,  coins: 100 },
    { id: "level10",        name: "🌟 Power User",        desc: "Reach Level 10",                         xp: 100, coins: 200 },
    { id: "level25",        name: "💥 Elite",             desc: "Reach Level 25",                         xp: 200, coins: 500 },
    { id: "roast10",        name: "🔥 Roast Master",      desc: "Roast 10 people",                        xp: 75,  coins: 150 },
    { id: "rich500",        name: "💰 Getting Rich",      desc: "Have 500 coins at once",                 xp: 50,  coins: 0   },
    { id: "rich2000",       name: "🤑 Big Spender",       desc: "Have 2000 coins at once",                xp: 100, coins: 0   },
    { id: "gambler_first",  name: "🎲 First Roll",        desc: "Gamble for the first time",              xp: 20,  coins: 30  },
    { id: "gambler_win",    name: "🎰 Lucky Duck",        desc: "Win a gamble",                           xp: 30,  coins: 75  },
    { id: "trivia5",        name: "🧠 Trivia Ace",        desc: "Win 5 trivia questions",                 xp: 75,  coins: 150 },
    { id: "pet_owner",      name: "🐾 Pet Parent",        desc: "Adopt your first pet",                   xp: 40,  coins: 80  },
    { id: "quest_complete", name: "✅ Quest Slayer",      desc: "Complete your first daily quest set",    xp: 50,  coins: 100 },
    { id: "daily7",         name: "📅 Loyal Follower",    desc: "Claim daily reward 7 times total",       xp: 100, coins: 200 },
    { id: "prestige_owner", name: "👑 Prestige",          desc: "Unlock Prestige status from the shop",   xp: 500, coins: 0   },
    { id: "slots_jackpot",  name: "🎰 Jackpot!",          desc: "Hit the jackpot on slots",               xp: 100, coins: 300 },
]

// ─── Quest Pool ───────────────────────────────────────────────────────────────

const QUEST_POOL = [
    { id: "chat5",     desc: "💬 Chat with CURSED 5 times",        key: "chat",         goal: 5, reward: { coins: 100, xp: 30 } },
    { id: "roast2",    desc: "🔥 Use !roast 2 times",              key: "roast",        goal: 2, reward: { coins: 150, xp: 40 } },
    { id: "trivia1",   desc: "🧠 Win 1 trivia question",           key: "triviaWin",    goal: 1, reward: { coins: 200, xp: 50 } },
    { id: "fortune1",  desc: "🔮 Ask for your fortune once",       key: "fortune",      goal: 1, reward: { coins: 75,  xp: 20 } },
    { id: "daily1",    desc: "🎁 Claim your daily reward",         key: "dailyClaimed", goal: 1, reward: { coins: 50,  xp: 25 } },
    { id: "give1",     desc: "💸 Give coins to someone",           key: "give",         goal: 1, reward: { coins: 120, xp: 35 } },
    { id: "gamble1",   desc: "🎲 Gamble at least once",            key: "gamble",       goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "story1",    desc: "📖 Request a story with !story",     key: "story",        goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "roleplay1", desc: "🎭 Start a !roleplay",               key: "roleplay",     goal: 1, reward: { coins: 100, xp: 30 } },
    { id: "feedpet1",  desc: "🐾 Feed your pet with !feedpet",     key: "feedpet",      goal: 1, reward: { coins: 80,  xp: 25 } },
    { id: "imagine1",  desc: "🎨 Generate an image with !imagine", key: "imagine",      goal: 1, reward: { coins: 80,  xp: 20 } },
    { id: "slots1",    desc: "🎰 Play slots once with !slots",     key: "slots",        goal: 1, reward: { coins: 90,  xp: 25 } },
]

// ─── Pet Types ────────────────────────────────────────────────────────────────

const PET_TYPES = {
    dragon: {
        emoji:       "🐉",
        desc:        "Fierce and loyal, grows to be a mighty beast",
        personality: "You are a fierce but loyal dragon named {name}. Speak in short dramatic sentences. You are protective of your owner.",
    },
    cat: {
        emoji:       "😺",
        desc:        "Sarcastic like its owner, mysteriously powerful",
        personality: "You are a sarcastic and superior cat named {name}. Speak with disdain and mild condescension. You secretly care.",
    },
    ghost: {
        emoji:       "👻",
        desc:        "Haunts your enemies and spooks the server",
        personality: "You are a spooky ghost named {name}. Speak ominously and reference the afterlife. You're playfully scary.",
    },
    slime: {
        emoji:       "🟢",
        desc:        "Weird and wobbly, surprisingly powerful",
        personality: "You are a cheerful bubbly slime named {name}. Speak with enthusiasm and lots of bouncy energy.",
    },
    demon: {
        emoji:       "😈",
        desc:        "Pure evil energy, maximum chaos",
        personality: "You are a chaotic little demon named {name}. Speak with sinister energy and dark humor. Chaos is your love language.",
    },
}

// ─── AI Prompts ───────────────────────────────────────────────────────────────

const PROMPTS = {
    SYSTEM: `You are CURSED, a Discord bot with a split personality: you are genuinely kind and helpful, always giving useful answers and assisting people — but you can't help yourself from also roasting and making fun of the people you're talking to.

You mix sincere helpfulness with playful jabs and witty insults. Keep responses short and punchy. Never be mean-spirited to the point of being hurtful, but don't hold back on the banter.

IMPORTANT: Always detect the language of the user's message and reply in that same language. If they write in Hindi, reply in Hindi. If they write in Spanish, reply in Spanish. Match their language exactly every time.`,

    RAGE: `You are CURSED in FULL RAGE MODE. Someone said the forbidden word.

Respond with maximum chaotic energy, dramatic overreactions, wild accusations, and pure madness.

Be hilariously over-the-top angry. Keep it funny and absurd, not genuinely hurtful.

IMPORTANT: Always detect the language of the user's message and reply in that same language. Match their language exactly.`,

    WELCOME: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. 2-3 sentences, funny.",
}

// ─── Rage Triggers ────────────────────────────────────────────────────────────

const RAGE_TRIGGERS = ["randi"]

// ─── Slot Machine ─────────────────────────────────────────────────────────────

const SLOTS = {
    SYMBOLS:        ["🍒", "🍋", "🍊", "🍇", "💎", "🎰", "⭐"],
    JACKPOT_SYMBOL: "💎",
    JACKPOT_MULT:   10,
    THREE_MULT:     5,
    TWO_MULT:       1.5,
}

// ─── Gambling ─────────────────────────────────────────────────────────────────

const GAMBLING = {
    /** Win probability for !gamble */
    WIN_CHANCE:         0.5,
    /** Coinflip win multiplier */
    COINFLIP_MULT:      1.8,
}

// ─── Medals ───────────────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"]

// ─── Payment Platforms ────────────────────────────────────────────────────────

const PLATFORMS = {
    kofi:    { name: "Ko-fi",           emoji: "☕" },
    patreon: { name: "Patreon",         emoji: "🎨" },
    bmc:     { name: "Buy Me a Coffee", emoji: "☕" },
}

// ─── File Paths ───────────────────────────────────────────────────────────────

const FILES = {
    ECONOMY:       "./economy.json",
    MEMORY:        "./memory.json",
    PETS:          "./pets.json",
    PROFILES:      "./profiles.json",
    WARNINGS:      "./warnings.json",
    SERVER_CONFIG: "./serverConfig.json",
    PREMIUM_CODES: "./premiumCodes.json",
    ROAST_COUNTS:  "./roast_counts.json",
}

// ─── Moderation ───────────────────────────────────────────────────────────────

const MODERATION = {
    ACTION_COLORS: {
        WARN:        0xFFAA00,
        MUTE:        0xFF6600,
        UNMUTE:      0x00CC88,
        KICK:        0xFF4444,
        BAN:         0xCC0000,
        ANTI_LINK:   0xAA44FF,
        ANTI_INVITE: 0xDD44AA,
        ANTI_SPAM:   0xFF8800,
    },
    ACTION_EMOJIS: {
        WARN:        "⚠️",
        MUTE:        "🔇",
        UNMUTE:      "🔊",
        KICK:        "👢",
        BAN:         "🔨",
        ANTI_LINK:   "🔗",
        ANTI_INVITE: "📨",
        ANTI_SPAM:   "🚫",
    },
}

// ─── Help Categories ──────────────────────────────────────────────────────────

const HELP_CATEGORIES = {
    ECONOMY:    { emoji: "💰", label: "Economy" },
    FUN:        { emoji: "🎮", label: "Fun & Games" },
    GAMBLING:   { emoji: "🎲", label: "Gambling" },
    QUESTS:     { emoji: "📋", label: "Quests & Achievements" },
    PETS:       { emoji: "🐾", label: "Pets" },
    PROFILE:    { emoji: "👤", label: "Profile" },
    PREMIUM:    { emoji: "💎", label: "Premium" },
    MODERATION: { emoji: "🛡️", label: "Moderation" },
    ADMIN:      { emoji: "⚙️", label: "Admin Only" },
    STATS:      { emoji: "📊", label: "Statistics" },
}

module.exports = {
    BOT,
    COLORS,
    EMOJIS,
    COOLDOWNS,
    RATE_LIMIT,
    ANTI_SPAM,
    AI,
    ECONOMY,
    SHOP,
    ACHIEVEMENTS,
    QUEST_POOL,
    PET_TYPES,
    PROMPTS,
    RAGE_TRIGGERS,
    SLOTS,
    GAMBLING,
    MEDALS,
    PLATFORMS,
    FILES,
    MODERATION,
    HELP_CATEGORIES,
}
