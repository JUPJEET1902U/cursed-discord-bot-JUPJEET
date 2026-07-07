/**
 * utils/autorole.js
 * Autorole system for CURSED bot.
 *
 * Exports:
 *   getAutorole(guildId)                        — fetch autorole config
 *   setAutorole(guildId, roleId, roleName)       — save autorole config
 *   disableAutorole(guildId)                     — remove autorole config
 *   applyAutorole(member)                        — assign role on member join
 *   cleanupDeletedRoles(guild, deletedRoleId)    — disable if role deleted
 */

const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig, saveConfig } = require("./serverConfig")
const logger = require("./logger")
const log = logger.child("Autorole")

/**
 * Fetch the autorole config for a guild.
 * @param {string} guildId
 * @returns {{ autoroleId: string|null, autoroleRoleName: string|null }}
 */
function getAutorole(guildId) {
    const { config } = getServerConfig(guildId)
    return {
        autoroleId: config.autoroleId || null,
        autoroleRoleName: config.autoroleRoleName || null,
    }
}

/**
 * Save autorole config for a guild.
 * @param {string} guildId
 * @param {string} roleId
 * @param {string} roleName
 */
function setAutorole(guildId, roleId, roleName) {
    const { data, config } = getServerConfig(guildId)
    config.autoroleId = roleId
    config.autoroleRoleName = roleName
    saveConfig(data)
    log.info(`Autorole set for guild ${guildId}: ${roleName} (${roleId})`)
}

/**
 * Remove autorole config for a guild.
 * @param {string} guildId
 */
function disableAutorole(guildId) {
    const { data, config } = getServerConfig(guildId)
    config.autoroleId = null
    config.autoroleRoleName = null
    saveConfig(data)
    log.info(`Autorole disabled for guild ${guildId}`)
}

/**
 * Apply the configured autorole to a new member.
 * Silently skips if: no autorole configured, member is a bot, role is missing,
 * bot lacks permissions, or role is above the bot in the hierarchy.
 * @param {import("discord.js").GuildMember} member
 */
async function applyAutorole(member) {
    // Ignore bots
    if (member.user.bot) return

    const { autoroleId } = getAutorole(member.guild.id)
    if (!autoroleId) return

    const guild = member.guild

    // Resolve the role — silently skip if deleted
    const role = guild.roles.cache.get(autoroleId)
    if (!role) {
        log.warn(`Autorole role ${autoroleId} not found in guild ${guild.id} — skipping`)
        return
    }

    // Never assign managed (integration) roles
    if (role.managed) {
        log.warn(`Autorole role ${role.name} is managed — skipping`)
        return
    }

    // Check bot has ManageRoles permission
    const botMember = guild.members.me
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        log.error(`Bot lacks ManageRoles permission in guild ${guild.id}`)
        return
    }

    // Verify role hierarchy: bot's highest role must be above the target role
    if (botMember.roles.highest.position <= role.position) {
        log.error(`Bot's highest role is not above autorole "${role.name}" in guild ${guild.id}`)
        return
    }

    try {
        await member.roles.add(role, "Autorole on join")
        log.info(`Applied autorole "${role.name}" to ${member.user.tag} in guild ${guild.id}`)
    } catch (err) {
        log.error(`Failed to apply autorole to ${member.user.tag}: ${err.message}`)
    }
}

/**
 * Disable autorole if the deleted role was the configured autorole.
 * @param {import("discord.js").Guild} guild
 * @param {string} deletedRoleId
 */
async function cleanupDeletedRoles(guild, deletedRoleId) {
    const { autoroleId } = getAutorole(guild.id)
    if (!autoroleId || autoroleId !== deletedRoleId) return

    disableAutorole(guild.id)
    log.info(`Autorole disabled in guild ${guild.id} because role ${deletedRoleId} was deleted`)
}

module.exports = { getAutorole, setAutorole, disableAutorole, applyAutorole, cleanupDeletedRoles }
