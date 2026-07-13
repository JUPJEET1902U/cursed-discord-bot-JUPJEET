/**
 * utils/discordContext.js
 * Safe Discord context system for CURSED AI.
 * Builds real server/member data to inject into the system prompt.
 * NEVER exposes raw Discord IDs or private information.
 */

const logger = require("./logger")
const log = logger.child("DiscordContext")

// ── Keywords that signal the user wants Discord-aware context ─────────────────
const CONTEXT_KEYWORDS = [
    // Self
    "who am i", "about me", "my roles", "my info", "what do you know about me",
    "my account", "my profile", "how long have i", "how many messages have i",
    "how many commands", "my activity", "when did i join", "when was i", "my stats",
    // Other members
    "tell me about", "info about", "who is", "what roles does", "when did",
    "how long has", "about @", "about him", "about her", "about them",
    // Server
    "server stats", "server info", "server statistics", "how many members",
    "how many channels", "how many roles", "about this server", "about the server",
    "this server", "server details",
    // CURSED identity / creator
    "who created you", "who made you", "who built you", "your creator", "your owner",
    "who is your creator", "who is your owner", "who are you", "about yourself",
    "your background",
    // Moderation
    "can you ban", "can you kick", "can you mute", "can you moderate",
    "are you a mod", "are you admin",
]

/**
 * Detect whether the user's message warrants injecting Discord context.
 * Returns true if any keyword matches, or if the message contains a user
 * @mention or a bare 17-20 digit Discord ID.
 * @param {string} text — raw user input
 * @returns {boolean}
 */
function needsDiscordContext(text) {
    const lower = text.toLowerCase()
    if (CONTEXT_KEYWORDS.some(kw => lower.includes(kw))) return true
    // User mention: <@123...> or <@!123...>
    if (/<@!?\d{17,20}>/.test(text)) return true
    // Bare Discord ID
    if (/\b\d{17,20}\b/.test(text)) return true
    return false
}

/**
 * Format a Date as "Month Day, Year".
 * @param {Date|number|null} date
 * @returns {string}
 */
function formatDate(date) {
    if (!date) return "unknown"
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
    })
}

/**
 * Classify a GuildMember's role type (human-readable, no IDs).
 * @param {import("discord.js").GuildMember} member
 * @returns {string}
 */
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

/**
 * Build a safe, human-readable string about one GuildMember.
 * @param {import("discord.js").GuildMember} member
 * @param {object|null} activity — tracked stats from DB, or null
 * @returns {string}
 */
function buildMemberContext(member, activity) {
    const lines = []
    lines.push(`Display name: ${member.displayName}`)
    lines.push(`Username: ${member.user.username}`)
    lines.push(`Account created: ${formatDate(member.user.createdAt)}`)
    lines.push(`Joined server: ${formatDate(member.joinedAt)}`)
    lines.push(`Type: ${getMemberType(member)}`)

    // Public roles — skip @everyone, cap at 10 to stay concise
    const roles = member.roles.cache
        .filter(r => r.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map(r => r.name)
        .slice(0, 10)
    lines.push(roles.length ? `Roles: ${roles.join(", ")}` : "Roles: none")

    // Activity tracking stats
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

/**
 * Build a safe, human-readable string about the current Guild.
 * @param {import("discord.js").Guild} guild
 * @returns {string}
 */
function buildServerContext(guild) {
    const { ChannelType } = require("discord.js")
    const text  = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size
    const voice = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size
    const lines = []
    lines.push(`Server name: ${guild.name}`)
    lines.push(`Member count: ${guild.memberCount}`)
    lines.push(`Text channels: ${text}`)
    lines.push(`Voice channels: ${voice}`)
    lines.push(`Roles: ${Math.max(0, guild.roles.cache.size - 1)}`)  // exclude @everyone
    lines.push(`Server created: ${formatDate(guild.createdAt)}`)
    return lines.join("\n")
}

/**
 * Build the full Discord context block to append to the system prompt.
 * All failures are caught and logged — never throws.
 *
 * @param {object} opts
 * @param {import("discord.js").Message}  opts.message
 * @param {object|null} opts.selfActivity      — tracked stats for the author
 * @param {object|null} opts.mentionedActivity — tracked stats for a mentioned user (if any)
 * @returns {string}
 */
function buildDiscordContext({ message, selfActivity = null, mentionedActivity = null }) {
    try {
        const parts = []
        parts.push(`Current channel: #${message.channel.name}`)

        // ── Author ──────────────────────────────────────────────────────────────
        if (message.member) {
            parts.push("\n[ABOUT THE USER YOU ARE TALKING TO]")
            parts.push(buildMemberContext(message.member, selfActivity))
        }

        // ── Mentioned member (if distinct from author) ─────────────────────────
        const mentioned = message.mentions.members?.first()
        if (mentioned && mentioned.id !== message.author.id) {
            parts.push("\n[ABOUT THE MENTIONED USER]")
            parts.push(buildMemberContext(mentioned, mentionedActivity))
        }

        // ── Server ──────────────────────────────────────────────────────────────
        if (message.guild) {
            parts.push("\n[ABOUT THIS SERVER]")
            parts.push(buildServerContext(message.guild))
        }

        // ── Creator ─────────────────────────────────────────────────────────────
        const creatorName = process.env.BOT_CREATOR_NAME
        if (creatorName) {
            parts.push(`\n[CREATOR INFO]\nCURSED was created by: ${creatorName}`)
            parts.push("Never reveal the creator's Discord ID or any private details about the creator.")
        } else {
            parts.push("\n[CREATOR INFO]\nNo verified creator information is configured. If asked, say you do not have verified creator information.")
        }

        // ── Moderation disclaimer ───────────────────────────────────────────────
        parts.push("\n[MODERATION]\nCURSED can moderate via slash commands and prefix commands only. Never claim to have performed a moderation action through this AI chat. If asked to ban/kick/mute via chat, redirect to the proper commands.")

        return `\n\n[REAL DISCORD CONTEXT — use this data to answer accurately; never invent numbers or IDs]\n${parts.join("\n")}`
    } catch (err) {
        log.error(`buildDiscordContext failed: ${err.message}`, { stack: err.stack })
        return ""
    }
}

module.exports = { needsDiscordContext, buildDiscordContext }
