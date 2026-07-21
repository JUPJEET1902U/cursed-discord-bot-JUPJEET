const { PermissionFlagsBits } = require("discord.js")
const {
    resolveCommandPrefix,
    createCommandMessage,
    getGuildPrefix,
} = require("./prefix")
const { getServerConfig } = require("./serverConfig")
const { extractCommandName, isCommandEnabled } = require("./dashboardControl")
const {
    getModerationConfig,
    isModerator,
    hasConfiguredModeratorRole,
} = require("./moderationConfig")
const {
    getPhase2Config,
    isCommandEnabled: isPhase2CommandEnabled,
} = require("./moderationPhase2Config")
const { logAction } = require("./modlog")
const moderationPrefix = require("../commands/moderationPrefix")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const PRIORITY_COMMANDS = new Set(["!warn", "!timeout", "!kick", "!ban", "!purge"])

async function reply(message, content) {
    return message.reply({ content, allowedMentions: SAFE_MENTIONS }).catch(() =>
        message.channel.send({ content, allowedMentions: SAFE_MENTIONS }).catch(() => null)
    )
}

function commandNameFromCanonical(content) {
    const commandName = extractCommandName(content)
    return PRIORITY_COMMANDS.has(commandName) ? commandName : null
}

function parsePurgeAmount(value, max) {
    const amount = Number(value)
    if (!Number.isInteger(amount) || amount < 1 || amount > max) return null
    return amount
}

function channelPermissionState(message) {
    const botMember = message.guild?.members?.me
    const channelPermissions = message.channel?.permissionsFor?.(botMember) || null
    const has = permission => channelPermissions
        ? channelPermissions.has(permission)
        : botMember?.permissions?.has(permission) === true

    return {
        manageMessages: has(PermissionFlagsBits.ManageMessages),
        readMessageHistory: has(PermissionFlagsBits.ReadMessageHistory),
    }
}

function purgeFailureMessage(error) {
    if (error?.code === 50013) return "I do not have permission to delete messages in this channel. Check my channel overrides and role position."
    if (error?.code === 50034) return "Discord refused the batch because those messages are older than 14 days. Only recent messages can be bulk deleted."
    return "Discord could not complete the purge. Check Manage Messages, Read Message History, and the channel permission overrides."
}

async function handlePurge(message, args, config, prefix) {
    const phase2 = getPhase2Config(message.guild.id)
    if (!isPhase2CommandEnabled(phase2, "purge")) {
        await reply(message, "⛔ Purge is disabled in this server's Advanced Moderation settings.")
        return true
    }

    const max = Math.min(100, phase2.maxPurgeAmount || 100)
    const amount = parsePurgeAmount(args[0], max)
    if (!amount) {
        await reply(message, `Usage: \`${prefix}purge <1-${max}>\` or \`/purge amount:<1-${max}>\``)
        return true
    }

    const actorAllowed = hasConfiguredModeratorRole(message.member, config)
        || message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.member.permissions.has(PermissionFlagsBits.ManageMessages)
    if (!actorAllowed) {
        await reply(message, "❌ You need **Manage Messages** permission or a configured moderator role.")
        return true
    }

    const botPermissions = channelPermissionState(message)
    if (!botPermissions.manageMessages) {
        await reply(message, "❌ I need **Manage Messages** in this channel. Check both my role and this channel's overrides.")
        return true
    }
    if (!botPermissions.readMessageHistory) {
        await reply(message, "❌ I need **Read Message History** in this channel before I can purge messages.")
        return true
    }
    if (typeof message.channel?.bulkDelete !== "function") {
        await reply(message, "❌ This channel does not support bulk message deletion.")
        return true
    }

    let deleted
    try {
        deleted = await message.channel.bulkDelete(amount, true)
    } catch (error) {
        await reply(message, `❌ ${purgeFailureMessage(error)}`)
        return true
    }

    const deletedCount = Number(deleted?.size || 0)
    const skippedCount = Math.max(0, amount - deletedCount)
    const result = await logAction(message.guild, {
        action: "PURGE",
        target: { id: message.channel.id, tag: `#${message.channel.name || "unknown-channel"}` },
        moderator: {
            id: message.author.id,
            tag: message.author.tag || message.author.username || "Unknown moderator",
        },
        reason: "Prefix bulk message cleanup",
        extra: `Requested **${amount}**; deleted **${deletedCount}** recent message(s).`,
        metadata: {
            targetType: "channel",
            channelId: message.channel.id,
            requested: amount,
            deleted: deletedCount,
            skipped: skippedCount,
            source: "prefix",
        },
    }).catch(() => ({ caseRecord: null }))

    const suffix = skippedCount
        ? ` Discord skipped **${skippedCount}** message(s), usually because they were older than 14 days.`
        : ""
    const caseText = result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""
    const confirmation = await message.channel.send({
        content: deletedCount
            ? `🧹 Deleted **${deletedCount}** recent message(s).${caseText}${suffix}`
            : "ℹ️ No eligible recent messages were found. Discord cannot bulk-delete messages older than 14 days.",
        allowedMentions: SAFE_MENTIONS,
    }).catch(() => null)

    if (confirmation) {
        const timer = setTimeout(() => confirmation.delete().catch(() => {}), 5000)
        timer.unref?.()
    }
    return true
}

async function handlePriorityModerationCommand(message) {
    if (!message.guild || !message.member || message.author?.bot) return false

    const guildConfig = getServerConfig(message.guild.id).config
    const resolved = resolveCommandPrefix(message.content, guildConfig)
    if (!resolved) return false

    const commandName = commandNameFromCanonical(resolved.canonicalContent)
    if (!commandName) return false

    if (!isCommandEnabled(guildConfig, commandName)) {
        await reply(message, "⛔ That command is disabled in this server.")
        return true
    }

    const config = getModerationConfig(message.guild.id)
    if (!config.moderationCommandsEnabled) {
        await reply(message, "⛔ Moderation commands are disabled in this server.")
        return true
    }
    if (!isModerator(message.member, config)) {
        await reply(message, "❌ You need a configured moderator role or Discord moderation permission.")
        return true
    }

    const commandMessage = createCommandMessage(message, resolved.canonicalContent)
    if (commandName === "!purge") {
        const args = resolved.canonicalContent.trim().split(/\s+/).slice(1)
        return handlePurge(commandMessage, args, config, getGuildPrefix(message.guild.id))
    }

    return moderationPrefix.handle(commandMessage)
}

module.exports = {
    PRIORITY_COMMANDS,
    commandNameFromCanonical,
    parsePurgeAmount,
    channelPermissionState,
    purgeFailureMessage,
    handlePriorityModerationCommand,
}
