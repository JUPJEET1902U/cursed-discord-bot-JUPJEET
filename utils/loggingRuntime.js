const { AuditLogEvent, Events } = require("discord.js")
const { LOG_COLORS, buildLogEmbed, userAvatar } = require("./logPresentation")
const { colorToInt, getLogCategory } = require("./loggingConfig")
const { fetchMatchingAuditEntry } = require("./securityProtection")
const logger = require("./logger")

const log = logger.child("LoggingRuntime")
const SAFE_MENTIONS = { parse: [] }
let attached = false

function truncate(value, max = 1000) {
    const text = String(value ?? "")
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

function displayUser(user) {
    if (!user) return "Unknown user"
    return user.id ? `<@${user.id}>` : `**${user.tag || user.username || "Unknown user"}**`
}

function categoryLabel(key) {
    if (key.startsWith("message")) return "Message"
    if (key.startsWith("member")) return "Member"
    if (key.startsWith("role")) return "Role"
    if (key.startsWith("channel")) return "Channel"
    if (key.startsWith("voice")) return "Voice"
    if (key.startsWith("invite") || key === "guildUpdate") return "Server"
    if (key.startsWith("emoji")) return "Emoji"
    if (key === "moderationAction") return "Moderation"
    if (key === "securityAlert") return "Security"
    if (key === "ticketEvent") return "Ticket"
    return "Server"
}

function plainLogText(label, event, description, fields = [], footerMeta = "") {
    const lines = [`**CURSED • ${label} Logs • ${event}**`]
    if (description) lines.push(String(description))
    for (const field of fields) {
        const value = String(field?.value || "").replace(/^>\s?/gm, "").trim()
        if (value) lines.push(`**${String(field.name || "DETAIL").replace(/_/g, " ")}**\n${value}`)
    }
    if (footerMeta) lines.push(`_${footerMeta}_`)
    return truncate(lines.join("\n\n"), 1900)
}

function activeCategory(guild, key, subjectIsBot = false) {
    if (!guild?.id) return null
    const config = getLogCategory(guild.id, key)
    if (!config?.enabled || !config.channelId) return null
    if (config.ignoreBots && subjectIsBot) return null
    return config
}

async function sendLogCategory(guild, key, {
    event,
    icon = "📋",
    description = "",
    fields = [],
    thumbnail = null,
    footerMeta = "",
    subjectIsBot = false,
    fallbackColor = LOG_COLORS.info,
} = {}) {
    const config = activeCategory(guild, key, subjectIsBot)
    if (!config) return false

    const channel = guild.channels.cache.get(config.channelId)
        || await guild.channels.fetch(config.channelId).catch(() => null)
    if (!channel?.isTextBased?.()) return false

    try {
        if (config.embed) {
            const embed = buildLogEmbed({
                guild,
                category: categoryLabel(key),
                event,
                icon,
                color: colorToInt(config.color, fallbackColor),
                description,
                fields,
                thumbnail,
                footerMeta,
            })
            await channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        } else {
            await channel.send({
                content: plainLogText(categoryLabel(key), event, description, fields, footerMeta),
                allowedMentions: SAFE_MENTIONS,
            })
        }
        return true
    } catch (err) {
        log.warn(`Failed ${key} log in ${guild.id}: ${err.message}`)
        return false
    }
}

async function auditExecutor(guild, type, targetId = null) {
    const entry = await fetchMatchingAuditEntry(guild, type, targetId, [0, 150, 350]).catch(() => null)
    return entry?.executor || null
}

async function onMemberJoin(member) {
    if (!activeCategory(member?.guild, "memberJoin", member?.user?.bot === true)) return
    const created = Math.floor(member.user.createdTimestamp / 1000)
    await sendLogCategory(member.guild, "memberJoin", {
        event: "Member Joined",
        icon: "👋",
        description: displayUser(member.user),
        fields: [
            { name: "ACCOUNT CREATED", value: `<t:${created}:F> • <t:${created}:R>`, inline: false },
            { name: "MEMBER COUNT", value: String(member.guild.memberCount), inline: true },
        ],
        thumbnail: userAvatar(member.user),
        footerMeta: `User ID: ${member.id}`,
        subjectIsBot: member.user.bot,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onMemberLeave(member) {
    if (!activeCategory(member?.guild, "memberLeave", member?.user?.bot === true)) return
    const executor = await auditExecutor(member.guild, AuditLogEvent.MemberKick, member.id)
    const roles = member.roles?.cache
        ? [...member.roles.cache.values()]
            .filter(role => role.id !== member.guild.id)
            .map(role => `<@&${role.id}>`)
        : []
    await sendLogCategory(member.guild, "memberLeave", {
        event: executor ? "Member Removed" : "Member Left",
        icon: executor ? "👢" : "🚪",
        description: displayUser(member.user),
        fields: [
            executor ? { name: "REMOVED BY", value: displayUser(executor), inline: true } : null,
            roles.length ? { name: "ROLES", value: truncate(roles.join(" "), 1000), inline: false } : null,
        ].filter(Boolean),
        thumbnail: userAvatar(member.user),
        footerMeta: `User ID: ${member.id}`,
        subjectIsBot: member.user.bot,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onBanAdd(ban) {
    if (!activeCategory(ban?.guild, "memberBan", ban?.user?.bot === true)) return
    const executor = await auditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id)
    await sendLogCategory(ban.guild, "memberBan", {
        event: "Member Banned",
        icon: "🔨",
        description: displayUser(ban.user),
        fields: [
            executor ? { name: "BANNED BY", value: displayUser(executor), inline: true } : null,
            ban.reason ? { name: "REASON", value: truncate(ban.reason, 1000), inline: false } : null,
        ].filter(Boolean),
        thumbnail: userAvatar(ban.user),
        footerMeta: `User ID: ${ban.user.id}`,
        subjectIsBot: ban.user.bot,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onBanRemove(ban) {
    if (!activeCategory(ban?.guild, "memberUnban", ban?.user?.bot === true)) return
    const executor = await auditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id)
    await sendLogCategory(ban.guild, "memberUnban", {
        event: "Member Unbanned",
        icon: "✅",
        description: displayUser(ban.user),
        fields: executor ? [{ name: "UNBANNED BY", value: displayUser(executor), inline: true }] : [],
        thumbnail: userAvatar(ban.user),
        footerMeta: `User ID: ${ban.user.id}`,
        subjectIsBot: ban.user.bot,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onMemberUpdate(oldMember, newMember) {
    const before = oldMember?.communicationDisabledUntilTimestamp || 0
    const after = newMember?.communicationDisabledUntilTimestamp || 0
    if (before === after) return
    if (!activeCategory(newMember?.guild, "memberTimeout", newMember?.user?.bot === true)) return

    const executor = await auditExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id)
    const active = after > Date.now()
    await sendLogCategory(newMember.guild, "memberTimeout", {
        event: active ? "Member Timed Out" : "Timeout Removed",
        icon: active ? "⏱️" : "✅",
        description: displayUser(newMember.user),
        fields: [
            active ? {
                name: "UNTIL",
                value: `<t:${Math.floor(after / 1000)}:F> • <t:${Math.floor(after / 1000)}:R>`,
                inline: false,
            } : null,
            executor ? { name: "CHANGED BY", value: displayUser(executor), inline: true } : null,
        ].filter(Boolean),
        thumbnail: userAvatar(newMember.user),
        footerMeta: `User ID: ${newMember.id}`,
        subjectIsBot: newMember.user.bot,
        fallbackColor: active ? LOG_COLORS.warning : LOG_COLORS.success,
    })
}

function rolePermissionSummary(role) {
    const permissions = role.permissions?.toArray?.() || []
    return permissions.length ? truncate(permissions.join(", "), 1000) : "No elevated permissions"
}

async function onRoleCreate(role) {
    if (!activeCategory(role?.guild, "roleCreate")) return
    const executor = await auditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id)
    await sendLogCategory(role.guild, "roleCreate", {
        event: "Role Created",
        icon: "➕",
        description: `<@&${role.id}> • **${role.name}**`,
        fields: [
            executor ? { name: "CREATED BY", value: displayUser(executor), inline: true } : null,
            { name: "PERMISSIONS", value: rolePermissionSummary(role), inline: false },
        ].filter(Boolean),
        footerMeta: `Role ID: ${role.id}`,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onRoleDelete(role) {
    if (!activeCategory(role?.guild, "roleDelete")) return
    const executor = await auditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id)
    await sendLogCategory(role.guild, "roleDelete", {
        event: "Role Deleted",
        icon: "🗑️",
        description: `**${role.name}**`,
        fields: executor ? [{ name: "DELETED BY", value: displayUser(executor), inline: true }] : [],
        footerMeta: `Role ID: ${role.id}`,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onRoleUpdate(oldRole, newRole) {
    if (!activeCategory(newRole?.guild, "roleUpdate")) return
    const fields = []
    if (oldRole.name !== newRole.name) {
        fields.push({ name: "NAME", value: `${oldRole.name}\n→ **${newRole.name}**`, inline: false })
    }
    if (oldRole.color !== newRole.color) {
        fields.push({
            name: "COLOR",
            value: `#${oldRole.color.toString(16).padStart(6, "0")} → **#${newRole.color.toString(16).padStart(6, "0")}**`,
            inline: false,
        })
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        fields.push({ name: "PERMISSIONS", value: rolePermissionSummary(newRole), inline: false })
    }
    if (!fields.length) return
    const executor = await auditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id)
    if (executor) fields.unshift({ name: "UPDATED BY", value: displayUser(executor), inline: true })
    await sendLogCategory(newRole.guild, "roleUpdate", {
        event: "Role Updated",
        icon: "🛠️",
        description: `<@&${newRole.id}> • **${newRole.name}**`,
        fields,
        footerMeta: `Role ID: ${newRole.id}`,
        fallbackColor: LOG_COLORS.warning,
    })
}

function channelLabel(channel) {
    return channel?.id
        ? `<#${channel.id}> • **${channel.name || "Unknown channel"}**`
        : "Unknown channel"
}

async function onChannelCreate(channel) {
    if (!channel?.guild || !activeCategory(channel.guild, "channelCreate")) return
    const executor = await auditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id)
    await sendLogCategory(channel.guild, "channelCreate", {
        event: "Channel Created",
        icon: "➕",
        description: channelLabel(channel),
        fields: [
            { name: "TYPE", value: String(channel.type), inline: true },
            executor ? { name: "CREATED BY", value: displayUser(executor), inline: true } : null,
        ].filter(Boolean),
        footerMeta: `Channel ID: ${channel.id}`,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onChannelDelete(channel) {
    if (!channel?.guild || !activeCategory(channel.guild, "channelDelete")) return
    const executor = await auditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id)
    await sendLogCategory(channel.guild, "channelDelete", {
        event: "Channel Deleted",
        icon: "🗑️",
        description: `**${channel.name || "Unknown channel"}**`,
        fields: [
            { name: "TYPE", value: String(channel.type), inline: true },
            executor ? { name: "DELETED BY", value: displayUser(executor), inline: true } : null,
        ].filter(Boolean),
        footerMeta: `Channel ID: ${channel.id}`,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onChannelUpdate(oldChannel, newChannel) {
    if (!newChannel?.guild || !activeCategory(newChannel.guild, "channelUpdate")) return
    const fields = []
    if (oldChannel.name !== newChannel.name) {
        fields.push({ name: "NAME", value: `${oldChannel.name}\n→ **${newChannel.name}**`, inline: false })
    }
    if (oldChannel.parentId !== newChannel.parentId) {
        fields.push({
            name: "CATEGORY",
            value: `${oldChannel.parentId ? `<#${oldChannel.parentId}>` : "None"} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : "None"}`,
            inline: false,
        })
    }
    if ("topic" in oldChannel && oldChannel.topic !== newChannel.topic) {
        fields.push({ name: "TOPIC", value: truncate(newChannel.topic || "Removed", 1000), inline: false })
    }
    if ("rateLimitPerUser" in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        fields.push({
            name: "SLOWMODE",
            value: `${oldChannel.rateLimitPerUser || 0}s → **${newChannel.rateLimitPerUser || 0}s**`,
            inline: true,
        })
    }
    if (!fields.length) return
    const executor = await auditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id)
    if (executor) fields.unshift({ name: "UPDATED BY", value: displayUser(executor), inline: true })
    await sendLogCategory(newChannel.guild, "channelUpdate", {
        event: "Channel Updated",
        icon: "🛠️",
        description: channelLabel(newChannel),
        fields,
        footerMeta: `Channel ID: ${newChannel.id}`,
        fallbackColor: LOG_COLORS.info,
    })
}

async function onVoiceState(oldState, newState) {
    const guild = newState.guild || oldState.guild
    const member = newState.member || oldState.member
    if (!guild || !member) return
    const isBot = member.user?.bot === true

    if (!oldState.channelId && newState.channelId && activeCategory(guild, "voiceJoin", isBot)) {
        await sendLogCategory(guild, "voiceJoin", {
            event: "Voice Channel Joined",
            icon: "🔊",
            description: `${displayUser(member.user)} → <#${newState.channelId}>`,
            thumbnail: userAvatar(member.user),
            footerMeta: `User ID: ${member.id}`,
            subjectIsBot: isBot,
        })
    } else if (oldState.channelId && !newState.channelId && activeCategory(guild, "voiceLeave", isBot)) {
        await sendLogCategory(guild, "voiceLeave", {
            event: "Voice Channel Left",
            icon: "🔇",
            description: `${displayUser(member.user)} • <#${oldState.channelId}>`,
            thumbnail: userAvatar(member.user),
            footerMeta: `User ID: ${member.id}`,
            subjectIsBot: isBot,
        })
    } else if (
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId &&
        activeCategory(guild, "voiceSwitch", isBot)
    ) {
        await sendLogCategory(guild, "voiceSwitch", {
            event: "Voice Channel Switched",
            icon: "🔀",
            description: displayUser(member.user),
            fields: [
                { name: "FROM", value: `<#${oldState.channelId}>`, inline: true },
                { name: "TO", value: `<#${newState.channelId}>`, inline: true },
            ],
            thumbnail: userAvatar(member.user),
            footerMeta: `User ID: ${member.id}`,
            subjectIsBot: isBot,
        })
    }

    if (!activeCategory(guild, "voiceState", isBot)) return
    const changes = []
    if (oldState.selfMute !== newState.selfMute) changes.push(newState.selfMute ? "Self Muted" : "Self Unmuted")
    if (oldState.selfDeaf !== newState.selfDeaf) changes.push(newState.selfDeaf ? "Self Deafened" : "Self Undeafened")
    if (oldState.serverMute !== newState.serverMute) changes.push(newState.serverMute ? "Server Muted" : "Server Unmuted")
    if (oldState.serverDeaf !== newState.serverDeaf) changes.push(newState.serverDeaf ? "Server Deafened" : "Server Undeafened")
    if (!changes.length) return

    await sendLogCategory(guild, "voiceState", {
        event: changes.join(" / "),
        icon: "🎙️",
        description: `${displayUser(member.user)}${newState.channelId ? ` • <#${newState.channelId}>` : ""}`,
        thumbnail: userAvatar(member.user),
        footerMeta: `User ID: ${member.id}`,
        subjectIsBot: isBot,
    })
}

async function onGuildUpdate(oldGuild, newGuild) {
    if (!activeCategory(newGuild, "guildUpdate")) return
    const fields = []
    if (oldGuild.name !== newGuild.name) {
        fields.push({ name: "NAME", value: `${oldGuild.name}\n→ **${newGuild.name}**`, inline: false })
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        fields.push({
            name: "VERIFICATION",
            value: `${oldGuild.verificationLevel} → **${newGuild.verificationLevel}**`,
            inline: true,
        })
    }
    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        fields.push({ name: "AFK TIMEOUT", value: `${oldGuild.afkTimeout}s → **${newGuild.afkTimeout}s**`, inline: true })
    }
    if (!fields.length) return
    const executor = await auditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id)
    if (executor) fields.unshift({ name: "UPDATED BY", value: displayUser(executor), inline: true })
    await sendLogCategory(newGuild, "guildUpdate", {
        event: "Server Updated",
        icon: "🏠",
        description: `**${newGuild.name}**`,
        fields,
        footerMeta: `Server ID: ${newGuild.id}`,
        fallbackColor: LOG_COLORS.info,
    })
}

async function onInviteCreate(invite) {
    if (!invite?.guild || !activeCategory(invite.guild, "inviteCreate", invite.inviter?.bot === true)) return
    await sendLogCategory(invite.guild, "inviteCreate", {
        event: "Invite Created",
        icon: "📨",
        description: invite.channelId ? `<#${invite.channelId}>` : "Unknown channel",
        fields: [
            { name: "CODE", value: `\`${invite.code}\``, inline: true },
            { name: "CREATED BY", value: invite.inviter ? displayUser(invite.inviter) : "Unknown", inline: true },
            { name: "MAX USES", value: invite.maxUses ? String(invite.maxUses) : "Unlimited", inline: true },
            { name: "EXPIRES", value: invite.maxAge ? `<t:${Math.floor(Date.now() / 1000) + invite.maxAge}:R>` : "Never", inline: true },
        ],
        footerMeta: `Invite code: ${invite.code}`,
        subjectIsBot: invite.inviter?.bot === true,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onInviteDelete(invite) {
    if (!invite?.guild || !activeCategory(invite.guild, "inviteDelete")) return
    await sendLogCategory(invite.guild, "inviteDelete", {
        event: "Invite Deleted",
        icon: "🗑️",
        description: invite.channelId ? `<#${invite.channelId}>` : "Unknown channel",
        fields: [{ name: "CODE", value: `\`${invite.code}\``, inline: true }],
        footerMeta: `Invite code: ${invite.code}`,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onEmojiCreate(emoji) {
    if (!activeCategory(emoji?.guild, "emojiUpdate")) return
    await sendLogCategory(emoji.guild, "emojiUpdate", {
        event: "Emoji Added",
        icon: "😀",
        description: `${emoji} • **:${emoji.name}:**`,
        footerMeta: `Emoji ID: ${emoji.id}`,
        fallbackColor: LOG_COLORS.success,
    })
}

async function onEmojiDelete(emoji) {
    if (!activeCategory(emoji?.guild, "emojiUpdate")) return
    await sendLogCategory(emoji.guild, "emojiUpdate", {
        event: "Emoji Removed",
        icon: "🗑️",
        description: `**:${emoji.name}:**`,
        footerMeta: `Emoji ID: ${emoji.id}`,
        fallbackColor: LOG_COLORS.danger,
    })
}

async function onEmojiUpdate(oldEmoji, newEmoji) {
    if (!activeCategory(newEmoji?.guild, "emojiUpdate")) return
    if (oldEmoji.name === newEmoji.name) return
    await sendLogCategory(newEmoji.guild, "emojiUpdate", {
        event: "Emoji Renamed",
        icon: "😀",
        description: `${newEmoji}`,
        fields: [{ name: "NAME", value: `${oldEmoji.name} → **${newEmoji.name}**`, inline: false }],
        footerMeta: `Emoji ID: ${newEmoji.id}`,
        fallbackColor: LOG_COLORS.info,
    })
}

function safeListener(name, fn) {
    return (...args) => Promise.resolve(fn(...args)).catch(err => log.error(`${name}: ${err.message}`))
}

function attachLoggingCenter(client) {
    if (attached) return
    attached = true
    client.on(Events.GuildMemberAdd, safeListener("member-join", onMemberJoin))
    client.on(Events.GuildMemberRemove, safeListener("member-leave", onMemberLeave))
    client.on(Events.GuildBanAdd, safeListener("member-ban", onBanAdd))
    client.on(Events.GuildBanRemove, safeListener("member-unban", onBanRemove))
    client.on(Events.GuildMemberUpdate, safeListener("member-timeout", onMemberUpdate))
    client.on(Events.GuildRoleCreate, safeListener("role-create", onRoleCreate))
    client.on(Events.GuildRoleDelete, safeListener("role-delete", onRoleDelete))
    client.on(Events.GuildRoleUpdate, safeListener("role-update", onRoleUpdate))
    client.on(Events.ChannelCreate, safeListener("channel-create", onChannelCreate))
    client.on(Events.ChannelDelete, safeListener("channel-delete", onChannelDelete))
    client.on(Events.ChannelUpdate, safeListener("channel-update", onChannelUpdate))
    client.on(Events.VoiceStateUpdate, safeListener("voice-state", onVoiceState))
    client.on(Events.GuildUpdate, safeListener("guild-update", onGuildUpdate))
    client.on(Events.InviteCreate, safeListener("invite-create", onInviteCreate))
    client.on(Events.InviteDelete, safeListener("invite-delete", onInviteDelete))
    client.on(Events.GuildEmojiCreate, safeListener("emoji-create", onEmojiCreate))
    client.on(Events.GuildEmojiDelete, safeListener("emoji-delete", onEmojiDelete))
    client.on(Events.GuildEmojiUpdate, safeListener("emoji-update", onEmojiUpdate))
}

module.exports = {
    attachLoggingCenter,
    sendLogCategory,
    plainLogText,
    activeCategory,
}
