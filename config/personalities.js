/**
 * CURSED AI personality metadata.
 *
 * Personality affects conversational style only. Public labels stay concise and
 * predictable; decorative emoji metadata is retained for optional creative UI.
 */

const PERSONALITY_CONFIG = {
    cursed: {
        name: "Cursed",
        description: "Balanced default with dry humor and direct answers.",
        emoji: "👹",
        color: "#FF4444",
    },
    friendly: {
        name: "Friendly",
        description: "Warm, supportive, and relaxed.",
        emoji: "😊",
        color: "#44FF88",
    },
    savage: {
        name: "Savage",
        description: "Sharper humor and stronger roasts while staying useful.",
        emoji: "🔥",
        color: "#FF8800",
    },
    anime: {
        name: "Anime",
        description: "Anime references and expressive conversational style.",
        emoji: "🌸",
        color: "#FF88CC",
    },
    pirate: {
        name: "Pirate",
        description: "Nautical phrasing and pirate-style banter.",
        emoji: "🏴‍☠️",
        color: "#884400",
    },
    wise: {
        name: "Wise",
        description: "Calm, reflective, and thoughtful.",
        emoji: "🧙",
        color: "#8844FF",
    },
    developer: {
        name: "Developer",
        description: "Technical language, coding references, and concise explanations.",
        emoji: "💻",
        color: "#00AAFF",
    },
    chaos: {
        name: "Chaos",
        description: "Playfully unpredictable while still following the request.",
        emoji: "🌀",
        color: "#FF00FF",
    },
    flirty: {
        name: "Flirty",
        description: "Light playful banter and respectful compliments.",
        emoji: "💘",
        color: "#FF5FA2",
    },
}

const VALID_PERSONALITIES = Object.keys(PERSONALITY_CONFIG)

function getPersonalityInfo(type) {
    return PERSONALITY_CONFIG[type] || PERSONALITY_CONFIG.cursed
}

function formatPersonalityList() {
    return Object.entries(PERSONALITY_CONFIG)
        .map(([key, config]) => `\`${key}\` — ${config.description}`)
        .join("\n")
}

module.exports = { PERSONALITY_CONFIG, VALID_PERSONALITIES, getPersonalityInfo, formatPersonalityList }
