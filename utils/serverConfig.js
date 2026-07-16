const fs = require("fs")

const CONFIG_FILE = "./serverConfig.json"

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
    } catch (err) { console.error("Config load error:", err.message) }
    return {}
}

function saveConfig(data) {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { console.error("Config save error:", err.message) }
}

function getServerConfig(guildId) {
    const data = loadConfig()
    if (!data[guildId]) {
        data[guildId] = { allowedChannels: [], premiumRoleId: null, paymentLinks: {} }
    } else {
        if (!data[guildId].allowedChannels) data[guildId].allowedChannels = []
        if (!data[guildId].paymentLinks)    data[guildId].paymentLinks    = {}
    }

    const g = data[guildId]

    // ── Core welcome ──────────────────────────────────────────────────────────
    if (g.welcomeChannelId    === undefined) g.welcomeChannelId    = null
    if (g.welcomeMessage      === undefined) g.welcomeMessage      = null
    if (g.welcomeMessages     === undefined) g.welcomeMessages     = []
    if (g.welcomeUseAI        === undefined) g.welcomeUseAI        = false
    // ── Embed ─────────────────────────────────────────────────────────────────
    if (g.welcomeEmbedTitle   === undefined) g.welcomeEmbedTitle   = null
    if (g.welcomeColor        === undefined) g.welcomeColor        = null
    if (g.welcomeThumbnail    === undefined) g.welcomeThumbnail    = true
    if (g.welcomeImageUrl     === undefined) g.welcomeImageUrl     = null
    if (g.welcomeFooter       === undefined) g.welcomeFooter       = null
    // ── Card ──────────────────────────────────────────────────────────────────
    if (g.welcomeCardEnabled    === undefined) g.welcomeCardEnabled    = true
    if (g.welcomeCardTheme      === undefined) g.welcomeCardTheme      = "classic"
    if (g.welcomeCardBackground === undefined) g.welcomeCardBackground = null
    if (g.welcomeAccentColor    === undefined) g.welcomeAccentColor    = null
    // ── Media ─────────────────────────────────────────────────────────────────
    if (g.welcomeMediaUrl     === undefined) g.welcomeMediaUrl     = null
    if (g.welcomeMediaMode    === undefined) g.welcomeMediaMode    = "card"
    // ── Join info ─────────────────────────────────────────────────────────────
    if (g.welcomeShowJoinInfo   === undefined) g.welcomeShowJoinInfo   = false
    if (g.welcomeNewAccountDays === undefined) g.welcomeNewAccountDays = 7
    if (g.welcomeShowRoles      === undefined) g.welcomeShowRoles      = false
    // ── Buttons ───────────────────────────────────────────────────────────────
    if (g.welcomeButtons      === undefined) g.welcomeButtons      = []
    // ── Seasonal ──────────────────────────────────────────────────────────────
    if (g.welcomeSeasonal     === undefined) g.welcomeSeasonal     = false
    // ── Autorole ──────────────────────────────────────────────────────────────
    if (g.autoroleId          === undefined) g.autoroleId          = null
    if (g.autoroleRoleName    === undefined) g.autoroleRoleName    = null

    return { data, config: g }
}

function isChannelAllowed(guildId, channelId) {
    const { config } = getServerConfig(guildId)
    if (!config.allowedChannels || config.allowedChannels.length === 0) return true
    return config.allowedChannels.includes(channelId)
}

module.exports = { loadConfig, saveConfig, getServerConfig, isChannelAllowed }
