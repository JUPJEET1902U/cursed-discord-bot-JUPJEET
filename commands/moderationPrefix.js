const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const { addWarning } = require("../utils/warnings")
const {
    getModerationConfig,
    isModerator,
    hasConfiguredModeratorRole,
} = require("../utils/moderationConfig")
const { validateModerationTarget } = require("../utils/moderationSafety")
const { logAction } = require("../utils/modlog")
const { getPhase2Config } = require("../utils/moderationPhase2Config")
const { getGuildPrefix } = require("../utils/prefix")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const PREFIX_COMMANDS = new Set(["warn", "timeout", "kick", "ban", "purge"])
const SNOWFLAKE = /^\d{17,20}$/
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000

function actor(member) {
    return {
        id: member.id,
        tag: member.user?.tag || member.displayName || "Unknown moderator",
    }
}

function target(user) {
    return {
        id: user.id,
        tag: user.tag || user.username || "Unknown user",
    }
}

async function reply(message, content, extra = {}) {
    return message.reply({ content, allowedMentions: SAFE_MENTIONS, ...extra }).catch(() =>
        message.channel.send({ content, allowedMentions: SAFE_MENTIONS, ...extra }).catch(() => null)
    )
}

function parseCommand(content) {
    const match = String(content || "").trim().match(/^!(warn|timeout|kick|ban|purge)(?:\s+|$)/i)
    if (!match) return null
    const command = match[1].toLowerCase()
    if (!PREFIX_COMMANDS.has(command)) return null
    const args = String(content || "").trim().slice(match[0].length).trim().split(/\s+/).filter(Boolean)
    return { command, args }
}

async function resolveUser(message, token) {
    const mentioned = message.mentions.users.first()
    if (mentioned) return mentioned
    const id = String(token || "").replace(/[<@!>]/g, "")
    if (!SNOWFLAKE.test(id)) return null
    return message.client.users.fetch(id).catch(() => null)
}

function parseDuration(token, fallbackMinutes) {
    if (!token) return { durationMs: fallbackMinutes * 60 * 1000, consumed: false }
    const text = String(token).trim().toLowerCase()
    const match = text.match(/^(\d+)(m|h|d|w)?$/)
    if (!match) return { durationMs: fallbackMinutes * 60 * 1000, consumed: false }
    const amount = Number(match[1])
    const unit = match[2] || "m"
    const multiplier = unit === "m"
        ? 60 * 1000
        : unit === "h"
            ? 60 * 60 * 1000
            : unit === "d"
                ? 24 * 60 * 60 * 1000
                : 7 * 24 * 60 * 60 * 1000
    const durationMs = amount * multiplier
    if (!Number.isSafeInteger(durationMs) || durationMs < 60 * 1000 || durationMs > MAX_TIMEOUT_MS) return null
    return { durationMs, consumed: true }
}

function formatDuration(ms) {
    const minutes = Math.round(ms / 60000)
    if (minutes % 1440 === 0) return `${minutes / 1440} day(s)`
    if (minutes % 60 === 0) return `${minutes / 60} hour(s)`
    return `${minutes} minute(s)`
}

function reasonFrom(args, startIndex, config, fallback) {
    const reason = args.slice(startIndex).join(" ").trim()
    if (reason) return { ok: true, reason: reason.slice(0, 2000) }
    if (config.requireModerationReason) return { ok: false, error: "This server requires a moderation reason." }
    return { ok: true, reason: fallback }
}

async function dmUser(user, config, text) {
    if (!config.dmPunishedUsers || !user) return false
    return user.send({ content: text, allowedMentions: SAFE_MENTIONS }).then(() => true).catch(() => false)
}

async function validateTarget(message, targetUser, action, config) {
    return validateModerationTarget({
        guild: message.guild,
        actorMember: message.member,
        targetUser,
        action,
        skipActorPermission: hasConfiguredModeratorRole(message.member, config),
    })
}

