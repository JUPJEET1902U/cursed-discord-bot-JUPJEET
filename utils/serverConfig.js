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
        if (!data[guildId].paymentLinks) data[guildId].paymentLinks = {}
    }
    // Welcome system fields — use explicit undefined checks so saved falsy values
    // (e.g. welcomeThumbnail: false, welcomeUseAI: false) are never overwritten.
    if (data[guildId].welcomeChannelId  === undefined) data[guildId].welcomeChannelId  = null
    if (data[guildId].welcomeMessage    === undefined) data[guildId].welcomeMessage    = null
    if (data[guildId].welcomeUseAI      === undefined) data[guildId].welcomeUseAI      = false
    if (data[guildId].welcomeColor      === undefined) data[guildId].welcomeColor      = null
    if (data[guildId].welcomeThumbnail  === undefined) data[guildId].welcomeThumbnail  = true
    if (data[guildId].welcomeImageUrl   === undefined) data[guildId].welcomeImageUrl   = null
    if (data[guildId].welcomeFooter     === undefined) data[guildId].welcomeFooter     = null
    // Autorole fields
    if (data[guildId].autoroleId        === undefined) data[guildId].autoroleId        = null
    if (data[guildId].autoroleRoleName  === undefined) data[guildId].autoroleRoleName  = null
    return { data, config: data[guildId] }
}

function isChannelAllowed(guildId, channelId) {
    const { config } = getServerConfig(guildId)
    if (!config.allowedChannels || config.allowedChannels.length === 0) return true
    return config.allowedChannels.includes(channelId)
}

module.exports = { loadConfig, saveConfig, getServerConfig, isChannelAllowed }
