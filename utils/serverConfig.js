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
    return { data, config: data[guildId] }
}

function isChannelAllowed(guildId, channelId) {
    const { config } = getServerConfig(guildId)
    if (!config.allowedChannels || config.allowedChannels.length === 0) return true
    return config.allowedChannels.includes(channelId)
}

module.exports = { loadConfig, saveConfig, getServerConfig, isChannelAllowed }
