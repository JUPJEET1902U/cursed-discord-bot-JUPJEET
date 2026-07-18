/**
 * Auto-moderation filters: anti-link, anti-invite, anti-spam.
 *
 * Call `runAutoMod(message)` from the MessageCreate handler.
 * Returns true if the message was actioned (deleted / user muted) so the
 * caller can skip further processing.
 */

const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")
const { getPhase2Config, getWhitelistMatch } = require("./moderationPhase2Config")
const { logAction } = require("./modlog")
const { recordMessage, markMuted, isMuted, MUTE_DURATION_MS } = require("./antiSpam")
const { handleLevelingMessage } = require("./leveling")
const premiumCmd = require("../commands/premium")

const LINK_REGEX = /https?:\/\/\S+|www\.\S+\.\S+/gi
const INVITE_REGEX = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]{2,32}/gi

const CHANNEL_CONTROL_COMMANDS = new Set([
    "!addchannel",
    "!removechannel",
    "!channels",
    "!allchannels",
])

function queueLeveling(message) {
    handleLevelingMessage(message).catch(err => {
        console.error("Leveling message processing error:", err.message)
    })
}

function canManageMessages(guild) {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false
}

async function safeDelete(message) {
    try { await message.delete() } catch { /* ignore */ }
}

async function runAutoMod(message) {
    if (message.author.bot) return false
    if (!message.guild) return false

    const normalizedContent = message.content.toLowerCase().trim()
    if (CHANNEL_CONTROL_COMMANDS.has(normalizedContent)) {
        return premiumCmd.handle(message)
    }

    const { guild, member, author, content } = message
    const guildId = guild.id
    const userId = author.id

    if (member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        queueLeveling(message)
        return false
    }

    const phase2 = getPhase2Config(guildId)
    const whitelistMatch = getWhitelistMatch({
        guildId,
        member,
        userId,
        channelId: message.channel.id,
        isBot: author.bot,
    })
    if (whitelistMatch && phase2.whitelist.exemptFromAutomod) {
        queueLeveling(message)
        return false
    }

    const { config } = getServerConfig(guildId)
    const target = { id: author.id, tag: author.tag }

    if (config.antiInvite) {
        INVITE_REGEX.lastIndex = 0
        if (INVITE_REGEX.test(content)) {
            if (canManageMessages(guild)) await safeDelete(message)
            try {
                await author.send(
                    `🚫 **Invite links are not allowed** in **${guild.name}**. Your message was removed.`
                ).catch(() => {})
            } catch { /* DMs disabled */ }

            await logAction(guild, {
                action: "ANTI_INVITE",
                target,
                reason: "Posted a Discord invite link",
                extra: `Channel: <#${message.channel.id}>\nContent: \`${content.slice(0, 200)}\``,
                metadata: { channelId: message.channel.id, messageId: message.id },
            })
            return true
        }
    }

    if (config.antiLink) {
        const whitelist = config.linkWhitelist || []
        LINK_REGEX.lastIndex = 0
        const matches = content.match(LINK_REGEX) || []

        const blockedLinks = matches.filter(link => {
            try {
                const url = link.startsWith("http") ? link : `https://${link}`
                const hostname = new URL(url).hostname.replace(/^www\./, "")
                return !whitelist.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`))
            } catch {
                return true
            }
        })

        if (blockedLinks.length > 0) {
            if (canManageMessages(guild)) await safeDelete(message)
            try {
                await author.send(
                    `🔗 **Links are not allowed** in **${guild.name}**. Your message was removed.`
                ).catch(() => {})
            } catch { /* DMs disabled */ }

            await logAction(guild, {
                action: "ANTI_LINK",
                target,
                reason: "Posted a link",
                extra: `Channel: <#${message.channel.id}>\nLinks: ${blockedLinks.slice(0, 3).join(", ")}`,
                metadata: { channelId: message.channel.id, messageId: message.id, blockedLinks: blockedLinks.slice(0, 10) },
            })
            return true
        }
    }

    if (config.antiSpam) {
        if (isMuted(guildId, userId)) {
            if (canManageMessages(guild)) await safeDelete(message)
            return true
        }

        const { spam } = recordMessage(guildId, userId)
        if (spam) {
            const muteDurationSec = MUTE_DURATION_MS / 1000
            if (canManageMessages(guild)) await safeDelete(message)

            const canTimeout = guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false
            if (canTimeout && member) {
                try {
                    await member.timeout(MUTE_DURATION_MS, "Anti-spam: rapid message flood")
                } catch (err) {
                    console.error("Anti-spam timeout error:", err.message)
                }
            }

            markMuted(guildId, userId, async () => {
                await logAction(guild, {
                    action: "UNMUTE",
                    target,
                    reason: `Anti-spam timeout expired (${muteDurationSec}s)`,
                    source: "system",
                })
            })

            try {
                await message.channel.send(
                    `🚫 <@${userId}> has been muted for **${muteDurationSec} seconds** for spamming.`
                ).catch(() => {})
            } catch { /* ignore */ }

            await logAction(guild, {
                action: "ANTI_SPAM",
                target,
                reason: "Rapid message spam detected",
                extra: `Muted for **${muteDurationSec} seconds**`,
                durationMs: MUTE_DURATION_MS,
                metadata: { channelId: message.channel.id, messageId: message.id },
            })
            return true
        }
    }

    queueLeveling(message)
    return false
}

module.exports = { runAutoMod }
