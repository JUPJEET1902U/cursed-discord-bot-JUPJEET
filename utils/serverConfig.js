/**
 * Backward-compatible server config facade.
 *
 * Existing bot features keep using getServerConfig/saveConfig while MongoDB is
 * the source of truth. serverConfig.json remains available only as a legacy
 * import source and is never updated by production callers.
 */

// GuildConfigStore reads this flag during module initialization. Force the
// legacy file into read-only import mode before loading the shared store.
process.env.GUILD_CONFIG_MIRROR_JSON = "false"

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
    const allowedChannels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []

    // Backward compatibility: existing guilds that already have an allow-list
    // are treated as restricted even before channelRestrictionEnabled existed.
    const restrictionEnabled = typeof config.channelRestrictionEnabled === "boolean"
        ? config.channelRestrictionEnabled
        : allowedChannels.length > 0

    if (!restrictionEnabled) return true
    return allowedChannels.includes(channelId)
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
    refreshMongoCache: GuildConfigStore.refreshMongoCache,
    migrateJsonConfigsToMongo: GuildConfigStore.migrateJsonConfigsToMongo,
    isMongoConnected: GuildConfigStore.isMongoConnected,
}
