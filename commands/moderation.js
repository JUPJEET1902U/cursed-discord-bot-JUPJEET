/**
 * CURSED moderation foundation.
 *
 * Includes permission-safe punishments, Mongo-backed warnings/cases, warning
 * escalation, Welcome, Autorole, and legacy prefix configuration commands.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require("discord.js")
const { addWarning, getWarnings, clearWarnings } = require("../utils/warnings")
const { logAction } = require("../utils/modlog")
const { getServerConfig, saveConfig } = require("../utils/serverConfig")
const { getWelcome, setWelcome, disableWelcome, testWelcome, buildPreviewEmbed } = require("../utils/welcome")
const { getAutorole, setAutorole, disableAutorole } = require("../utils/autorole")
const {
    getModerationConfig,
    isModerator,
    hasConfiguredModeratorRole,
} = require("../utils/moderationConfig")
const { validateModerationTarget } = require("../utils/moderationSafety")
const {
    getCase,
    listCases,
    updateCaseReason,
    revokeCase,
    softDeleteCase,
} = require("../utils/moderationCases")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const SNOWFLAKE = /^\d{17,20}$/
const MODERATION_COMMANDS = new Set([
    "warn", "warnings", "clearwarns", "timeout", "untimeout", "mute", "unmute",
    "kick", "ban", "unban", "case", "cases",
])

function moderationCommand(name, description) {
    return new SlashCommandBuilder().setName(name).setDescription(description)
}

const commands = [
    moderationCommand("warn", "Warn a member and create a moderation case")
        .addUserOption(option => option.setName("user").setDescription("Member to warn").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(2000)),

    moderationCommand("warnings", "View a member's active warnings")
        .addUserOption(option => option.setName("user").setDescription("Member to check").setRequired(true)),

    moderationCommand("clearwarns", "Clear a member's active warnings")
        .addUserOption(option => option.setName("user").setDescription("Member whose warnings should be cleared").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Why the warnings are being cleared").setRequired(false).setMaxLength(1000)),

    moderationCommand("timeout", "Timeout a member")
        .addUserOption(option => option.setName("user").setDescription("Member to timeout").setRequired(true))
        .addIntegerOption(option => option.setName("duration").setDescription("Duration in minutes").setRequired(false).setMinValue(1).setMaxValue(40320))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setRequired(false).setMaxLength(2000)),

    moderationCommand("untimeout", "Remove a member's timeout")
        .addUserOption(option => option.setName("user").setDescription("Member to remove timeout from").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setRequired(false).setMaxLength(2000)),

    moderationCommand("mute", "Timeout a member (legacy alias)")
        .addUserOption(option => option.setName("user").setDescription("Member to timeout").setRequired(true))
        .addIntegerOption(option => option.setName("duration").setDescription("Duration in minutes").setRequired(false).setMinValue(1).setMaxValue(40320))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setRequired(false).setMaxLength(2000)),

    moderationCommand("unmute", "Remove a member timeout (legacy alias)")
        .addUserOption(option => option.setName("user").setDescription("Member to remove timeout from").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setRequired(false).setMaxLength(2000)),

    moderationCommand("kick", "Kick a member and create a moderation case")
        .addUserOption(option => option.setName("user").setDescription("Member to kick").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the kick").setRequired(true).setMaxLength(2000)),

    moderationCommand("ban", "Ban a user and create a moderation case")
        .addUserOption(option => option.setName("user").setDescription("User to ban").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the ban").setRequired(true).setMaxLength(2000))
        .addIntegerOption(option => option.setName("delete_days").setDescription("Delete this many days of message history").setRequired(false).setMinValue(0).setMaxValue(7)),

    moderationCommand("unban", "Unban a user by Discord ID")
        .addStringOption(option => option.setName("user_id").setDescription("Discord user ID").setRequired(true).setMinLength(17).setMaxLength(20))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the unban").setRequired(false).setMaxLength(2000)),

    moderationCommand("case", "View or manage a moderation case")
        .addSubcommand(sub => sub
            .setName("view")
            .setDescription("View one moderation case")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub
            .setName("reason")
            .setDescription("Update a case reason")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName("reason").setDescription("New reason").setRequired(true).setMaxLength(2000)))
        .addSubcommand(sub => sub
            .setName("revoke")
            .setDescription("Mark a case as revoked without undoing the Discord action")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName("reason").setDescription("Why the case is being revoked").setRequired(false).setMaxLength(1000)))
        .addSubcommand(sub => sub
            .setName("delete")
            .setDescription("Soft-delete a case from normal views")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))),

    moderationCommand("cases", "List recent moderation cases")
        .addUserOption(option => option.setName("user").setDescription("Filter by user").setRequired(false))
        .addStringOption(option => option
            .setName("action")
            .setDescription("Filter by action")
            .setRequired(false)
            .addChoices(
                { name: "Warnings", value: "WARN" },
                { name: "Timeouts", value: "TIMEOUT" },
                { name: "Kicks", value: "KICK" },
                { name: "Bans", value: "BAN" },
                { name: "AutoMod", value: "ANTI_SPAM" },
            ))
        .addIntegerOption(option => option.setName("limit").setDescription("Number of cases to show").setRequired(false).setMinValue(1).setMaxValue(20)),

    new SlashCommandBuilder()
        .setName("welcome")
        .setDescription("Manage the welcome system")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName("setup")
            .setDescription("Set up the welcome message")
            .addChannelOption(option => option.setName("channel").setDescription("Welcome channel").setRequired(true))
            .addStringOption(option => option.setName("message").setDescription("Supports {user}, {mention}, {server}, {membercount}").setRequired(false).setMaxLength(2000))
            .addBooleanOption(option => option.setName("useai").setDescription("Use AI welcome text").setRequired(false))
            .addStringOption(option => option.setName("color").setDescription("Embed hex color, e.g. #5865F2").setRequired(false))
            .addBooleanOption(option => option.setName("thumbnail").setDescription("Show the member avatar").setRequired(false))
            .addStringOption(option => option.setName("image").setDescription("Embed banner URL").setRequired(false).setMaxLength(2048))
            .addStringOption(option => option.setName("footer").setDescription("Footer text").setRequired(false).setMaxLength(2048))
            .addBooleanOption(option => option.setName("card").setDescription("Generate a PNG welcome card").setRequired(false))
            .addStringOption(option => option.setName("theme").setDescription("Welcome card theme").setRequired(false).addChoices(
                { name: "Classic", value: "classic" },
                { name: "Midnight", value: "midnight" },
                { name: "Neon", value: "neon" },
            ))
            .addStringOption(option => option.setName("background").setDescription("PNG card background URL").setRequired(false).setMaxLength(2048))
            .addStringOption(option => option.setName("accent").setDescription("PNG card accent hex color").setRequired(false))
            .addStringOption(option => option.setName("media").setDescription("Fallback media URL").setRequired(false).setMaxLength(2048)))
        .addSubcommand(sub => sub.setName("view").setDescription("View welcome configuration"))
        .addSubcommand(sub => sub.setName("preview").setDescription("Preview the welcome embed"))
        .addSubcommand(sub => sub.setName("test").setDescription("Send a live test welcome"))
        .addSubcommand(sub => sub.setName("disable").setDescription("Disable welcome messages")),

    new SlashCommandBuilder()
        .setName("autorole")
        .setDescription("Manage the role assigned to new members")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub => sub
            .setName("set")
            .setDescription("Set the autorole")
            .addRoleOption(option => option.setName("role").setDescription("Role assigned on join").setRequired(true)))
        .addSubcommand(sub => sub.setName("disable").setDescription("Disable autorole"))
        .addSubcommand(sub => sub.setName("view").setDescription("View autorole configuration")),
]

function actorIdentity(member) {
    return { id: member.id, tag: member.user?.tag || member.displayName || "Unknown moderator" }
}

function targetIdentity(user) {
    return { id: user.id, tag: user.tag || user.username || "Unknown user" }
}

async function replyError(interaction, message) {
    const payload = { content: `❌ ${message}`, ephemeral: true, allowedMentions: SAFE_MENTIONS }
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {})
    return interaction.reply(payload).catch(() => {})
}

function ensureReason(config, reason) {
    const cleaned = typeof reason === "string" ? reason.trim() : ""
    if (cleaned) return { ok: true, reason: cleaned.slice(0, 2000) }
    if (config.requireModerationReason) {
        return { ok: false, error: "This server requires a moderation reason." }
    }
    return { ok: true, reason: "No reason provided" }
}

function formatDuration(durationMs) {
    if (!durationMs) return "Permanent / not applicable"
    const minutes = Math.round(durationMs / 60000)
    if (minutes % 1440 === 0) return `${minutes / 1440} day(s)`
    if (minutes % 60 === 0) return `${minutes / 60} hour(s)`
    return `${minutes} minute(s)`
}

function caseEmbed(record) {
    const embed = new EmbedBuilder()
        .setColor(record.status === "active" ? 0x7C3AED : 0x6B7280)
        .setTitle(`📁 Moderation Case #${record.caseNumber}`)
        .addFields(
            { name: "Action", value: record.action.replace(/_/g, " "), inline: true },
            { name: "Status", value: record.status, inline: true },
            { name: "Source", value: record.source, inline: true },
            { name: "Target", value: `<@${record.targetId}> (${record.targetTag})`, inline: false },
            { name: "Moderator", value: record.moderatorId ? `<@${record.moderatorId}> (${record.moderatorTag})` : record.moderatorTag, inline: false },
            { name: "Reason", value: record.reason.slice(0, 1024), inline: false },
        )
        .setTimestamp(record.createdAt ? new Date(record.createdAt) : new Date())

    if (record.durationMs) embed.addFields({ name: "Duration", value: formatDuration(record.durationMs), inline: true })
    if (record.expiresAt) embed.addFields({ name: "Expires", value: `<t:${Math.floor(new Date(record.expiresAt).getTime() / 1000)}:R>`, inline: true })
    if (record.revokeReason) embed.addFields({ name: "Revocation", value: record.revokeReason.slice(0, 1024), inline: false })
    if (record.evidenceUrl) embed.addFields({ name: "Evidence", value: record.evidenceUrl, inline: false })
    return embed
}

async function dmUser(user, config, text) {
    if (!config.dmPunishedUsers || !user) return false
    return user.send({ content: text, allowedMentions: SAFE_MENTIONS }).then(() => true).catch(() => false)
}

async function authorizeModeration(interaction, config) {
    if (!config.moderationCommandsEnabled) {
        await replyError(interaction, "Moderation commands are disabled in this server.")
        return false
    }
    if (!isModerator(interaction.member, config)) {
        await replyError(interaction, "You need a configured moderator role or Discord moderation permission.")
        return false
    }
    return true
}

async function checkTarget(interaction, target, action, config) {
    const result = await validateModerationTarget({
        guild: interaction.guild,
        actorMember: interaction.member,
        targetUser: target,
        action,
        skipActorPermission: hasConfiguredModeratorRole(interaction.member, config),
    })
    if (!result.ok) await replyError(interaction, result.error)
    return result
}

async function applyWarningEscalation(interaction, target, warningCount, config) {
    if (!config.warningEscalationEnabled) return null
    const threshold = config.warningThresholds.find(item => item.warnings === warningCount)
    if (!threshold) return null

    const action = threshold.action.toUpperCase()
    const safety = await validateModerationTarget({
        guild: interaction.guild,
        actorMember: interaction.member,
        targetUser: target,
        action,
        skipActorPermission: hasConfiguredModeratorRole(interaction.member, config),
    })
    if (!safety.ok) return `Escalation skipped: ${safety.error}`

    const reason = `Automatic escalation after ${warningCount} active warnings`
    try {
        if (threshold.action === "timeout") {
            const durationMs = threshold.durationMinutes * 60 * 1000
            await safety.targetMember.timeout(durationMs, reason)
            await dmUser(target, config, `🔇 You were timed out in **${interaction.guild.name}** for ${formatDuration(durationMs)}. Reason: ${reason}`)
            const result = await logAction(interaction.guild, {
                action: "TIMEOUT",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                durationMs,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic timeout applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
        if (threshold.action === "kick") {
            await dmUser(target, config, `👢 You were kicked from **${interaction.guild.name}**. Reason: ${reason}`)
            await safety.targetMember.kick(reason)
            const result = await logAction(interaction.guild, {
                action: "KICK",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic kick applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
        if (threshold.action === "ban") {
            await dmUser(target, config, `🔨 You were banned from **${interaction.guild.name}**. Reason: ${reason}`)
            await interaction.guild.members.ban(target.id, { reason })
            const result = await logAction(interaction.guild, {
                action: "BAN",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic ban applied${result.caseRecord ? ` (case #${result.caseRecord.caseNumber})` : ""}.`
        }
    } catch (err) {
        return `Escalation failed: ${err.message}`
    }
    return null
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.guild) return false
    const { commandName, guild, member } = interaction

    if (MODERATION_COMMANDS.has(commandName)) {
        const config = getModerationConfig(guild.id)
        if (!await authorizeModeration(interaction, config)) return true

        if (commandName === "warn") {
            const target = interaction.options.getUser("user", true)
            const reason = interaction.options.getString("reason", true).trim()
            const safety = await checkTarget(interaction, target, "WARN", config)
            if (!safety.ok) return true

            const warnings = addWarning(guild.id, target.id, target.tag, reason, member.id, member.user.tag)
            const logResult = await logAction(guild, {
                action: "WARN",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason,
                extra: `Active warnings: **${warnings.length}**`,
            })
            await dmUser(target, config, `⚠️ You were warned in **${guild.name}**. Reason: ${reason}`)
            const escalation = await applyWarningEscalation(interaction, target, warnings.length, config)

            const embed = new EmbedBuilder()
                .setColor(0xFFAA00)
                .setTitle("⚠️ Member Warned")
                .addFields(
                    { name: "Member", value: `<@${target.id}>`, inline: true },
                    { name: "Active warnings", value: String(warnings.length), inline: true },
                    { name: "Case", value: logResult.caseRecord ? `#${logResult.caseRecord.caseNumber}` : "Unavailable", inline: true },
                    { name: "Reason", value: reason.slice(0, 1024), inline: false },
                )
                .setTimestamp()
            if (escalation) embed.addFields({ name: "Escalation", value: escalation.slice(0, 1024), inline: false })
            await interaction.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
            return true
        }

        if (commandName === "warnings") {
            const target = interaction.options.getUser("user", true)
            const warnings = getWarnings(guild.id, target.id)
            if (!warnings.length) {
                await interaction.reply({ content: `✅ **${target.tag}** has no active warnings.`, ephemeral: true, allowedMentions: SAFE_MENTIONS })
                return true
            }
            const lines = warnings.slice(-10).reverse().map((warning, index) => {
                const timestamp = Math.floor(new Date(warning.timestamp).getTime() / 1000)
                return `**${warnings.length - index}.** ${warning.reason}\n> ${warning.moderatorName} • <t:${timestamp}:d>`
            })
            const embed = new EmbedBuilder()
                .setColor(0xFFAA00)
                .setTitle(`⚠️ Warnings for ${target.tag}`)
                .setDescription(lines.join("\n\n").slice(0, 4000))
                .setFooter({ text: `${warnings.length} active warning(s) • showing up to 10` })
            await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }

        if (commandName === "clearwarns") {
            const target = interaction.options.getUser("user", true)
            const reasonResult = ensureReason(config, interaction.options.getString("reason"))
            if (!reasonResult.ok) { await replyError(interaction, reasonResult.error); return true }
            const count = clearWarnings(guild.id, target.id, member.id)
            const logResult = await logAction(guild, {
                action: "CLEAR_WARNINGS",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason: reasonResult.reason,
                extra: `Cleared warnings: **${count}**`,
            })
            await interaction.reply({
                content: `🧹 Cleared **${count}** active warning(s) for **${target.tag}**${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (["timeout", "mute"].includes(commandName)) {
            const target = interaction.options.getUser("user", true)
            const durationMinutes = interaction.options.getInteger("duration") ?? config.defaultTimeoutMinutes
            const reasonResult = ensureReason(config, interaction.options.getString("reason"))
            if (!reasonResult.ok) { await replyError(interaction, reasonResult.error); return true }
            const safety = await checkTarget(interaction, target, "TIMEOUT", config)
            if (!safety.ok) return true
            const durationMs = durationMinutes * 60 * 1000
            try {
                await safety.targetMember.timeout(durationMs, `${reasonResult.reason} • ${member.user.tag}`)
            } catch (err) {
                await replyError(interaction, `Could not timeout that member: ${err.message}`)
                return true
            }
            await dmUser(target, config, `🔇 You were timed out in **${guild.name}** for ${formatDuration(durationMs)}. Reason: ${reasonResult.reason}`)
            const logResult = await logAction(guild, {
                action: "TIMEOUT",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason: reasonResult.reason,
                durationMs,
                extra: `Duration: **${formatDuration(durationMs)}**`,
            })
            await interaction.reply({
                content: `🔇 **${target.tag}** was timed out for **${formatDuration(durationMs)}**${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (["untimeout", "unmute"].includes(commandName)) {
            const target = interaction.options.getUser("user", true)
            const reasonResult = ensureReason(config, interaction.options.getString("reason"))
            if (!reasonResult.ok) { await replyError(interaction, reasonResult.error); return true }
            const safety = await checkTarget(interaction, target, "UNTIMEOUT", config)
            if (!safety.ok) return true
            try {
                await safety.targetMember.timeout(null, `${reasonResult.reason} • ${member.user.tag}`)
            } catch (err) {
                await replyError(interaction, `Could not remove that timeout: ${err.message}`)
                return true
            }
            const logResult = await logAction(guild, {
                action: "UNTIMEOUT",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason: reasonResult.reason,
            })
            await interaction.reply({
                content: `🔊 Removed **${target.tag}**'s timeout${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (commandName === "kick") {
            const target = interaction.options.getUser("user", true)
            const reason = interaction.options.getString("reason", true).trim()
            const safety = await checkTarget(interaction, target, "KICK", config)
            if (!safety.ok) return true
            await dmUser(target, config, `👢 You were kicked from **${guild.name}**. Reason: ${reason}`)
            try {
                await safety.targetMember.kick(`${reason} • ${member.user.tag}`)
            } catch (err) {
                await replyError(interaction, `Could not kick that member: ${err.message}`)
                return true
            }
            const logResult = await logAction(guild, {
                action: "KICK",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason,
            })
            await interaction.reply({
                content: `👢 **${target.tag}** was kicked${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (commandName === "ban") {
            const target = interaction.options.getUser("user", true)
            const reason = interaction.options.getString("reason", true).trim()
            const deleteDays = interaction.options.getInteger("delete_days") ?? 0
            const safety = await checkTarget(interaction, target, "BAN", config)
            if (!safety.ok) return true
            await dmUser(target, config, `🔨 You were banned from **${guild.name}**. Reason: ${reason}`)
            try {
                await guild.members.ban(target.id, {
                    reason: `${reason} • ${member.user.tag}`,
                    deleteMessageSeconds: deleteDays * 24 * 60 * 60,
                })
            } catch (err) {
                await replyError(interaction, `Could not ban that user: ${err.message}`)
                return true
            }
            const logResult = await logAction(guild, {
                action: "BAN",
                target: targetIdentity(target),
                moderator: actorIdentity(member),
                reason,
                extra: deleteDays ? `Deleted **${deleteDays} day(s)** of message history` : null,
            })
            await interaction.reply({
                content: `🔨 **${target.tag}** was banned${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (commandName === "unban") {
            const userId = interaction.options.getString("user_id", true).trim()
            if (!SNOWFLAKE.test(userId)) { await replyError(interaction, "Enter a valid Discord user ID."); return true }
            const reasonResult = ensureReason(config, interaction.options.getString("reason"))
            if (!reasonResult.ok) { await replyError(interaction, reasonResult.error); return true }
            if (!hasConfiguredModeratorRole(member, config) && !member.permissions.has(PermissionFlagsBits.BanMembers)) {
                await replyError(interaction, "You need Ban Members permission or a configured moderator role.")
                return true
            }
            if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
                await replyError(interaction, "I need Ban Members permission.")
                return true
            }
            const ban = await guild.bans.fetch(userId).catch(() => null)
            if (!ban) { await replyError(interaction, "That user is not banned in this server."); return true }
            try {
                await guild.members.unban(userId, `${reasonResult.reason} • ${member.user.tag}`)
            } catch (err) {
                await replyError(interaction, `Could not unban that user: ${err.message}`)
                return true
            }
            const logResult = await logAction(guild, {
                action: "UNBAN",
                target: { id: userId, tag: ban.user.tag },
                moderator: actorIdentity(member),
                reason: reasonResult.reason,
            })
            await interaction.reply({
                content: `🕊️ **${ban.user.tag}** was unbanned${logResult.caseRecord ? ` • Case #${logResult.caseRecord.caseNumber}` : ""}.`,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }

        if (commandName === "case") {
            const sub = interaction.options.getSubcommand()
            const number = interaction.options.getInteger("number", true)
            if (sub === "view") {
                const record = await getCase(guild.id, number)
                if (!record) { await replyError(interaction, `Case #${number} was not found.`); return true }
                await interaction.reply({ embeds: [caseEmbed(record)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
                return true
            }
            if (sub === "reason") {
                const reason = interaction.options.getString("reason", true)
                const record = await updateCaseReason(guild.id, number, reason, actorIdentity(member))
                if (!record) { await replyError(interaction, `Case #${number} was not found.`); return true }
                await interaction.reply({ content: `✅ Updated the reason for case **#${number}**.`, ephemeral: true })
                return true
            }
            if (sub === "revoke") {
                const reason = interaction.options.getString("reason")
                const record = await revokeCase(guild.id, number, actorIdentity(member), reason)
                if (!record) { await replyError(interaction, `Case #${number} was not found or is not active.`); return true }
                await interaction.reply({ content: `✅ Case **#${number}** is now marked revoked. This does not undo the Discord punishment.`, ephemeral: true })
                return true
            }
            if (sub === "delete") {
                if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    await replyError(interaction, "Manage Server permission is required to delete a case.")
                    return true
                }
                const record = await softDeleteCase(guild.id, number, actorIdentity(member))
                if (!record) { await replyError(interaction, `Case #${number} was not found.`); return true }
                await interaction.reply({ content: `🗑️ Case **#${number}** was removed from normal case views.`, ephemeral: true })
                return true
            }
        }

        if (commandName === "cases") {
            const target = interaction.options.getUser("user")
            const action = interaction.options.getString("action")
            const limit = interaction.options.getInteger("limit") ?? 10
            const records = await listCases(guild.id, { targetId: target?.id, action, limit })
            if (!records.length) {
                await interaction.reply({ content: "No matching moderation cases were found.", ephemeral: true })
                return true
            }
            const lines = records.map(record => {
                const timestamp = record.createdAt ? Math.floor(new Date(record.createdAt).getTime() / 1000) : null
                return `**#${record.caseNumber} • ${record.action.replace(/_/g, " ")}** — <@${record.targetId}>\n> ${record.reason.slice(0, 180)}${timestamp ? ` • <t:${timestamp}:R>` : ""} • ${record.status}`
            })
            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle("📚 Recent Moderation Cases")
                .setDescription(lines.join("\n\n").slice(0, 4000))
                .setFooter({ text: `Showing ${records.length} case(s)` })
            await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
    }

    if (commandName === "welcome") {
        const sub = interaction.options.getSubcommand()
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await replyError(interaction, "Manage Server permission is required to configure Welcome.")
            return true
        }

        if (sub === "setup") {
            const channel = interaction.options.getChannel("channel", true)
            if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
                await replyError(interaction, "Choose a text or announcement channel.")
                return true
            }
            const color = interaction.options.getString("color")
            const accent = interaction.options.getString("accent")
            if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) { await replyError(interaction, "Embed color must be a six-digit hex color."); return true }
            if (accent && !/^#?[0-9A-Fa-f]{6}$/.test(accent)) { await replyError(interaction, "Accent color must be a six-digit hex color."); return true }

            const urls = [
                ["image", interaction.options.getString("image")],
                ["background", interaction.options.getString("background")],
                ["media", interaction.options.getString("media")],
            ]
            for (const [label, value] of urls) {
                if (!value) continue
                try {
                    const url = new URL(value)
                    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol")
                } catch {
                    await replyError(interaction, `${label} must be a valid http(s) URL.`)
                    return true
                }
            }

            setWelcome(guild.id, channel.id, {
                message: interaction.options.getString("message"),
                useAI: interaction.options.getBoolean("useai") ?? false,
                color,
                thumbnail: interaction.options.getBoolean("thumbnail") ?? true,
                imageUrl: interaction.options.getString("image"),
                footer: interaction.options.getString("footer"),
                cardEnabled: interaction.options.getBoolean("card") ?? true,
                cardTheme: interaction.options.getString("theme") ?? "classic",
                cardBackground: interaction.options.getString("background"),
                accentColor: accent,
                mediaUrl: interaction.options.getString("media"),
            })
            await interaction.reply({ content: `✅ Welcome messages are enabled in <#${channel.id}>.`, allowedMentions: SAFE_MENTIONS })
            return true
        }

        const config = getWelcome(guild.id)
        if (sub === "view") {
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("📋 Welcome Configuration")
                .addFields(
                    { name: "Status", value: config.welcomeEnabled && config.welcomeChannelId ? "Enabled" : "Disabled", inline: true },
                    { name: "Channel", value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : "Not selected", inline: true },
                    { name: "AI", value: config.welcomeUseAI ? "Enabled" : "Disabled", inline: true },
                    { name: "Card", value: config.welcomeCardEnabled ? config.welcomeCardTheme : "Disabled", inline: true },
                    { name: "Message", value: (config.welcomeMessage || "Built-in default").slice(0, 1024), inline: false },
                )
            await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        if (sub === "preview") {
            if (!config.welcomeChannelId) { await replyError(interaction, "Configure a welcome channel first."); return true }
            await interaction.reply({ content: "👁️ Welcome preview", embeds: [buildPreviewEmbed(config, member)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        if (sub === "test") {
            if (!config.welcomeChannelId) { await replyError(interaction, "Configure a welcome channel first."); return true }
            await interaction.deferReply({ ephemeral: true })
            const channel = await guild.channels.fetch(config.welcomeChannelId).catch(() => null)
            if (!channel?.isTextBased()) { await interaction.editReply("❌ The configured welcome channel is unavailable."); return true }
            const { callAI } = require("../utils/ai")
            await testWelcome(channel, config, callAI, member)
            await interaction.editReply(`✅ Test welcome sent to <#${config.welcomeChannelId}>.`)
            return true
        }
        if (sub === "disable") {
            disableWelcome(guild.id)
            await interaction.reply({ content: "✅ Welcome messages are disabled. No fallback welcome will be sent.", ephemeral: true })
            return true
        }
    }

    if (commandName === "autorole") {
        const sub = interaction.options.getSubcommand()
        if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await replyError(interaction, "Manage Roles permission is required.")
            return true
        }
        if (sub === "set") {
            const role = interaction.options.getRole("role", true)
            const botMember = guild.members.me
            if (role.managed) { await replyError(interaction, "Integration-managed roles cannot be used as autoroles."); return true }
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) { await replyError(interaction, "I need Manage Roles permission."); return true }
            if (botMember.roles.highest.comparePositionTo(role) <= 0) { await replyError(interaction, "Move my highest role above the selected role."); return true }
            setAutorole(guild.id, role.id, role.name)
            await interaction.reply({ content: `✅ New members will receive <@&${role.id}>.`, allowedMentions: SAFE_MENTIONS })
            return true
        }
        if (sub === "disable") {
            disableAutorole(guild.id)
            await interaction.reply({ content: "✅ Autorole is disabled.", ephemeral: true })
            return true
        }
        if (sub === "view") {
            const config = getAutorole(guild.id)
            await interaction.reply({
                content: config.autoroleId
                    ? `✅ Autorole: <@&${config.autoroleId}>`
                    : "❌ Autorole is disabled.",
                ephemeral: true,
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }
    }

    return false
}

async function handlePrefixCommand(message) {
    const msgLower = message.content.toLowerCase().trim()
    const { guild, member } = message
    if (!guild || !member) return false
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator)

    if (msgLower === "!setmodlog") {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const { data, config } = getServerConfig(guild.id)
        config.modLogChannelId = message.channel.id
        saveConfig(data)
        await message.channel.send(`✅ Mod-log channel set to <#${message.channel.id}>.`)
        return true
    }

    for (const [prefix, key, label] of [
        ["!antispam ", "antiSpam", "Anti-spam"],
        ["!antilink ", "antiLink", "Anti-link"],
        ["!antiinvite ", "antiInvite", "Anti-invite"],
    ]) {
        if (!msgLower.startsWith(prefix)) continue
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const value = msgLower.slice(prefix.length).trim()
        if (!["on", "off"].includes(value)) { await message.channel.send(`Usage: \`${prefix.trim()} on|off\``); return true }
        const { data, config } = getServerConfig(guild.id)
        config[key] = value === "on"
        saveConfig(data)
        await message.channel.send(`✅ ${label} is now **${value.toUpperCase()}**.`)
        return true
    }

    if (msgLower.startsWith("!whitelist ")) {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const parts = message.content.trim().split(/\s+/)
        const sub = parts[1]?.toLowerCase()
        const domain = parts[2]?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
        if (!["add", "remove"].includes(sub) || !domain) {
            await message.channel.send("Usage: `!whitelist add <domain>` or `!whitelist remove <domain>`")
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        if (!Array.isArray(config.linkWhitelist)) config.linkWhitelist = []
        if (sub === "add" && !config.linkWhitelist.includes(domain)) config.linkWhitelist.push(domain)
        if (sub === "remove") config.linkWhitelist = config.linkWhitelist.filter(item => item !== domain)
        saveConfig(data)
        await message.channel.send(`✅ **${domain}** ${sub === "add" ? "added to" : "removed from"} the whitelist.`)
        return true
    }

    return false
}

module.exports = { commands, handleInteraction, handlePrefixCommand }
