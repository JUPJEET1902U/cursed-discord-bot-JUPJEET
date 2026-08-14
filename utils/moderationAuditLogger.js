const { Events } = require("discord.js")
const { getPhase2Config, getWhitelistMatch } = require("./moderationPhase2Config")
const { getLogCategory, guildHasExplicitLogsConfig } = require("./loggingConfig")
const { sendLogCategory } = require("./loggingCenter")
const {
    LOG_COLORS,
    buildLogEmbed,
    quoteBlock,
    userAvatar,
} = require("./logPresentation")
const logger = require("./logger")

const log = logger.child("ModerationAudit")

function truncate(value, max = 1000) {
    const text = String(value || "")
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function sendConfiguredLog(guild, channelId, embed) {
    if (!channelId) return false
    const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null)
    if (!channel?.isTextBased?.()) return false
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(err => {
        log.warn(`Audit log send failed in ${guild.id}: ${err.message}`)
    })
    return true
}

async function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return
    const config = getPhase2Config(message.guild.id)
    const unified = guildHasExplicitLogsConfig(message.guild.id)
    if (!unified && !config.logging.messageDeleteEnabled) return

    const whitelist = getWhitelistMatch({
        guildId: message.guild.id,
        member: message.member,
        userId: message.author?.id,
        channelId: message.channelId,
        isBot: message.author?.bot,
    })
    if (whitelist && config.whitelist.exemptFromAutomod) return

    const includeContent = unified
        ? getLogCategory(message.guild.id, "messageDelete")?.includeContent === true
        : config.logging.storeDeletedMessageContent === true
    const authorId = message.author?.id || null
    const authorDisplay = authorId ? `<@${authorId}>` : "**Unknown author**"
    const fields = [{
        name: "MESSAGE CONTENT",
        value: includeContent && message.content
            ? quoteBlock(message.content)
            : "*Content storage is disabled for this server.*",
        inline: false,
    }]

    if (message.attachments?.size) {
        fields.push({
            name: "ATTACHMENTS",
            value: truncate([...message.attachments.values()].map(item => item.url).join("\n"), 1000),
            inline: false,
        })
    }

    const footerMeta = [
        authorId ? `User ID: ${authorId}` : null,
        `Message ID: ${message.id}`,
    ].filter(Boolean).join(" • ")

    if (unified) {
        await sendLogCategory(message.guild, "messageDelete", {
            event: "Message Deleted",
            icon: "🗑️",
            description: `${authorDisplay} • <#${message.channelId}>`,
            fields,
            thumbnail: userAvatar(message.author),
            footerMeta,
            subjectIsBot: message.author?.bot === true,
            fallbackColor: LOG_COLORS.danger,
        })
        return
    }

    const embed = buildLogEmbed({
        guild: message.guild,
        category: "Message",
        event: "Message Deleted",
        icon: "🗑️",
        color: LOG_COLORS.danger,
        description: `${authorDisplay} • <#${message.channelId}>`,
        fields,
        thumbnail: userAvatar(message.author),
        footerMeta,
    })

    await sendConfiguredLog(message.guild, config.logging.messageLogChannelId, embed)
}

async function onMessageUpdate(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return
    const before = oldMessage.content || ""
    const after = newMessage.content || ""
    if (!before || before === after) return

    const config = getPhase2Config(newMessage.guild.id)
    const unified = guildHasExplicitLogsConfig(newMessage.guild.id)
    if (!unified && !config.logging.messageEditEnabled) return

    const whitelist = getWhitelistMatch({
        guildId: newMessage.guild.id,
        member: newMessage.member,
        userId: newMessage.author?.id,
        channelId: newMessage.channelId,
        isBot: newMessage.author?.bot,
    })
    if (whitelist && config.whitelist.exemptFromAutomod) return

    const description = `<@${newMessage.author.id}> edited a message in <#${newMessage.channelId}> • [Open message](${newMessage.url})`
    const fields = [
        { name: "BEFORE", value: quoteBlock(before), inline: false },
        { name: "AFTER", value: quoteBlock(after), inline: false },
    ]
    const footerMeta = `User ID: ${newMessage.author.id} • Message ID: ${newMessage.id}`

    if (unified) {
        await sendLogCategory(newMessage.guild, "messageEdit", {
            event: "Message Edited",
            icon: "✏️",
            description,
            fields,
            thumbnail: userAvatar(newMessage.author),
            footerMeta,
            subjectIsBot: newMessage.author?.bot === true,
            fallbackColor: LOG_COLORS.warning,
        })
        return
    }

    const embed = buildLogEmbed({
        guild: newMessage.guild,
        category: "Message",
        event: "Message Edited",
        icon: "✏️",
        color: LOG_COLORS.warning,
        description,
        fields,
        thumbnail: userAvatar(newMessage.author),
        footerMeta,
    })

    await sendConfiguredLog(newMessage.guild, config.logging.messageLogChannelId, embed)
}

async function onGuildMemberUpdate(oldMember, newMember) {
    const config = getPhase2Config(newMember.guild.id)
    const unified = guildHasExplicitLogsConfig(newMember.guild.id)
    if (!unified && !config.logging.memberUpdateEnabled) return

    const fields = []
    if (oldMember.nickname !== newMember.nickname) {
        fields.push({
            name: "NICKNAME CHANGED",
            value: `${oldMember.nickname || oldMember.user.username}\n**→ ${newMember.nickname || newMember.user.username}**`,
            inline: false,
        })
    }

    const oldRoles = new Set(oldMember.roles.cache.keys())
    const newRoles = new Set(newMember.roles.cache.keys())
    const added = [...newRoles].filter(id => !oldRoles.has(id) && id !== newMember.guild.id)
    const removed = [...oldRoles].filter(id => !newRoles.has(id) && id !== newMember.guild.id)

    if (added.length) {
        fields.push({
            name: "ROLES ADDED",
            value: truncate(added.map(id => `+ <@&${id}>`).join("\n"), 1024),
            inline: false,
        })
    }
    if (removed.length) {
        fields.push({
            name: "ROLES REMOVED",
            value: truncate(removed.map(id => `− <@&${id}>`).join("\n"), 1024),
            inline: false,
        })
    }
    if (!fields.length) return

    if (unified) {
        await sendLogCategory(newMember.guild, "memberNicknameChange", {
            event: "Member Updated",
            icon: "👤",
            description: `<@${newMember.id}>`,
            fields,
            thumbnail: userAvatar(newMember),
            footerMeta: `User ID: ${newMember.id}`,
            subjectIsBot: newMember.user?.bot === true,
            fallbackColor: LOG_COLORS.info,
        })
        return
    }

    const embed = buildLogEmbed({
        guild: newMember.guild,
        category: "Member",
        event: "Member Updated",
        icon: "👤",
        color: LOG_COLORS.info,
        description: `<@${newMember.id}>`,
        fields,
        thumbnail: userAvatar(newMember),
        footerMeta: `User ID: ${newMember.id}`,
    })

    await sendConfiguredLog(newMember.guild, config.logging.memberLogChannelId, embed)
}

let attached = false

function attachModerationAuditLogging(client) {
    if (attached) return
    attached = true
    client.on(Events.MessageDelete, message => onMessageDelete(message).catch(err => log.error(err.message)))
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => onMessageUpdate(oldMessage, newMessage).catch(err => log.error(err.message)))
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => onGuildMemberUpdate(oldMember, newMember).catch(err => log.error(err.message)))
}

module.exports = { attachModerationAuditLogging }
