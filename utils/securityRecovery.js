const {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
} = require("discord.js")
const { quarantineMember } = require("./quarantineState")
const { enableEmergencyLockdown } = require("./lockdownState")

const DANGEROUS_PERMISSIONS = Object.freeze([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ManageEvents,
    PermissionFlagsBits.MentionEveryone,
])

const internalActions = new Map()

function internalKey(guildId, eventType, targetId) {
    return `${guildId}:${eventType}:${targetId || "*"}`
}

function markInternalAction(guildId, eventType, targetId, ttlMs = 15_000) {
    const key = internalKey(guildId, eventType, targetId)
    internalActions.set(key, Date.now() + ttlMs)
    const timer = setTimeout(() => {
        if ((internalActions.get(key) || 0) <= Date.now()) internalActions.delete(key)
    }, ttlMs + 1000)
    timer.unref?.()
}

function consumeInternalAction(guildId, eventType, targetId) {
    const exact = internalKey(guildId, eventType, targetId)
    const wildcard = internalKey(guildId, eventType, "*")
    for (const key of [exact, wildcard]) {
        const expiresAt = internalActions.get(key) || 0
        if (expiresAt > Date.now()) {
            internalActions.delete(key)
            return true
        }
        if (expiresAt) internalActions.delete(key)
    }
    return false
}

function hasDangerousPermissions(roleOrPermissions) {
    const permissions = roleOrPermissions?.permissions || roleOrPermissions
    if (!permissions?.has) return false
    return DANGEROUS_PERMISSIONS.some(permission => permissions.has(permission))
}

function dangerousRoleIds(member) {
    if (!member?.roles?.cache) return []
    return [...member.roles.cache.values()]
        .filter(role => role.id !== member.guild.id && !role.managed && role.editable && hasDangerousPermissions(role))
        .map(role => role.id)
}

async function stripDangerousRoles(guild, member, reason) {
    if (!member) return { ok: false, error: "Executor is no longer in the server." }
    if (member.id === guild.ownerId) return { ok: false, error: "Discord does not allow role removal from the server owner." }
    if (!member.manageable) return { ok: false, error: "Role hierarchy prevents CURSED from managing the executor." }
    const ids = dangerousRoleIds(member)
    if (!ids.length) return { ok: true, removedRoleIds: [] }
    await member.roles.remove(ids, String(reason || "Fortress containment").slice(0, 512))
    return { ok: true, removedRoleIds: ids }
}

async function neutralizeExecutor(guild, member, securityConfig, fortressConfig, { reason, actor } = {}) {
    if (!guild || !member) return { ok: false, action: "alert", errors: ["Executor member could not be resolved."] }
    if (member.id === guild.ownerId) {
        return { ok: false, action: "owner-alert", errors: ["The server owner cannot be neutralized by a bot."] }
    }
    if (member.id === guild.members.me?.id) return { ok: false, action: "ignored-self", errors: [] }

    const results = []
    const errors = []
    const order = fortressConfig?.response?.order || ["strip_roles", "quarantine", "timeout", "lockdown"]
    const continueAfter = fortressConfig?.response?.continueAfterContainment === true

    for (const action of order) {
        try {
            if (action === "strip_roles") {
                const result = await stripDangerousRoles(guild, member, reason)
                if (result.ok) {
                    results.push({ action, ...result })
                    if (result.removedRoleIds.length && !continueAfter) break
                } else errors.push(result.error)
                continue
            }

            if (action === "quarantine") {
                if (!securityConfig?.quarantine?.enabled) {
                    errors.push("Quarantine is disabled.")
                    continue
                }
                const result = await quarantineMember(guild, member, securityConfig, { reason, moderator: actor })
                if (result.ok) {
                    results.push({ action, state: result.state })
                    if (!continueAfter) break
                } else errors.push(result.error)
                continue
            }

            if (action === "timeout") {
                const duration = Math.max(1, Math.min(40320, fortressConfig?.response?.timeoutMinutes || 10080)) * 60_000
                if (!member.moderatable) {
                    errors.push("Executor cannot be timed out because of role hierarchy or Discord restrictions.")
                    continue
                }
                await member.timeout(duration, String(reason || "Fortress containment").slice(0, 512))
                results.push({ action, durationMs: duration })
                if (!continueAfter) break
                continue
            }

            if (action === "kick") {
                if (!member.kickable) {
                    errors.push("Executor cannot be kicked because of role hierarchy.")
                    continue
                }
                await member.kick(String(reason || "Fortress containment").slice(0, 512))
                results.push({ action })
                if (!continueAfter) break
                continue
            }

            if (action === "ban") {
                if (!member.bannable) {
                    errors.push("Executor cannot be banned because of role hierarchy.")
                    continue
                }
                await member.ban({ reason: String(reason || "Fortress containment").slice(0, 512), deleteMessageSeconds: 0 })
                results.push({ action })
                if (!continueAfter) break
                continue
            }

            if (action === "lockdown") {
                if (!securityConfig?.lockdown?.enabled) {
                    errors.push("Emergency lockdown is disabled.")
                    continue
                }
                const result = await enableEmergencyLockdown(guild, securityConfig, { reason, actor })
                if (result.ok) {
                    results.push({ action, affectedChannels: result.affectedChannels })
                    if (!continueAfter) break
                } else errors.push(result.error)
            }
        } catch (err) {
            errors.push(`${action}: ${err.message}`)
        }
    }

    return {
        ok: results.length > 0,
        action: results.map(item => item.action).join("+") || "alert",
        results,
        errors,
    }
}

