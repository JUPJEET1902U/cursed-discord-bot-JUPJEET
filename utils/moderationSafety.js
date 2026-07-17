const { PermissionFlagsBits } = require("discord.js")

const ACTION_PERMISSIONS = {
    WARN: PermissionFlagsBits.ModerateMembers,
    TIMEOUT: PermissionFlagsBits.ModerateMembers,
    UNTIMEOUT: PermissionFlagsBits.ModerateMembers,
    KICK: PermissionFlagsBits.KickMembers,
    BAN: PermissionFlagsBits.BanMembers,
    UNBAN: PermissionFlagsBits.BanMembers,
    PURGE: PermissionFlagsBits.ManageMessages,
    LOCK: PermissionFlagsBits.ManageChannels,
    UNLOCK: PermissionFlagsBits.ManageChannels,
    SLOWMODE: PermissionFlagsBits.ManageChannels,
}

function actionLabel(action) {
    return String(action || "moderate").toLowerCase().replace(/_/g, " ")
}

function memberTag(member) {
    return member?.user?.tag || member?.displayName || "that member"
}

async function resolveTargetMember(guild, targetUser) {
    if (!guild || !targetUser?.id) return null
    return guild.members.cache.get(targetUser.id)
        || await guild.members.fetch(targetUser.id).catch(() => null)
}

async function validateModerationTarget({ guild, actorMember, targetUser, action, skipActorPermission = false }) {
    const normalizedAction = String(action || "").toUpperCase()
    const label = actionLabel(normalizedAction)
    const botMember = guild?.members?.me
    const requiredPermission = ACTION_PERMISSIONS[normalizedAction]

    if (!guild || !actorMember || !targetUser) {
        return { ok: false, error: "The moderation target could not be resolved." }
    }
    if (requiredPermission && !skipActorPermission && !actorMember.permissions.has(requiredPermission)) {
        return { ok: false, error: `You do not have permission to ${label} members.` }
    }
    if (requiredPermission && !botMember?.permissions.has(requiredPermission)) {
        return { ok: false, error: `I do not have the Discord permission required to ${label} members.` }
    }
    if (targetUser.id === actorMember.id) {
        return { ok: false, error: `You cannot ${label} yourself.` }
    }
    if (targetUser.id === guild.ownerId) {
        return { ok: false, error: `The server owner cannot be ${label}d.` }
    }
    if (targetUser.id === botMember?.id) {
        return { ok: false, error: `I cannot ${label} myself.` }
    }

    const targetMember = await resolveTargetMember(guild, targetUser)
    if (!targetMember) {
        if (["BAN", "UNBAN"].includes(normalizedAction)) return { ok: true, targetMember: null }
        return { ok: false, error: "That user is not currently in this server." }
    }

    if (targetMember.user.bot && normalizedAction === "WARN") {
        return { ok: false, error: "Bots cannot receive warnings." }
    }

    const actorIsOwner = actorMember.id === guild.ownerId
    if (!actorIsOwner && actorMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
        return {
            ok: false,
            error: `You cannot ${label} **${memberTag(targetMember)}** because their highest role is equal to or above yours.`,
        }
    }

    if (botMember && botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
        return {
            ok: false,
            error: `I cannot ${label} **${memberTag(targetMember)}** because their highest role is equal to or above mine.`,
        }
    }

    if (normalizedAction === "TIMEOUT" && !targetMember.moderatable) {
        return { ok: false, error: "Discord will not allow me to timeout that member." }
    }
    if (normalizedAction === "KICK" && !targetMember.kickable) {
        return { ok: false, error: "Discord will not allow me to kick that member." }
    }
    if (normalizedAction === "BAN" && !targetMember.bannable) {
        return { ok: false, error: "Discord will not allow me to ban that member." }
    }

    return { ok: true, targetMember }
}

module.exports = {
    ACTION_PERMISSIONS,
    validateModerationTarget,
    resolveTargetMember,
}
