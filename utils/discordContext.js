/**
 * utils/discordContext.js
 * Safe Discord context system for CURSED AI.
 * Builds real server/member data to inject into the system prompt.
 * NEVER exposes raw Discord IDs or private information.
 */

const logger = require("./logger")
const log = logger.child("DiscordContext")

const CONTEXT_KEYWORDS = [
    "who am i", "about me", "my roles", "my info", "what do you know about me",
    "my account", "my profile", "how long have i", "how many messages have i",
    "how many commands", "my activity", "when did i join", "when was i", "my stats",
    "tell me about", "info about", "who is", "what roles does", "when did",
    "how long has", "about @", "about him", "about her", "about them",
    "server stats", "server info", "server statistics", "how many members",
    "how many channels", "how many roles", "about this server", "about the server",
    "this server", "server details", "channel names", "role names", "what channels",
    "what roles", "bot permissions", "your permissions", "missing permissions",
    "can you send embeds", "can you attach files", "can you manage messages",
    "who created you", "who made you", "who built you", "your creator", "your owner",
    "who is your creator", "who is your owner", "who are you", "about yourself",
    "your background", "can you ban", "can you kick", "can you mute", "can you moderate",
    "are you a mod", "are you admin",
]

function safeLabel(value, fallback = "unknown") {
    const text = String(value || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/<@!?\d{17,20}>|<@&\d{17,20}>|<#\d{17,20}>/g, "[mention]")
        .trim()
    return (text || fallback).slice(0, 100)
}

function needsDiscordContext(text) {
    const lower = String(text || "").toLowerCase()
    if (CONTEXT_KEYWORDS.some(keyword => lower.includes(keyword))) return true
    if (/<@!?\d{17,20}>/.test(text)) return true
    if (/\b\d{17,20}\b/.test(text)) return true
    return false
}

function formatDate(date) {
    if (!date) return "unknown"
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
    })
}

function getMemberType(member) {
    if (!member) return "Unknown"
    if (member.user?.bot) return "Bot"
    if (member.guild?.ownerId === member.id) return "Server Owner"
    const perms = member.permissions
    if (!perms) return "Member"
    if (perms.has("Administrator")) return "Administrator"
    if (perms.has("ModerateMembers") || perms.has("BanMembers") || perms.has("KickMembers")) {
        return "Moderator"
    }
    return "Member"
}

function buildMemberContext(member, activity) {
    const lines = []
    lines.push(`Display name: ${safeLabel(member.displayName)}`)
    lines.push(`Username: ${safeLabel(member.user?.username)}`)
    lines.push(`Account created: ${formatDate(member.user?.createdAt)}`)
    lines.push(`Joined server: ${formatDate(member.joinedAt)}`)
    lines.push(`Type: ${getMemberType(member)}`)

    const roles = member.roles?.cache
        ?.filter(role => role.name !== "@everyone")
        ?.sort((a, b) => b.position - a.position)
        ?.map(role => safeLabel(role.name))
        ?.slice(0, 10) || []
    lines.push(roles.length ? `Roles: ${roles.join(", ")}` : "Roles: none")

    if (activity) {
        const voiceHours = ((activity.voiceSeconds || 0) / 3600).toFixed(1)
        lines.push(`Messages sent (tracked): ${activity.messageCount || 0}`)
        lines.push(`Commands used (tracked): ${activity.commandCount || 0}`)
        lines.push(`Voice channel time (tracked): ${voiceHours}h`)
        if (activity.firstSeenAt) lines.push(`First seen: ${formatDate(activity.firstSeenAt)}`)
        if (activity.lastMessageAt) lines.push(`Last message: ${formatDate(activity.lastMessageAt)}`)
    } else {
        lines.push("Activity stats: not yet tracked (stats collected only from when tracking was enabled)")
    }

    return lines.join("\n")
}

