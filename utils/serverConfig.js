/**
 * Backward-compatible server config facade.
 *
 * Existing bot features keep using getServerConfig/saveConfig while the
 * underlying source migrates from serverConfig.json to MongoDB.
 */

const GuildConfigStore = require("./GuildConfigStore")

function loadConfig() {
    return GuildConfigStore.loadAllGuildConfigs()
}

function saveConfig(data) {
    GuildConfigStore.saveAllGuildConfigs(data)
}

function getServerConfig(guildId) {
    const config = GuildConfigStore.getGuildConfig(guildId)
    const data = GuildConfigStore.createTrackedGuildData(guildId, config)
    return { data, config }
}

function isChannelAllowed(guildId, channelId) {
    const { config } = getServerConfig(guildId)
    if (!config.allowedChannels || config.allowedChannels.length === 0) return true
    return config.allowedChannels.includes(channelId)
}

module.exports = {
    loadConfig,
    saveConfig,
    getServerConfig,
    isChannelAllowed,
    getGuildConfig: GuildConfigStore.getGuildConfig,
    saveGuildConfig: GuildConfigStore.saveGuildConfig,
    updateGuildConfig: GuildConfigStore.updateGuildConfig,
    updateGuildConfigAndWait: GuildConfigStore.updateGuildConfigAndWait,
}
