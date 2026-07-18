const { COMMAND_REGISTRY } = require("./helpGenerator")

const CONTROL_MODULES = [
    { key: "premium", label: "Premium", description: "Premium status, verification, and supporter commands." },
    { key: "fun", label: "AI Fun", description: "Roasts, stories, fortunes, trivia, challenges, and roleplay." },
    { key: "shop", label: "Shop", description: "Shop browsing and purchases." },
    { key: "economy", label: "Economy", description: "Daily rewards, balances, transfers, and work." },
    { key: "economy-advanced", label: "Advanced Economy", description: "Investments and advanced economy actions." },
    { key: "gambling", label: "Gambling", description: "Coinflip, slots, dice, blackjack, roulette, and duels." },
    { key: "games", label: "Games", description: "Hunting, fishing, mining, treasure, and quick games." },
    { key: "quests", label: "Quests", description: "Daily quests, rewards, and achievements." },
    { key: "battle", label: "Battles", description: "AI and member battle commands." },
    { key: "pets", label: "Pets", description: "Adoption, feeding, playing, and training." },
    { key: "profiles", label: "Profiles", description: "Profiles and personality controls." },
    { key: "leaderboards", label: "Leaderboards", description: "Economy and activity leaderboards." },
    { key: "images", label: "Image Generation", description: "Imagine and meme image generation." },
    { key: "memory", label: "Memory", description: "User-managed long-term memory commands." },
    { key: "server-insights", label: "Server Insights", description: "Server activity and insight commands." },
    { key: "public-stats-status", label: "Public Stats", description: "Public bot and server status commands." },
    { key: "leveling", label: "Leveling Commands", description: "Rank, levels, and leveling administration commands." },
]

const CONTROL_MODULE_KEYS = new Set(CONTROL_MODULES.map(item => item.key))
const PROTECTED_MODULES = new Set(["help", "admin"])
const PROTECTED_COMMANDS = new Set([
    "!help",
    "!addchannel",
    "!removechannel",
    "!channels",
    "!allchannels",
])

const DEFAULT_CONTROL_CONFIG = Object.freeze({
    channelRestrictionEnabled: false,
    allowedChannels: [],
    aiEnabled: true,
    aiMaxTokens: 500,
    aiRateLimit: 8,
    aiRateWindowSeconds: 60,
    aiMemoryEnabled: true,
    aiLongTermMemoryEnabled: true,
    aiCustomPrompt: null,
    legacyEconomyXpEnabled: true,
    moderationCommandsEnabled: true,
    disabledModules: [],
    disabledCommands: [],
    antiSpam: false,
    antiLink: false,
    antiInvite: false,
    linkWhitelist: [],
    modLogChannelId: null,
    premiumRoleId: null,
    paymentLinks: {},
})

function uniqueStrings(value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeControlConfig(config = {}) {
    const allowedChannels = uniqueStrings(config.allowedChannels)
    const disabledModules = uniqueStrings(config.disabledModules)
        .filter(key => CONTROL_MODULE_KEYS.has(key))
    const disabledCommands = uniqueStrings(config.disabledCommands)
        .map(command => command.toLowerCase())
        .filter(command => command.startsWith("!") || command.startsWith("/"))
        .filter(command => !PROTECTED_COMMANDS.has(command))

    return {
        channelRestrictionEnabled: typeof config.channelRestrictionEnabled === "boolean"
            ? config.channelRestrictionEnabled
            : allowedChannels.length > 0,
        allowedChannels,
        aiEnabled: config.aiEnabled !== false,
        aiMaxTokens: clampInteger(config.aiMaxTokens, DEFAULT_CONTROL_CONFIG.aiMaxTokens, 100, 1500),
        aiRateLimit: clampInteger(config.aiRateLimit, DEFAULT_CONTROL_CONFIG.aiRateLimit, 1, 30),
        aiRateWindowSeconds: clampInteger(config.aiRateWindowSeconds, DEFAULT_CONTROL_CONFIG.aiRateWindowSeconds, 10, 600),
        aiMemoryEnabled: config.aiMemoryEnabled !== false,
        aiLongTermMemoryEnabled: config.aiLongTermMemoryEnabled !== false,
        aiCustomPrompt: typeof config.aiCustomPrompt === "string" && config.aiCustomPrompt.trim()
            ? config.aiCustomPrompt.trim().slice(0, 2000)
            : null,
        legacyEconomyXpEnabled: config.legacyEconomyXpEnabled !== false,
        moderationCommandsEnabled: config.moderationCommandsEnabled !== false,
        disabledModules,
        disabledCommands,
        antiSpam: config.antiSpam === true,
        antiLink: config.antiLink === true,
        antiInvite: config.antiInvite === true,
        linkWhitelist: uniqueStrings(config.linkWhitelist)
            .map(domain => domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
            .filter(Boolean)
            .slice(0, 100),
        modLogChannelId: config.modLogChannelId ? String(config.modLogChannelId) : null,
        premiumRoleId: config.premiumRoleId ? String(config.premiumRoleId) : null,
        paymentLinks: config.paymentLinks && typeof config.paymentLinks === "object"
            ? {
                kofi: normalizeUrl(config.paymentLinks.kofi),
                patreon: normalizeUrl(config.paymentLinks.patreon),
                bmc: normalizeUrl(config.paymentLinks.bmc),
            }
            : {},
    }
}

function normalizeUrl(value) {
    if (!value || typeof value !== "string") return null
    try {
        const url = new URL(value.trim())
        return ["http:", "https:"].includes(url.protocol) ? url.toString() : null
    } catch {
        return null
    }
}

function getControlCommands() {
    const commands = []
    for (const [categoryKey, category] of Object.entries(COMMAND_REGISTRY)) {
        for (const command of category.commands || []) {
            const names = [command.name, ...(command.aliases || [])]
                .map(name => String(name).trim().toLowerCase())
                .filter(Boolean)
            if (!names.length) continue
            commands.push({
                name: names[0],
                aliases: names.slice(1),
                label: command.name,
                description: command.description,
                category: category.name,
                categoryKey,
                protected: names.some(name => PROTECTED_COMMANDS.has(name)),
            })
        }
    }
    return commands
}

function extractCommandName(content) {
    const token = String(content || "").trim().split(/\s+/, 1)[0].toLowerCase()
    return token.startsWith("!") ? token : null
}

function isModuleEnabled(config, moduleName) {
    if (PROTECTED_MODULES.has(moduleName)) return true
    return !normalizeControlConfig(config).disabledModules.includes(moduleName)
}

function isCommandEnabled(config, commandName) {
    const normalizedName = String(commandName || "").trim().toLowerCase()
    if (!normalizedName || PROTECTED_COMMANDS.has(normalizedName)) return true
    return !normalizeControlConfig(config).disabledCommands.includes(normalizedName)
}

module.exports = {
    CONTROL_MODULES,
    CONTROL_MODULE_KEYS,
    DEFAULT_CONTROL_CONFIG,
    PROTECTED_COMMANDS,
    normalizeControlConfig,
    getControlCommands,
    extractCommandName,
    isModuleEnabled,
    isCommandEnabled,
}