function serializeOverwrites(channel) {
    return channel.permissionOverwrites
        ? [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: new PermissionsBitField(overwrite.allow.bitfield),
            deny: new PermissionsBitField(overwrite.deny.bitfield),
        }))
        : []
}

function channelCreateOptions(channel, reason) {
    const options = {
        name: channel.name,
        type: channel.type,
        reason,
        permissionOverwrites: serializeOverwrites(channel),
    }
    if (channel.parentId && channel.guild.channels.cache.has(channel.parentId)) options.parent = channel.parentId
    if ("topic" in channel) options.topic = channel.topic || null
    if ("nsfw" in channel) options.nsfw = Boolean(channel.nsfw)
    if ("rateLimitPerUser" in channel) options.rateLimitPerUser = channel.rateLimitPerUser || 0
    if ("bitrate" in channel && channel.bitrate) options.bitrate = channel.bitrate
    if ("userLimit" in channel) options.userLimit = channel.userLimit || 0
    if ("rtcRegion" in channel) options.rtcRegion = channel.rtcRegion || null
    if ("videoQualityMode" in channel && channel.videoQualityMode) options.videoQualityMode = channel.videoQualityMode
    if ("defaultAutoArchiveDuration" in channel && channel.defaultAutoArchiveDuration) options.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration
    if ("defaultThreadRateLimitPerUser" in channel) options.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser || 0
    if ("availableTags" in channel && Array.isArray(channel.availableTags)) options.availableTags = channel.availableTags
    if ("defaultReactionEmoji" in channel && channel.defaultReactionEmoji) options.defaultReactionEmoji = channel.defaultReactionEmoji
    if ("defaultSortOrder" in channel && channel.defaultSortOrder !== null) options.defaultSortOrder = channel.defaultSortOrder
    if ("defaultForumLayout" in channel && channel.defaultForumLayout !== null) options.defaultForumLayout = channel.defaultForumLayout
    return options
}

function restorableChannel(channel) {
    return channel && !channel.isThread?.() && [
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildCategory,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
    ].includes(channel.type)
}

async function recreateDeletedChannel(channel, reason) {
    if (!restorableChannel(channel)) return { ok: false, error: "Deleted channel type is not restorable." }
    markInternalAction(channel.guild.id, "channelCreates", "*", 20_000)
    const recreated = await channel.guild.channels.create(channelCreateOptions(channel, reason))
    await recreated.setPosition(channel.rawPosition || 0, { reason }).catch(() => {})
    return { ok: true, restoredId: recreated.id, originalId: channel.id }
}

async function recreateDeletedRole(role, reason) {
    if (!role || role.managed || role.id === role.guild.id) return { ok: false, error: "Deleted role is not restorable." }
    markInternalAction(role.guild.id, "roleCreates", "*", 20_000)
    const recreated = await role.guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: new PermissionsBitField(role.permissions.bitfield),
        reason,
    })
    await recreated.setPosition(Math.min(role.position, role.guild.roles.cache.size - 1), { reason }).catch(() => {})
    return { ok: true, restoredId: recreated.id, originalId: role.id }
}

