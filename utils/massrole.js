/**
 * utils/massrole.js
 * Bulk add/remove roles with filter support and rate-limit awareness.
 */

const RATE_LIMIT_MS = 250 // 1 request per 250ms to stay within Discord limits

/**
 * Sleep helper.
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Apply a role to (or remove it from) all matching members in a guild.
 *
 * @param {import("discord.js").Guild}  guild   - The Discord guild
 * @param {import("discord.js").Role}   role    - The role to add/remove
 * @param {"humans"|"bots"|"everyone"} filter  - Which members to target
 * @param {boolean}                     isAdd   - true = add, false = remove
 * @returns {Promise<{added: number, removed: number, skipped: number, failed: number}>}
 */
async function applyMassRole(guild, role, filter = "everyone", isAdd = true) {
    const counts = { added: 0, removed: 0, skipped: 0, failed: 0 }

    // Fetch all members (ensures cache is populated)
    let members
    try {
        await guild.members.fetch()
        members = [...guild.members.cache.values()]
    } catch (err) {
        console.error(`[MassRole] Failed to fetch members: ${err.message}`)
        return counts
    }

    const me = guild.members.me
    if (!me) return counts

    const botHighestPos = me.roles.highest.position
    const rolePos       = role.position

    // Bot must be above the target role in hierarchy
    if (botHighestPos <= rolePos) {
        console.warn(`[MassRole] Role ${role.name} is above bot's highest role — aborting`)
        return counts
    }

    // Apply filter
    let targets = members
    if (filter === "humans") targets = members.filter(m => !m.user.bot)
    else if (filter === "bots") targets = members.filter(m => m.user.bot)

    for (const member of targets) {
        // Skip members whose highest role is at or above the bot's highest role
        if (member.roles.highest.position >= botHighestPos) {
            counts.skipped++
            continue
        }

        const hasRole = member.roles.cache.has(role.id)

        if (isAdd) {
            if (hasRole) { counts.skipped++; continue }
            try {
                await member.roles.add(role, "Mass role operation")
                counts.added++
            } catch {
                counts.failed++
            }
        } else {
            if (!hasRole) { counts.skipped++; continue }
            try {
                await member.roles.remove(role, "Mass role operation")
                counts.removed++
            } catch {
                counts.failed++
            }
        }

        await sleep(RATE_LIMIT_MS)
    }

    return counts
}

module.exports = { applyMassRole }