function buildServerContext(guild) {
    const { ChannelType } = require("discord.js")
    const textChannels = guild.channels.cache
        .filter(channel => channel.type === ChannelType.GuildText)
        .sort((a, b) => a.position - b.position)
    const voiceChannels = guild.channels.cache
        .filter(channel => channel.type === ChannelType.GuildVoice)
        .sort((a, b) => a.position - b.position)
    const roleNames = guild.roles.cache
        .filter(role => role.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map(role => safeLabel(role.name))
        .slice(0, 15)
    const textNames = textChannels.map(channel => `#${safeLabel(channel.name)}`).slice(0, 15)
    const voiceNames = voiceChannels.map(channel => safeLabel(channel.name)).slice(0, 10)

    const lines = []
    lines.push(`Server name: ${safeLabel(guild.name)}`)
    lines.push(`Member count: ${guild.memberCount}`)
    lines.push(`Text channels: ${textChannels.size}`)
    lines.push(`Voice channels: ${voiceChannels.size}`)
    lines.push(`Roles: ${Math.max(0, guild.roles.cache.size - 1)}`)
    lines.push(`Server created: ${formatDate(guild.createdAt)}`)
    lines.push(textNames.length ? `Visible text channel names: ${textNames.join(", ")}` : "Visible text channel names: none cached")
    lines.push(voiceNames.length ? `Visible voice channel names: ${voiceNames.join(", ")}` : "Visible voice channel names: none cached")
    lines.push(roleNames.length ? `Visible role names: ${roleNames.join(", ")}` : "Visible role names: none cached")
    return lines.join("\n")
}

function buildBotPermissionContext(message) {
    const botMember = message.guild?.members?.me
    const permissions = message.channel?.permissionsFor?.(botMember)
    if (!botMember || !permissions) return "Bot permissions in this channel: unavailable"

    const checks = [
        ["ViewChannel", "view channel"],
        ["SendMessages", "send messages"],
        ["EmbedLinks", "embed links"],
        ["AttachFiles", "attach files"],
        ["ReadMessageHistory", "read message history"],
        ["ManageMessages", "manage messages"],
        ["ModerateMembers", "moderate members"],
        ["KickMembers", "kick members"],
        ["BanMembers", "ban members"],
    ]
    const allowed = []
    const missing = []
    for (const [permission, label] of checks) {
        if (permissions.has(permission)) allowed.push(label)
        else missing.push(label)
    }

    return [
        `Bot permissions available in this channel: ${allowed.join(", ") || "none verified"}`,
        `Bot permissions missing in this channel: ${missing.join(", ") || "none from checked set"}`,
    ].join("\n")
}

function buildDiscordContext({ message, selfActivity = null, mentionedActivity = null }) {
    try {
        const parts = []
        parts.push(`Current channel: #${safeLabel(message.channel?.name)}`)
        parts.push(buildBotPermissionContext(message))

        if (message.member) {
            parts.push("\n[ABOUT THE USER YOU ARE TALKING TO]")
            parts.push(buildMemberContext(message.member, selfActivity))
        }

        const mentioned = message.mentions.members?.first()
        if (mentioned && mentioned.id !== message.author.id) {
            parts.push("\n[ABOUT THE MENTIONED USER]")
            parts.push(buildMemberContext(mentioned, mentionedActivity))
        }

        if (message.guild) {
            parts.push("\n[ABOUT THIS SERVER]")
            parts.push(buildServerContext(message.guild))
        }

        const creatorName = process.env.BOT_CREATOR_NAME
        if (creatorName) {
            parts.push(`\n[CREATOR INFO]\nCURSED was created by: ${safeLabel(creatorName)}`)
            parts.push("Never reveal the creator's Discord ID or any private details about the creator.")
        } else {
            parts.push("\n[CREATOR INFO]\nNo verified creator information is configured. If asked, say you do not have verified creator information.")
        }

        parts.push("\n[MODERATION]\nCURSED can moderate via verified slash or prefix commands only. Never claim to have performed a moderation action through this AI chat. If asked to ban, kick, mute, or change the server through chat, redirect to verified commands.")
        parts.push("\n[TRUTH BOUNDARY]\nOnly facts written in this block are verified for this server. Cached lists may be incomplete. Never invent missing roles, channels, permissions, IDs, or activity.")

        return `\n\n[REAL DISCORD CONTEXT — verified live context; never invent numbers or IDs]\n${parts.join("\n")}`
    } catch (err) {
        log.error(`buildDiscordContext failed: ${err.message}`, { stack: err.stack })
        return ""
    }
}

module.exports = {
    needsDiscordContext,
    buildDiscordContext,
    buildMemberContext,
    buildServerContext,
    buildBotPermissionContext,
}