async function applyWarningEscalation(message, targetUser, warningCount, config) {
    if (!config.warningEscalationEnabled) return null
    const threshold = config.warningThresholds.find(item => item.warnings === warningCount)
    if (!threshold) return null

    const action = threshold.action.toUpperCase()
    const safety = await validateTarget(message, targetUser, action, config)
    if (!safety.ok) return `Escalation skipped: ${safety.error}`

    const reason = `Automatic escalation after ${warningCount} active warnings`
    try {
        if (threshold.action === "timeout") {
            const durationMs = threshold.durationMinutes * 60 * 1000
            await safety.targetMember.timeout(durationMs, reason)
            await dmUser(targetUser, config, `🔇 You were timed out in **${message.guild.name}** for ${formatDuration(durationMs)}. Reason: ${reason}`)
            const result = await logAction(message.guild, {
                action: "TIMEOUT",
                target: target(targetUser),
                moderator: actor(message.member),
                reason,
                durationMs,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic timeout applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
        if (threshold.action === "kick") {
            await dmUser(targetUser, config, `👢 You were kicked from **${message.guild.name}**. Reason: ${reason}`)
            await safety.targetMember.kick(reason)
            const result = await logAction(message.guild, {
                action: "KICK",
                target: target(targetUser),
                moderator: actor(message.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic kick applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
        if (threshold.action === "ban") {
            await dmUser(targetUser, config, `🔨 You were banned from **${message.guild.name}**. Reason: ${reason}`)
            await message.guild.members.ban(targetUser.id, { reason })
            const result = await logAction(message.guild, {
                action: "BAN",
                target: target(targetUser),
                moderator: actor(message.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic ban applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
    } catch (error) {
        return `Escalation failed: ${error.message}`
    }
    return null
}

async function handleWarn(message, args, config, prefix) {
    const targetUser = await resolveUser(message, args[0])
    if (!targetUser) {
        await reply(message, `Usage: \`${prefix}warn @user <reason>\``)
        return true
    }
    const reason = args.slice(1).join(" ").trim()
    if (!reason) {
        await reply(message, `Usage: \`${prefix}warn @user <reason>\``)
        return true
    }

    const safety = await validateTarget(message, targetUser, "WARN", config)
    if (!safety.ok) {
        await reply(message, `❌ ${safety.error}`)
        return true
    }

    const warnings = addWarning(
        message.guild.id,
        targetUser.id,
        targetUser.tag || targetUser.username,
        reason.slice(0, 2000),
        message.author.id,
        message.author.tag
    )
    const result = await logAction(message.guild, {
        action: "WARN",
        target: target(targetUser),
        moderator: actor(message.member),
        reason: reason.slice(0, 2000),
        extra: `Active warnings: **${warnings.length}**`,
    })
    await dmUser(targetUser, config, `⚠️ You were warned in **${message.guild.name}**. Reason: ${reason.slice(0, 2000)}`)
    const escalation = await applyWarningEscalation(message, targetUser, warnings.length, config)

    const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle("⚠️ Member Warned")
        .addFields(
            { name: "Member", value: `<@${targetUser.id}>`, inline: true },
            { name: "Active warnings", value: String(warnings.length), inline: true },
            { name: "Case", value: result.caseRecord ? `#${result.caseRecord.caseNumber}` : "Unavailable", inline: true },
            { name: "Reason", value: reason.slice(0, 1024), inline: false }
        )
        .setTimestamp()
    if (escalation) embed.addFields({ name: "Escalation", value: escalation.slice(0, 1024), inline: false })
    await message.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    return true
}

async function handleTimeout(message, args, config, prefix) {
    const targetUser = await resolveUser(message, args[0])
    if (!targetUser) {
        await reply(message, `Usage: \`${prefix}timeout @user [10m|2h|1d] <reason>\``)
        return true
    }

    const duration = parseDuration(args[1], config.defaultTimeoutMinutes)
    if (!duration) {
        await reply(message, "❌ Timeout duration must be between 1 minute and 28 days.")
        return true
    }
    const reasonResult = reasonFrom(args, duration.consumed ? 2 : 1, config, "No reason provided")
    if (!reasonResult.ok) {
        await reply(message, `❌ ${reasonResult.error}`)
        return true
    }

    const safety = await validateTarget(message, targetUser, "TIMEOUT", config)
    if (!safety.ok) {
        await reply(message, `❌ ${safety.error}`)
        return true
    }

    await safety.targetMember.timeout(duration.durationMs, `${reasonResult.reason} • ${message.author.tag}`)
    await dmUser(targetUser, config, `🔇 You were timed out in **${message.guild.name}** for ${formatDuration(duration.durationMs)}. Reason: ${reasonResult.reason}`)
    const result = await logAction(message.guild, {
        action: "TIMEOUT",
        target: target(targetUser),
        moderator: actor(message.member),
        reason: reasonResult.reason,
        durationMs: duration.durationMs,
        extra: `Duration: **${formatDuration(duration.durationMs)}**`,
    })
    await reply(message, `🔇 **${targetUser.tag || targetUser.username}** was timed out for **${formatDuration(duration.durationMs)}**${result.caseRecord ? ` • Case #${result.caseRecord.caseNumber}` : ""}.`)
    return true
}

async function handleKick(message, args, config, prefix) {
    const targetUser = await resolveUser(message, args[0])
    if (!targetUser) {
        await reply(message, `Usage: \`${prefix}kick @user <reason>\``)
        return true
    }
    const reasonResult = reasonFrom(args, 1, config, "No reason provided")
    if (!reasonResult.ok) {
        await reply(message, `❌ ${reasonResult.error}`)
        return true
    }

    const safety = await validateTarget(message, targetUser, "KICK", config)
    if (!safety.ok) {
        await reply(message, `❌ ${safety.error}`)
        return true
    }

    await dmUser(targetUser, config, `👢 You were kicked from **${message.guild.name}**. Reason: ${reasonResult.reason}`)
    await safety.targetMember.kick(`${reasonResult.reason} • ${message.author.tag}`)
    const result = await logAction(message.guild, {
        action: "KICK",
        target: target(targetUser),
        moderator: actor(message.member),
        reason: reasonResult.reason,
    })
    await reply(message, `👢 **${targetUser.tag || targetUser.username}** was kicked${result.caseRecord ? ` • Case #${result.caseRecord.caseNumber}` : ""}.`)
    return true
}

async function handleBan(message, args, config, prefix) {
    const targetUser = await resolveUser(message, args[0])
    if (!targetUser) {
        await reply(message, `Usage: \`${prefix}ban @user <reason>\``)
        return true
    }
    const reasonResult = reasonFrom(args, 1, config, "No reason provided")
    if (!reasonResult.ok) {
        await reply(message, `❌ ${reasonResult.error}`)
        return true
    }

    const safety = await validateTarget(message, targetUser, "BAN", config)
    if (!safety.ok) {
        await reply(message, `❌ ${safety.error}`)
        return true
    }

    await dmUser(targetUser, config, `🔨 You were banned from **${message.guild.name}**. Reason: ${reasonResult.reason}`)
    await message.guild.members.ban(targetUser.id, { reason: `${reasonResult.reason} • ${message.author.tag}` })
    const result = await logAction(message.guild, {
        action: "BAN",
        target: target(targetUser),
        moderator: actor(message.member),
        reason: reasonResult.reason,
    })
    await reply(message, `🔨 **${targetUser.tag || targetUser.username}** was banned${result.caseRecord ? ` • Case #${result.caseRecord.caseNumber}` : ""}.`)
    return true
}

async function handlePurge(message, args, config, prefix) {
    const amount = Number(args[0])
    const phase2 = getPhase2Config(message.guild.id)
    const max = Math.min(100, phase2.maxPurgeAmount || 100)
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        await reply(message, `Usage: \`${prefix}purge <1-${max}>\``)
        return true
    }

    const actorAllowed = hasConfiguredModeratorRole(message.member, config)
        || message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.member.permissions.has(PermissionFlagsBits.ManageMessages)
    if (!actorAllowed) {
        await reply(message, "❌ You need Manage Messages permission or a configured moderator role.")
        return true
    }
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await reply(message, "❌ I need Manage Messages permission.")
        return true
    }
    if (!message.channel?.bulkDelete) {
        await reply(message, "❌ This channel does not support bulk message deletion.")
        return true
    }

    const deleted = await message.channel.bulkDelete(amount, true)
    const confirmation = await message.channel.send({
        content: `🧹 Deleted **${deleted.size}** message(s).`,
        allowedMentions: SAFE_MENTIONS,
    })
    setTimeout(() => confirmation.delete().catch(() => {}), 5000).unref?.()
    return true
}

async function handle(message) {
    if (!message.guild || !message.member) return false
    const parsed = parseCommand(message.content)
    if (!parsed) return false

    const config = getModerationConfig(message.guild.id)
    const prefix = getGuildPrefix(message.guild.id)
    if (!config.moderationCommandsEnabled) {
        await reply(message, "⛔ Moderation commands are disabled in this server.")
        return true
    }
    if (!isModerator(message.member, config)) {
        await reply(message, "❌ You need a configured moderator role or Discord moderation permission.")
        return true
    }

    try {
        if (parsed.command === "warn") return handleWarn(message, parsed.args, config, prefix)
        if (parsed.command === "timeout") return handleTimeout(message, parsed.args, config, prefix)
        if (parsed.command === "kick") return handleKick(message, parsed.args, config, prefix)
        if (parsed.command === "ban") return handleBan(message, parsed.args, config, prefix)
        if (parsed.command === "purge") return handlePurge(message, parsed.args, config, prefix)
    } catch (error) {
        await reply(message, `❌ ${parsed.command} failed safely: ${error.message}`)
        return true
    }
    return false
}

module.exports = { handle, parseDuration }
