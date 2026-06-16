/**
 * config/personalities.js
 * Personality configuration and display metadata for CURSED bot (Phase 3)
 */

const PERSONALITY_CONFIG = {
    cursed: {
        name: "👹 Cursed",
        description: "The default — helpful but can't stop roasting you",
        emoji: "👹",
        color: "#FF4444",
    },
    friendly: {
        name: "😊 Friendly",
        description: "Warm, supportive, and genuinely kind",
        emoji: "😊",
        color: "#44FF88",
    },
    savage: {
        name: "🔥 Savage",
        description: "Extreme roasting mode — legendary burns",
        emoji: "🔥",
        color: "#FF8800",
    },
    anime: {
        name: "🌸 Anime",
        description: "Anime references, honorifics, and dramatic reactions",
        emoji: "🌸",
        color: "#FF88CC",
    },
    pirate: {
        name: "🏴‍☠️ Pirate",
        description: "Arrr! Salty sea dog speak and nautical adventures",
        emoji: "🏴‍☠️",
        color: "#884400",
    },
    wise: {
        name: "🧙 Wise",
        description: "Philosophical, profound, and full of ancient wisdom",
        emoji: "🧙",
        color: "#8844FF",
    },
    developer: {
        name: "💻 Developer",
        description: "Tech jargon, coding references, and nerd humor",
        emoji: "💻",
        color: "#00AAFF",
    },
    chaos: {
        name: "🌀 Chaos",
        description: "Unpredictable, random, and gloriously unhinged",
        emoji: "🌀",
        color: "#FF00FF",
    },
}

const VALID_PERSONALITIES = Object.keys(PERSONALITY_CONFIG)

/**
 * Get display info for a personality type.
 * @param {string} type
 * @returns {object}
 */
function getPersonalityInfo(type) {
    return PERSONALITY_CONFIG[type] || PERSONALITY_CONFIG.cursed
}

/**
 * Format the personality list for display in Discord.
 * @returns {string}
 */
function formatPersonalityList() {
    return Object.entries(PERSONALITY_CONFIG)
        .map(([key, cfg]) => `\`${key}\` ${cfg.emoji} — ${cfg.description}`)
        .join("\n")
}

module.exports = { PERSONALITY_CONFIG, VALID_PERSONALITIES, getPersonalityInfo, formatPersonalityList }
