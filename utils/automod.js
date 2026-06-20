/**
 * Auto-moderation filters: anti-link, anti-invite, anti-spam.
 *
 * Call `runAutoMod(message)` from the MessageCreate handler.
 * Returns true if the message was actioned (deleted / user muted) so the
 * caller can skip further processing.
 */

const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")
const { logAction } = require("./modlog")
const { recordMessage, markMuted, isMuted, MUTE_DURATION_MS } = require("./antiSpam")

// Regex patterns — pre-compiled outside functions to avoid repeated compilation.
// Kept deliberately simple (no nested quantifiers) to prevent ReDoS.
// LINK_REGEX: matches http(s):// or www. followed by a non-whitespace hostname segment.
const LINK_REGEX   = /https?:\/\/\S+|www\.\S+\.\S+/gi
// INVITE_REGEX: matches discord.gg/<code> or discord.com/invite/<code>.
// The invite code is limited to 2-32 alphanumeric/hyphen chars to bound backtracking.
const INVITE_REGEX = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]{2,32}/gi

/**
 * Check whether the bot has permission to manage messages in this channel.
 */
function canManageMessages(guild) {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false
}

/**
 * Safely delete a message, ignoring errors (already deleted, no perms, etc.)
 */
async function safeDelete(message) {
    try { await message.delete() } catch { /* ignore */ }
}

/**
 * Run all enabled auto-mod filters against an incoming message.
 *
 * @param {import("discord.js").Message} message
 * @returns {Promise<boolean>} true if the message was actioned
 */
async function runAutoMod(message) {
    if (message.author.bot) return false
    if (!message.guild)     return false

    const { guild, member, author, content } = message
    const guildId = guild.id
    const userId  = author.id

    // Moderators (ManageMessages) are exempt from auto-mod
    if (member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false

    const { config } = getServerConfig(guildId)

    const target = { id: author.id, tag: author.tag }

    // ── Anti-invite ────────────────────────────────────────────────────────────
    if (config.antiInvite) {
        INVITE_REGEX.lastIndex = 0 // reset global regex state before each use
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
                extra:  `Channel: <#${message.channel.id}>\nContent: \`${content.slice(0, 200)}\``,
            })
            return true
        }
    }

    // ── Anti-link ──────────────────────────────────────────────────────────────
    if (config.antiLink) {
        const whitelist = config.linkWhitelist || []
        LINK_REGEX.lastIndex = 0 // reset global regex state before each use
        const matches   = content.match(LINK_REGEX) || []

        const blockedLinks = matches.filter(link => {
            // Extract hostname for whitelist check
            try {
                const url      = link.startsWith("http") ? link : `https://${link}`
                const hostname = new URL(url).hostname.replace(/^www\./, "")
                return !whitelist.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`))
            } catch {
                return true // malformed URL — block it
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
                extra:  `Channel: <#${message.channel.id}>\nLinks: ${blockedLinks.slice(0, 3).join(", ")}`,
            })
            return true
        }
    }

    // ── Anti-spam ──────────────────────────────────────────────────────────────
    if (config.antiSpam) {
        // If already muted by anti-spam, delete the message silently
        if (isMuted(guildId, userId)) {
            if (canManageMessages(guild)) await safeDelete(message)
            return true
        }

        const { spam } = recordMessage(guildId, userId)
        if (spam) {
            const muteDurationSec = MUTE_DURATION_MS / 1000

            // Delete the triggering message
            if (canManageMessages(guild)) await safeDelete(message)

            // Apply Discord timeout if we have permission
            const canTimeout = guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false
            if (canTimeout && member) {
                try {
                    await member.timeout(MUTE_DURATION_MS, "Anti-spam: rapid message flood")
                } catch (err) {
                    console.error("Anti-spam timeout error:", err.message)
                }
            }

            // Schedule unmute callback (removes from our internal set)
            markMuted(guildId, userId, async () => {
                // Timeout is lifted automatically by Discord after MUTE_DURATION_MS;
                // nothing extra needed here, but we log the unmute.
                await logAction(guild, {
                    action: "UNMUTE",
                    target,
                    reason: `Anti-spam timeout expired (${muteDurationSec}s)`,
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
                extra:  `Muted for **${muteDurationSec} seconds**`,
            })
            return true
        }
    }

    return false
}

module.exports = { runAutoMod }
