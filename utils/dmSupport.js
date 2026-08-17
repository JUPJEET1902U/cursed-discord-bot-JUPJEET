const { normalizeControlConfig } = require("./dashboardControl")

const DM_SCOPE_ID = "dm"
const DM_SERVER_ONLY_MESSAGE = "⛔ That command isn't available in DMs. Use `!help` to see DM-supported commands."

// Keep DM access explicit and conservative. A command is only added here after
// its handler has been checked for guild/member/role/channel dependencies.
const DM_ALLOWED_COMMANDS = new Set([
    "!help",

    // AI/fun commands that do not require guild context.
    "!trivia",
    "!story",
    "!roleplay",
    "!challenge",
    "!fortune",
    "!meme",

    // Economy/personal commands.
    "!daily",
    "!balance",
    "!bal",
    "!richlist",
    "!levels",
    "!shop",
    "!buy",

    // Single-player games.
    "!dailygame",
    "!guess",
    "!rps",
    "!blackjack",
    "!mines",
    "!treasure",

    // Single-player gambling games.
    "!gamble",
    "!coinflip",
    "!slots",
])

// Only these command modules are even invoked for DM commands. This prevents a
// server-only module from touching message.guild before returning false.
const DM_ALLOWED_MODULES = new Set([
    "help",
    "fun",
    "economy",
    "gambling",
    "games",
])

function normalizeCommandName(commandName) {
    const token = String(commandName || "").trim().split(/\s+/, 1)[0].toLowerCase()
    if (!token) return null
    return token.startsWith("!") ? token : `!${token}`
}

function isDmCommandAllowed(commandName) {
    const normalized = normalizeCommandName(commandName)
    return Boolean(normalized && DM_ALLOWED_COMMANDS.has(normalized))
}

function isDmModuleAllowed(moduleName) {
    return DM_ALLOWED_MODULES.has(String(moduleName || "").trim().toLowerCase())
}

function getDmAiControl() {
    // Reuse CURSED's normal AI defaults, but DMs must never inherit a server's
    // custom prompt/settings and passive DM chatting should not farm legacy XP.
    return normalizeControlConfig({
        aiEnabled: true,
        aiCustomPrompt: null,
        legacyEconomyXpEnabled: false,
    })
}

module.exports = {
    DM_SCOPE_ID,
    DM_SERVER_ONLY_MESSAGE,
    DM_ALLOWED_COMMANDS,
    DM_ALLOWED_MODULES,
    isDmCommandAllowed,
    isDmModuleAllowed,
    getDmAiControl,
}