async function revertChannelUpdate(oldChannel, newChannel, reason) {
    if (!oldChannel || !newChannel || !newChannel.guild?.members?.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return { ok: false, error: "Channel update cannot be reverted." }
    markInternalAction(newChannel.guild.id, "channelUpdates", newChannel.id, 20_000)
    const edits = {
        name: oldChannel.name,
        position: oldChannel.rawPosition,
        parent: oldChannel.parentId || null,
        permissionOverwrites: serializeOverwrites(oldChannel),
    }
    if ("topic" in oldChannel) edits.topic = oldChannel.topic || null
    if ("nsfw" in oldChannel) edits.nsfw = oldChannel.nsfw
    if ("rateLimitPerUser" in oldChannel) edits.rateLimitPerUser = oldChannel.rateLimitPerUser || 0
    await newChannel.edit(edits, reason)
    return { ok: true }
}

async function revertRoleUpdate(oldRole, newRole, reason) {
    if (!oldRole || !newRole || !newRole.editable) return { ok: false, error: "Role update cannot be reverted." }
    markInternalAction(newRole.guild.id, "roleUpdates", newRole.id, 20_000)
    await newRole.edit({
        name: oldRole.name,
        color: oldRole.color,
        hoist: oldRole.hoist,
        mentionable: oldRole.mentionable,
        permissions: new PermissionsBitField(oldRole.permissions.bitfield),
    }, reason)
    await newRole.setPosition(oldRole.position, { reason }).catch(() => {})
    return { ok: true }
}

async function removeCreatedChannel(channel, reason) {
    if (!channel?.deletable) return { ok: false, error: "Unauthorized channel is not deletable." }
    markInternalAction(channel.guild.id, "channelDeletes", channel.id, 20_000)
    await channel.delete(reason)
    return { ok: true }
}

async function removeCreatedRole(role, reason) {
    if (!role?.editable || role.managed) return { ok: false, error: "Unauthorized role is not removable." }
    markInternalAction(role.guild.id, "roleDeletes", role.id, 20_000)
    await role.delete(reason)
    return { ok: true }
}

async function unbanVictim(guild, user, reason) {
    if (!user?.id) return { ok: false, error: "Banned user could not be resolved." }
    markInternalAction(guild.id, "unbans", user.id, 20_000)
    await guild.members.unban(user.id, reason)
    return { ok: true }
}

async function removeUnauthorizedBot(member, reason) {
    if (!member?.user?.bot) return { ok: false, error: "Target is not a bot member." }
    if (member.bannable) {
        await member.ban({ reason, deleteMessageSeconds: 0 })
        return { ok: true, action: "ban" }
    }
    if (member.kickable) {
        await member.kick(reason)
        return { ok: true, action: "kick" }
    }
    return { ok: false, error: "Unauthorized bot cannot be removed because of role hierarchy." }
}

async function removeUnauthorizedWebhook(guild, webhookId, reason) {
    if (!webhookId) return { ok: false, error: "Webhook ID unavailable." }
    const webhooks = await guild.fetchWebhooks()
    const webhook = webhooks.get(webhookId)
    if (!webhook) return { ok: true, action: "already-gone" }
    await webhook.delete(reason)
    return { ok: true, action: "delete" }
}

async function removeDangerousRoleGrant(oldMember, newMember, reason) {
    if (!oldMember || !newMember || !newMember.manageable) return { ok: false, error: "Member role grant cannot be reverted." }
    const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id) && hasDangerousPermissions(role) && role.editable)
    if (!added.size) return { ok: false, error: "No dangerous role grant found." }
    markInternalAction(newMember.guild.id, "memberRoleUpdates", newMember.id, 20_000)
    await newMember.roles.remove([...added.keys()], reason)
    return { ok: true, removedRoleIds: [...added.keys()] }
}

module.exports = {
    DANGEROUS_PERMISSIONS,
    markInternalAction,
    consumeInternalAction,
    hasDangerousPermissions,
    dangerousRoleIds,
    stripDangerousRoles,
    neutralizeExecutor,
    recreateDeletedChannel,
    recreateDeletedRole,
    revertChannelUpdate,
    revertRoleUpdate,
    removeCreatedChannel,
    removeCreatedRole,
    unbanVictim,
    removeUnauthorizedBot,
    removeUnauthorizedWebhook,
    removeDangerousRoleGrant,
}
