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
const { processManagedAutomationMessage } = require("./managedAutomation")
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

function queueManagedAutomation(message) {
    processManagedAutomationMessage(message).catch(error => {
        console.error("Managed automation processing error:", error.message)
    })
}

function canManageMessages(guild) {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false
}

function normalizeAutomodPolicy(config = {}) {
    const raw = config.automodPolicy
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const action = raw.action === "timeout" ? "timeout" : raw.action === "delete" ? "delete" : null
    if (!action) return null
    const timeoutMinutes = Math.max(1, Math.min(40320, Math.floor(Number(raw.timeoutMinutes) || 1)))
    return {
        action,
        timeoutMinutes,
        timeoutMs: timeoutMinutes * 60_000,
        dmUser: raw.dmUser !== false,
    }
}

async function applyPolicyTimeout(member, policy, reason) {
    if (!policy || policy.action !== "timeout" || member?.moderatable === false) return false
    if (!member?.guild?.members?.me?.permissions?.has(PermissionFlagsBits.ModerateMembers)) return false
    try {
        await member.timeout(policy.timeoutMs, reason)
        return true
    } catch (error) {
        console.error("AutoMod policy timeout error:", error.message)
        return false
    }
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
        queueManagedAutomation(message)
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
        queueManagedAutomation(message)
        queueLeveling(message)
        return false
    }

    const { config } = getServerConfig(guildId)
    const policy = normalizeAutomodPolicy(config)
    const target = { id: author.id, tag: author.tag }

    if (config.antiInvite) {
        INVITE_REGEX.lastIndex = 0
        if (INVITE_REGEX.test(content)) {
            if (canManageMessages(guild)) await safeDelete(message)
            const timedOut = await applyPolicyTimeout(member, policy, "AutoMod: Discord invite link")
            if (!policy || policy.dmUser) {
                await safeDm(author, `Your message in **${guild.name}** was removed because Discord invite links are not allowed.${timedOut ? ` You were timed out for ${policy.timeoutMinutes} minute${policy.timeoutMinutes === 1 ? "" : "s"}.` : ""}`)
            }
            await logAction(guild, {
                action: "ANTI_INVITE",
                target,
                reason: "Posted a Discord invite link",
                extra: `Channel: <#${message.channel.id}>\nResponse: ${timedOut ? `${policy.timeoutMinutes}m timeout` : "message removal"}\nContent: \`${content.slice(0, 200)}\``,
                durationMs: timedOut ? policy.timeoutMs : null,
                metadata: { channelId: message.channel.id, messageId: message.id, timedOut },
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
            const timedOut = await applyPolicyTimeout(member, policy, "AutoMod: restricted link")
            if (!policy || policy.dmUser) {
                await safeDm(author, `Your message in **${guild.name}** was removed because links are restricted in this server.${timedOut ? ` You were timed out for ${policy.timeoutMinutes} minute${policy.timeoutMinutes === 1 ? "" : "s"}.` : ""}`)
            }
            await logAction(guild, {
                action: "ANTI_LINK",
                target,
                reason: "Posted a restricted link",
                extra: `Channel: <#${message.channel.id}>\nResponse: ${timedOut ? `${policy.timeoutMinutes}m timeout` : "message removal"}\nLinks: ${blockedLinks.slice(0, 3).join(", ")}`,
                durationMs: timedOut ? policy.timeoutMs : null,
                metadata: { channelId: message.channel.id, messageId: message.id, blockedLinks: blockedLinks.slice(0, 10), timedOut },
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
            const responseDurationMs = policy?.action === "timeout" ? policy.timeoutMs : MUTE_DURATION_MS
            const responseDurationSec = Math.round(responseDurationMs / 1000)
            if (canManageMessages(guild)) await safeDelete(message)

            let timedOut = false
            if (policy?.action !== "delete") {
                const canTimeout = guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false
                if (canTimeout && member?.moderatable !== false) {
                    try {
                        await member.timeout(responseDurationMs, "AutoMod: rapid message spam")
                        timedOut = true
                    } catch (error) {
                        console.error("Anti-spam timeout error:", error.message)
                    }
                }
            }

            markMuted(guildId, userId, async () => {
                await logAction(guild, {
                    action: "UNMUTE",
                    target,
                    reason: `AutoMod rate limit expired (${responseDurationSec}s)`,
                    source: "system",
                })
            }, { muteDurationMs: responseDurationMs })

            await message.channel.send({
                content: statusLine("warning", `<@${userId}> was ${timedOut ? "timed out" : "rate-limited"} for rapid spam.`),
                allowedMentions: { parse: [], users: [userId], roles: [], repliedUser: false },
            }).catch(() => {})

            await logAction(guild, {
                action: "ANTI_SPAM",
                target,
                reason: "Rapid message spam detected",
                extra: `${count}/${threshold} messages in ${Math.round(windowMs / 1000)}s. Response: ${timedOut ? `${responseDurationSec}s timeout` : "message removal/rate limit"}.`,
                durationMs: timedOut ? responseDurationMs : null,
                metadata: { channelId: message.channel.id, messageId: message.id, count, threshold, windowMs, timedOut },
            })
            return true
        }
    }

    queueManagedAutomation(message)
    queueLeveling(message)
    return false
}

module.exports = { runAutoMod, normalizeAutomodPolicy }
