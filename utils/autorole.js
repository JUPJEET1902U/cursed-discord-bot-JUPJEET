/**
 * utils/autorole.js
 * Autorole utility — store per-guild autorole config in MongoDB and apply on member join.
 */

const mongoose = require("mongoose")

// ── Schema ────────────────────────────────────────────────────────────────────

const autoroleSchema = new mongoose.Schema({
    guildId:   { type: String, required: true, unique: true, index: true },
    roleId:    { type: String, required: true },
    roleName:  { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
})

const AutoroleModel = mongoose.models.Autorole || mongoose.model("Autorole", autoroleSchema)

// ── CRUD helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch the autorole config for a guild.
 * @param {string} guildId
 * @returns {Promise<{roleId: string, roleName: string} | null>}
 */
async function getAutorole(guildId) {
    try {
        return await AutoroleModel.findOne({ guildId }).lean()
    } catch {
        return null
    }
}

/**
 * Save (upsert) the autorole config for a guild.
 * @param {string} guildId
 * @param {string} roleId
 * @param {string} roleName
 */
async function setAutorole(guildId, roleId, roleName) {
    await AutoroleModel.findOneAndUpdate(
        { guildId },
        { guildId, roleId, roleName, createdAt: new Date() },
        { upsert: true, new: true }
    )
}

/**
 * Remove the autorole config for a guild.
 * @param {string} guildId
 */
async function disableAutorole(guildId) {
    await AutoroleModel.deleteOne({ guildId })
}

// ── Apply on member join ──────────────────────────────────────────────────────

/**
 * Apply the configured autorole to a new member.
 * Silently skips bots, missing roles, and hierarchy violations.
 * @param {import("discord.js").GuildMember} member
 */
async function applyAutorole(member) {
    if (member.user.bot) return

    const config = await getAutorole(member.guild.id)
    if (!config) return

    const guild = member.guild
    const me = guild.members.me
    if (!me) return

    // Check bot has Manage Roles permission
    if (!me.permissions.has("ManageRoles")) {
        console.warn(`[Autorole] Bot lacks ManageRoles in guild ${guild.id}`)
        return
    }

    const role = guild.roles.cache.get(config.roleId)
    if (!role) {
        // Role was deleted — auto-disable
        console.warn(`[Autorole] Configured role ${config.roleId} not found in guild ${guild.id} — disabling autorole`)
        await disableAutorole(guild.id).catch(() => {})
        return
    }

    // Hierarchy check: bot's highest role must be above the target role
    if (me.roles.highest.position <= role.position) {
        console.warn(`[Autorole] Role ${role.name} is above bot's highest role in guild ${guild.id} — skipping`)
        return
    }

    try {
        await member.roles.add(role, "Autorole on join")
    } catch (err) {
        console.error(`[Autorole] Failed to add role to ${member.user.tag}: ${err.message}`)
    }
}

// ── Cleanup deleted roles ─────────────────────────────────────────────────────

/**
 * Check if the configured autorole was deleted and disable it if so.
 * Call this from a GuildRoleDelete event.
 * @param {import("discord.js").Guild} guild
 * @param {string} deletedRoleId
 */
async function cleanupDeletedRoles(guild, deletedRoleId) {
    const config = await getAutorole(guild.id)
    if (!config) return
    if (config.roleId !== deletedRoleId) return

    console.log(`[Autorole] Role ${deletedRoleId} deleted in guild ${guild.id} — disabling autorole`)
    await disableAutorole(guild.id).catch(() => {})
}

module.exports = { getAutorole, setAutorole, disableAutorole, applyAutorole, cleanupDeletedRoles }
