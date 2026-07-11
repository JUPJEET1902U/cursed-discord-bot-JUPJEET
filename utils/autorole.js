/**
 * utils/autorole.js
 * Per-guild autorole management — backed by serverConfig.json.
 *
 * Exports:
 *   getAutorole(guildId)               → { autoroleId, autoroleRoleName }
 *   setAutorole(guildId, id, name)
 *   disableAutorole(guildId)
 */

const { getServerConfig, saveConfig } = require("./serverConfig")

/**
 * Get the autorole config for a guild.
 * @param {string} guildId
 * @returns {{ autoroleId: string|null, autoroleRoleName: string|null }}
 */
function getAutorole(guildId) {
    const { config } = getServerConfig(guildId)
    return {
        autoroleId:       config.autoroleId       || null,
        autoroleRoleName: config.autoroleRoleName || null,
    }
}

/**
 * Save an autorole for a guild.
 * @param {string} guildId
 * @param {string} roleId
 * @param {string} roleName
 */
function setAutorole(guildId, roleId, roleName) {
    const { data, config } = getServerConfig(guildId)
    config.autoroleId       = roleId
    config.autoroleRoleName = roleName || null
    saveConfig(data)
}

/**
 * Remove the autorole config for a guild.
 * @param {string} guildId
 */
function disableAutorole(guildId) {
    const { data, config } = getServerConfig(guildId)
    config.autoroleId       = null
    config.autoroleRoleName = null
    saveConfig(data)
}

module.exports = { getAutorole, setAutorole, disableAutorole }
