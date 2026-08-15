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

const neutralizationFlights = new Map()
const recentNeutralizations = new Map()
const recoveryFlights = new Map()
const recentRecoveries = new Map()
const recoveredRoleIds = new Map()
const recoveredChannelIds = new Map()

const NEUTRALIZATION_REUSE_MS = 5000
const RECOVERY_REUSE_MS = 60_000
const RECOVERY_MAPPING_TTL_MS = 10 * 60_000

function hasDangerousPermissions(role) {
    return DANGEROUS_PERMISSIONS.some(permission => role?.permissions?.has(permission))
}

function sanitizeReason(reason, fallback = "CURSED emergency security response") {
    return String(reason || fallback).slice(0, 512)
}

function pruneStateMap(map, ttlMs, currentTime = Date.now(), maxSize = 5000) {
    for (const [key, value] of map) {
        const at = typeof value === "object" && value !== null ? Number(value.at) || 0 : Number(value) || 0
        if (at && currentTime - at > ttlMs) map.delete(key)
    }
    while (map.size > maxSize) map.delete(map.keys().next().value)
}

function neutralizationKey(guild, member) {
    return `${guild.id}:${member.id}`
}

async function neutralizeExecutorInternal(guild, member, config, { reason, actor } = {}) {
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

async function neutralizeExecutor(guild, member, config, options = {}) {
    if (!guild || !member) return neutralizeExecutorInternal(guild, member, config, options)
    const key = neutralizationKey(guild, member)
    const currentTime = Date.now()
    const recent = recentNeutralizations.get(key)
    if (recent?.result?.ok && currentTime - recent.at < NEUTRALIZATION_REUSE_MS) {
        return { ...recent.result, reused: true }
    }
    if (neutralizationFlights.has(key)) return neutralizationFlights.get(key)

    const flight = neutralizeExecutorInternal(guild, member, config, options)
        .then(result => {
            if (result.ok) recentNeutralizations.set(key, { at: Date.now(), result })
            pruneStateMap(recentNeutralizations, NEUTRALIZATION_REUSE_MS, Date.now(), 3000)
            return result
        })
        .finally(() => neutralizationFlights.delete(key))
    neutralizationFlights.set(key, flight)
    return flight
}

function recoveryMapKey(guildId, originalId) {
    return `${guildId}:${originalId}`
}

function recoveryKey(kind, guildId, originalId) {
    return `${kind}:${guildId}:${originalId}`
}

function setRecoveredId(map, guildId, originalId, restoredId) {
    map.set(recoveryMapKey(guildId, originalId), { id: String(restoredId), at: Date.now() })
    pruneStateMap(map, RECOVERY_MAPPING_TTL_MS, Date.now(), 5000)
}

function recoveredId(map, guildId, originalId) {
    const key = recoveryMapKey(guildId, originalId)
    const value = map.get(key)
    if (!value) return null
    if (Date.now() - value.at > RECOVERY_MAPPING_TTL_MS) {
        map.delete(key)
        return null
    }
    return value.id
}

function mappedRoleId(guild, originalId) {
    return recoveredId(recoveredRoleIds, guild.id, originalId) || String(originalId)
}

function mappedChannelId(guild, originalId) {
    return recoveredId(recoveredChannelIds, guild.id, originalId) || String(originalId)
}

function validOverwrite(guild, overwrite, resolvedId) {
    if (resolvedId === guild.id) return true
    if (Number(overwrite.type) === 0) {
        return guild.roles.cache.has(resolvedId)
            || recoveredId(recoveredRoleIds, guild.id, overwrite.id) === resolvedId
    }
    // Member-specific overwrites remain valid even when the member is not cached.
    // Discord validates the snowflake on create; dropping them here would silently
    // weaken recovered channel permissions in larger guilds with partial caches.
    return Boolean(resolvedId)
}

function channelCreateOptions(guild, channel, reason) {
    const overwrites = channel.permissionOverwrites?.cache
        ? [...channel.permissionOverwrites.cache.values()]
            .map(overwrite => {
                const originalId = String(overwrite.id)
                const id = Number(overwrite.type) === 0 ? mappedRoleId(guild, originalId) : originalId
                return { overwrite, id }
            })
            .filter(({ overwrite, id }) => validOverwrite(guild, overwrite, id))
            .map(({ overwrite, id }) => ({
                id,
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
    if (channel.parentId) {
        const parentId = mappedChannelId(guild, channel.parentId)
        if (guild.channels.cache.has(parentId) || recoveredId(recoveredChannelIds, guild.id, channel.parentId)) options.parent = parentId
    }

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

async function waitForRecoveryDependencies(guild, channel) {
    const dependencies = []
    if (channel.parentId && !guild.channels.cache.has(channel.parentId)) {
        const parentFlight = recoveryFlights.get(recoveryKey("channel", guild.id, channel.parentId))
        if (parentFlight) dependencies.push(parentFlight)
    }
    if (channel.permissionOverwrites?.cache) {
        for (const overwrite of channel.permissionOverwrites.cache.values()) {
            if (Number(overwrite.type) !== 0 || guild.roles.cache.has(overwrite.id)) continue
            const roleFlight = recoveryFlights.get(recoveryKey("role", guild.id, overwrite.id))
            if (roleFlight) dependencies.push(roleFlight)
        }
    }
    if (dependencies.length) await Promise.allSettled(dependencies)
}

async function runRecoveryOnce(kind, guild, originalId, work) {
    const key = recoveryKey(kind, guild.id, originalId)
    const currentTime = Date.now()
    const recent = recentRecoveries.get(key)
    if (recent?.result?.ok && currentTime - recent.at < RECOVERY_REUSE_MS) {
        return { ...recent.result, reused: true }
    }
    if (recoveryFlights.has(key)) return recoveryFlights.get(key)

    const flight = Promise.resolve()
        .then(work)
        .then(result => {
            if (result?.ok) recentRecoveries.set(key, { at: Date.now(), result })
            pruneStateMap(recentRecoveries, RECOVERY_REUSE_MS, Date.now(), 5000)
            return result
        })
        .finally(() => recoveryFlights.delete(key))
    recoveryFlights.set(key, flight)
    return flight
}

async function restoreDeletedChannel(guild, channel, reason) {
    if (!guild || !channel || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, error: "Manage Channels permission is unavailable." }
    }
    return runRecoveryOnce("channel", guild, channel.id, async () => {
        try {
            await waitForRecoveryDependencies(guild, channel)
            const created = await guild.channels.create(channelCreateOptions(guild, channel, reason))
            setRecoveredId(recoveredChannelIds, guild.id, channel.id, created.id)
            if (Number.isInteger(channel.rawPosition)) await created.setPosition(channel.rawPosition).catch(() => {})
            return { ok: true, restoredId: created.id, originalId: channel.id }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    })
}

async function restoreDeletedRole(guild, role, reason) {
    if (!guild || !role || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { ok: false, error: "Manage Roles permission is unavailable." }
    }
    return runRecoveryOnce("role", guild, role.id, async () => {
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
            setRecoveredId(recoveredRoleIds, guild.id, role.id, created.id)
            if (Number.isInteger(role.position)) {
                const highestSafePosition = Math.max(1, guild.members.me.roles.highest.position - 1)
                await created.setPosition(Math.min(role.position, highestSafePosition)).catch(() => {})
            }
            return { ok: true, restoredId: created.id, originalId: role.id }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    })
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
