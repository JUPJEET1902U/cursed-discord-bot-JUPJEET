/**
 * Auto-moderation pipeline: priority moderation, Message Shield, anti-invite,
 * anti-link and legacy anti-spam fallback.
 *
 * Reboot rule: one message should not be punished twice by overlapping spam
 * engines. When Message Shield is enabled it owns rapid/repeated spam handling;
 * the legacy anti-spam switch remains available as a fallback for servers that
 * have not enabled Message Shield.
 */

const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")
const { getPhase2Config, getWhitelistMatch } = require("./moderationPhase2Config")
const { getSecurityPhase3Config } = require("./securityPhase3Config")
const { logAction } = require("./modlog")
const { recordMessage, markMuted, isMuted, MUTE_DURATION_MS } = require("./antiSpam")
const { handleLevelingMessage } = require("./leveling")
const { runSecurityMessageShield } = require("./securityMessageShield")
const { handlePriorityModerationCommand } = require("./priorityModerationCommands")
const { statusLine } = require("./responseBuilder")
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
    handleLevelingMessage(message).catch(error => {
        console.error("Leveling message processing error:", error.message)
    })
}

function canManageMessages(guild) {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false
}

async function safeDelete(message) {
    try {
        await message.delete()
        return true
    } catch {
        return false
    }
}

async function safeDm(user, content) {
    try {
        await user.send(content)
        return true
    } catch {
        return false
    }
}

async function runAutoMod(message) {
    if (!message.guild) return false

    const priorityModerationHandled = await handlePriorityModerationCommand(message).catch(error => {
        console.error("Priority moderation command error:", error.message)
        return false
    })
    if (priorityModerationHandled) return true

    const securityConfig = getSecurityPhase3Config(message.guild.id)
    const messageShieldEnabled = securityConfig.enabled && securityConfig.messageShield.enabled
    const securityActioned = await runSecurityMessageShield(message).catch(error => {
        console.error("Security Message Shield error:", error.message)
        return false
    })
    if (securityActioned) return true
    if (message.author.bot) return false

    const normalizedContent = message.content.toLowerCase().trim()
    if (CHANNEL_CONTROL_COMMANDS.has(normalizedContent)) return premiumCmd.handle(message)

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
            await safeDm(author, `Your message in **${guild.name}** was removed because Discord invite links are not allowed.`)
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
        const whitelist = Array.isArray(config.linkWhitelist) ? config.linkWhitelist : []
        LINK_REGEX.lastIndex = 0
        const matches = content.match(LINK_REGEX) || []
        const blockedLinks = matches.filter(link => {
            try {
                const url = link.startsWith("http") ? link : `https://${link}`
                const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
                return !whitelist.some(allowedValue => {
                    const allowed = String(allowedValue || "").toLowerCase().replace(/^www\./, "").trim()
                    return allowed && (hostname === allowed || hostname.endsWith(`.${allowed}`))
                })
            } catch {
                return true
            }
        })

        if (blockedLinks.length > 0) {
            if (canManageMessages(guild)) await safeDelete(message)
            await safeDm(author, `Your message in **${guild.name}** was removed because links are restricted in this server.`)
            await logAction(guild, {
                action: "ANTI_LINK",
                target,
                reason: "Posted a restricted link",
                extra: `Channel: <#${message.channel.id}>\nLinks: ${blockedLinks.slice(0, 3).join(", ")}`,
                metadata: { channelId: message.channel.id, messageId: message.id, blockedLinks: blockedLinks.slice(0, 10) },
            })
            return true
        }
    }

    // Message Shield already owns spam-rate/repetition decisions when enabled.
    // This prevents two independent engines from timing out the same member.
    if (config.antiSpam && !messageShieldEnabled) {
        if (isMuted(guildId, userId)) {
            if (canManageMessages(guild)) await safeDelete(message)
            return true
        }

        const { spam, count, threshold, windowMs } = recordMessage(guildId, userId)
        if (spam) {
            const muteDurationSec = MUTE_DURATION_MS / 1000
            if (canManageMessages(guild)) await safeDelete(message)

            const canTimeout = guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false
            let timedOut = false
            if (canTimeout && member?.moderatable !== false) {
                try {
                    await member.timeout(MUTE_DURATION_MS, "AutoMod: rapid message spam")
                    timedOut = true
                } catch (error) {
                    console.error("Anti-spam timeout error:", error.message)
                }
            }

            markMuted(guildId, userId, async () => {
                await logAction(guild, {
                    action: "UNMUTE",
                    target,
                    reason: `AutoMod timeout expired (${muteDurationSec}s)`,
                    source: "system",
                })
            })

            await message.channel.send({
                content: statusLine("warning", `<@${userId}> was ${timedOut ? "timed out" : "rate-limited"} for rapid spam.`),
                allowedMentions: { parse: [], users: [userId], roles: [], repliedUser: false },
            }).catch(() => {})

            await logAction(guild, {
                action: "ANTI_SPAM",
                target,
                reason: "Rapid message spam detected",
                extra: `${count}/${threshold} messages in ${Math.round(windowMs / 1000)}s. Response: ${timedOut ? `${muteDurationSec}s timeout` : "message removal"}.`,
                durationMs: timedOut ? MUTE_DURATION_MS : null,
                metadata: { channelId: message.channel.id, messageId: message.id, count, threshold, windowMs, timedOut },
            })
            return true
        }
    }

    queueLeveling(message)
    return false
}

module.exports = { runAutoMod }
