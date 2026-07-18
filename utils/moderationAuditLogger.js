const { EmbedBuilder, Events } = require("discord.js")
const { getPhase2Config, getWhitelistMatch } = require("./moderationPhase2Config")
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
    if (!config.logging.messageDeleteEnabled) return
    const whitelist = getWhitelistMatch({
        guildId: message.guild.id,
        member: message.member,
        userId: message.author?.id,
        channelId: message.channelId,
        isBot: message.author?.bot,
    })
    if (whitelist && config.whitelist.exemptFromAutomod) return

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("🗑️ Message Deleted")
        .addFields(
            { name: "Author", value: message.author ? `${message.author.tag} (${message.author.id})` : "Unknown", inline: true },
            { name: "Channel", value: `<#${message.channelId}>`, inline: true },
            { name: "Message ID", value: message.id, inline: true },
        )
        .setTimestamp()

    if (config.logging.storeDeletedMessageContent && message.content) {
        embed.addFields({ name: "Content", value: truncate(message.content, 1000), inline: false })
    } else {
        embed.addFields({ name: "Content", value: "Content storage is disabled.", inline: false })
    }
    if (message.attachments?.size) {
        embed.addFields({
            name: "Attachments",
            value: truncate([...message.attachments.values()].map(item => item.url).join("\n"), 1000),
            inline: false,
        })
    }
    await sendConfiguredLog(message.guild, config.logging.messageLogChannelId, embed)
}

async function onMessageUpdate(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return
    const before = oldMessage.content || ""
    const after = newMessage.content || ""
    if (!before || before === after) return

    const config = getPhase2Config(newMessage.guild.id)
    if (!config.logging.messageEditEnabled) return
    const whitelist = getWhitelistMatch({
        guildId: newMessage.guild.id,
        member: newMessage.member,
        userId: newMessage.author?.id,
        channelId: newMessage.channelId,
        isBot: newMessage.author?.bot,
    })
    if (whitelist && config.whitelist.exemptFromAutomod) return

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle("✏️ Message Edited")
        .addFields(
            { name: "Author", value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: true },
            { name: "Channel", value: `<#${newMessage.channelId}>`, inline: true },
            { name: "Jump", value: `[Open message](${newMessage.url})`, inline: true },
            { name: "Before", value: truncate(before, 1000), inline: false },
            { name: "After", value: truncate(after, 1000), inline: false },
        )
        .setTimestamp()
    await sendConfiguredLog(newMessage.guild, config.logging.messageLogChannelId, embed)
}

async function onGuildMemberUpdate(oldMember, newMember) {
    const config = getPhase2Config(newMember.guild.id)
    if (!config.logging.memberUpdateEnabled) return

    const changes = []
    if (oldMember.nickname !== newMember.nickname) {
        changes.push(`Nickname: **${oldMember.nickname || oldMember.user.username}** → **${newMember.nickname || newMember.user.username}**`)
    }
    const oldRoles = new Set(oldMember.roles.cache.keys())
    const newRoles = new Set(newMember.roles.cache.keys())
    const added = [...newRoles].filter(id => !oldRoles.has(id) && id !== newMember.guild.id)
    const removed = [...oldRoles].filter(id => !newRoles.has(id) && id !== newMember.guild.id)
    if (added.length) changes.push(`Roles added: ${added.map(id => `<@&${id}>`).join(", ")}`)
    if (removed.length) changes.push(`Roles removed: ${removed.map(id => `<@&${id}>`).join(", ")}`)
    if (!changes.length) return

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("👤 Member Updated")
        .setDescription(truncate(changes.join("\n"), 3500))
        .addFields({ name: "Member", value: `${newMember.user.tag} (${newMember.id})` })
        .setTimestamp()
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
