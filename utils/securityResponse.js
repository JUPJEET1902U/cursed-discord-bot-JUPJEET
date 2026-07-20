const { ChannelType, PermissionFlagsBits } = require("discord.js")
const { enableEmergencyLockdown } = require("./lockdownState")
const { buildOwnerNotification } = require("./securityOwnerNotification")

const DANGEROUS_PERMISSIONS = Object.freeze([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.MentionEveryone,
])

function hasDangerousPermissions(role) {
    return DANGEROUS_PERMISSIONS.some(permission => role?.permissions?.has(permission))
}

function sanitizeReason(reason, fallback = "CURSED emergency security response") {
    return String(reason || fallback).slice(0, 512)
}

async function neutralizeExecutor(guild, member, config, { reason, actor } = {}) {
    if (!guild || !member) return { ok: false, action: "alert", error: "Executor could not be resolved." }
    if (member.id === guild.ownerId) return { ok: false, action: "alert", error: "Discord does not allow bots to neutralize the server owner." }
    if (member.id === guild.members.me?.id) return { ok: false, action: "alert", error: "CURSED cannot target itself." }

    const safeReason = sanitizeReason(reason)
    const result = {
        ok: false,
        action: "neutralize",
        banned: false,
        timedOut: false,
        removedRoleIds: [],
        deletedWebhookIds: [],
        errors: [],
    }

    if (member.user?.bot && config?.antiNuke?.banMaliciousBots !== false && member.bannable) {
        try {
            await guild.members.ban(member.id, { reason: safeReason, deleteMessageSeconds: 86400 })
            result.banned = true
            result.ok = true
        } catch (err) {
            result.errors.push(`bot ban failed: ${err.message}`)
        }
    }

    if (!result.banned) {
        if (!member.manageable) {
            result.errors.push("Discord role hierarchy prevents role removal")
        } else if (config?.antiNuke?.removeDangerousRoles !== false) {
            const removable = [...member.roles.cache.values()]
                .filter(role => role.id !== guild.id && !role.managed && role.editable && hasDangerousPermissions(role))
                .map(role => role.id)
            if (removable.length) {
                try {
                    await member.roles.remove(removable, safeReason)
                    result.removedRoleIds = removable
                    result.ok = true
                } catch (err) {
                    result.errors.push(`dangerous role removal failed: ${err.message}`)
                }
            }
        }

        const timeoutMinutes = Math.max(1, Math.min(40320, Number(config?.antiNuke?.neutralizeTimeoutMinutes) || 10080))
        if (!member.user?.bot && member.moderatable) {
            try {
                await member.timeout(timeoutMinutes * 60_000, safeReason)
                result.timedOut = true
                result.ok = true
            } catch (err) {
                result.errors.push(`timeout failed: ${err.message}`)
            }
        }
    }

    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
        try {
            const webhooks = await guild.fetchWebhooks()
            const owned = webhooks.filter(webhook => String(webhook.owner?.id || "") === member.id)
            for (const webhook of owned.values()) {
                try {
                    await webhook.delete(safeReason)
                    result.deletedWebhookIds.push(webhook.id)
                    result.ok = true
                } catch (err) {
                    result.errors.push(`webhook ${webhook.id}: ${err.message}`)
                }
            }
        } catch (err) {
            result.errors.push(`webhook cleanup failed: ${err.message}`)
        }
    }

    if (config?.antiNuke?.autoLockdown === true && config?.lockdown?.enabled !== false) {
        const lockdown = await enableEmergencyLockdown(guild, config, { reason: safeReason, actor }).catch(err => ({ ok: false, error: err.message }))
        result.lockdown = lockdown.ok === true
        if (!lockdown.ok && !String(lockdown.error || "").includes("already active")) result.errors.push(`lockdown failed: ${lockdown.error}`)
        if (lockdown.ok) result.ok = true
    }

    return result
}

function validOverwrite(guild, overwrite) {
    if (overwrite.id === guild.id) return true
    if (overwrite.type === 0) return guild.roles.cache.has(overwrite.id)
    return guild.members.cache.has(overwrite.id)
}

function channelCreateOptions(guild, channel, reason) {
    const overwrites = channel.permissionOverwrites?.cache
        ? [...channel.permissionOverwrites.cache.values()]
            .filter(overwrite => validOverwrite(guild, overwrite))
            .map(overwrite => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield,
                deny: overwrite.deny.bitfield,
            }))
        : []
    const options = {
        name: channel.name,
        type: channel.type,
        permissionOverwrites: overwrites,
        reason: sanitizeReason(reason, "CURSED anti-nuke channel recovery"),
    }
    if (channel.parentId && guild.channels.cache.has(channel.parentId)) options.parent = channel.parentId

    const textLike = [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
    ].includes(channel.type)
    if (textLike) {
        options.topic = channel.topic || undefined
        options.nsfw = channel.nsfw || false
    }
    if ([ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) {
        options.rateLimitPerUser = channel.rateLimitPerUser || 0
    }
    if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
        options.bitrate = channel.bitrate || undefined
        options.userLimit = channel.userLimit || undefined
    }
    return options
}

async function restoreDeletedChannel(guild, channel, reason) {
    if (!guild || !channel || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, error: "Manage Channels permission is unavailable." }
    }
    try {
        const created = await guild.channels.create(channelCreateOptions(guild, channel, reason))
        if (Number.isInteger(channel.rawPosition)) await created.setPosition(channel.rawPosition).catch(() => {})
        return { ok: true, restoredId: created.id, originalId: channel.id }
    } catch (err) {
        return { ok: false, error: err.message }
    }
}

async function restoreDeletedRole(guild, role, reason) {
    if (!guild || !role || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { ok: false, error: "Manage Roles permission is unavailable." }
    }
    try {
        const created = await guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions.bitfield,
            mentionable: role.mentionable,
            unicodeEmoji: role.unicodeEmoji || undefined,
            reason: sanitizeReason(reason, "CURSED anti-nuke role recovery"),
        })
        if (Number.isInteger(role.position)) {
            const highestSafePosition = Math.max(1, guild.members.me.roles.highest.position - 1)
            await created.setPosition(Math.min(role.position, highestSafePosition)).catch(() => {})
        }
        return { ok: true, restoredId: created.id, originalId: role.id }
    } catch (err) {
        return { ok: false, error: err.message }
    }
}

async function notifyOwner(guild, message) {
    if (!guild?.ownerId) return false
    const payload = buildOwnerNotification(guild, message)
    if (!payload) return true
    const owner = await guild.client.users.fetch(guild.ownerId).catch(() => null)
    if (!owner) return false
    return owner.send(payload)
        .then(() => true)
        .catch(() => false)
}

module.exports = {
    DANGEROUS_PERMISSIONS,
    hasDangerousPermissions,
    neutralizeExecutor,
    restoreDeletedChannel,
    restoreDeletedRole,
    notifyOwner,
}
