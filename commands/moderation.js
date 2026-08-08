/**
 * CURSED moderation foundation.
 *
 * Public behavior stays familiar: warnings, timeouts, kicks, bans, cases,
 * Welcome, Autorole, and legacy prefix configuration. Reboot standardizes the
 * permission flow, response language, logging and failure handling.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
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
const {
    moderation: moderationEmbed,
    admin: adminEmbed,
    statusLine,
    permissionDenied,
    botPermissionMissing,
    caseSuffix,
    invalidUsage,
    replyInteraction,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")

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
        .addStringOption(option => option.setName("reason").setDescription("Why the warnings are being cleared").setMaxLength(1000)),
    moderationCommand("timeout", "Timeout a member")
        .addUserOption(option => option.setName("user").setDescription("Member to timeout").setRequired(true))
        .addIntegerOption(option => option.setName("duration").setDescription("Duration in minutes").setMinValue(1).setMaxValue(40320))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setMaxLength(2000)),
    moderationCommand("untimeout", "Remove a member's timeout")
        .addUserOption(option => option.setName("user").setDescription("Member to remove timeout from").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setMaxLength(2000)),
    moderationCommand("mute", "Timeout a member (legacy alias)")
        .addUserOption(option => option.setName("user").setDescription("Member to timeout").setRequired(true))
        .addIntegerOption(option => option.setName("duration").setDescription("Duration in minutes").setMinValue(1).setMaxValue(40320))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setMaxLength(2000)),
    moderationCommand("unmute", "Remove a member timeout (legacy alias)")
        .addUserOption(option => option.setName("user").setDescription("Member to remove timeout from").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setMaxLength(2000)),
    moderationCommand("kick", "Kick a member and create a moderation case")
        .addUserOption(option => option.setName("user").setDescription("Member to kick").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the kick").setRequired(true).setMaxLength(2000)),
    moderationCommand("ban", "Ban a user and create a moderation case")
        .addUserOption(option => option.setName("user").setDescription("User to ban").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the ban").setRequired(true).setMaxLength(2000))
        .addIntegerOption(option => option.setName("delete_days").setDescription("Delete this many days of message history").setMinValue(0).setMaxValue(7)),
    moderationCommand("unban", "Unban a user by Discord ID")
        .addStringOption(option => option.setName("user_id").setDescription("Discord user ID").setRequired(true).setMinLength(17).setMaxLength(20))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the unban").setMaxLength(2000)),
    moderationCommand("case", "View or manage a moderation case")
        .addSubcommand(sub => sub.setName("view").setDescription("View one moderation case")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName("reason").setDescription("Update a case reason")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName("reason").setDescription("New reason").setRequired(true).setMaxLength(2000)))
        .addSubcommand(sub => sub.setName("revoke").setDescription("Mark a case as revoked without undoing the Discord action")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName("reason").setDescription("Why the case is being revoked").setMaxLength(1000)))
        .addSubcommand(sub => sub.setName("delete").setDescription("Soft-delete a case from normal views")
            .addIntegerOption(option => option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))),
    moderationCommand("cases", "List recent moderation cases")
        .addUserOption(option => option.setName("user").setDescription("Filter by user"))
        .addStringOption(option => option.setName("action").setDescription("Filter by action").addChoices(
            { name: "Warnings", value: "WARN" },
            { name: "Timeouts", value: "TIMEOUT" },
            { name: "Kicks", value: "KICK" },
            { name: "Bans", value: "BAN" },
            { name: "AutoMod", value: "ANTI_SPAM" },
        ))
        .addIntegerOption(option => option.setName("limit").setDescription("Number of cases to show").setMinValue(1).setMaxValue(20)),
    new SlashCommandBuilder()
        .setName("welcome")
        .setDescription("Manage the welcome system")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName("setup").setDescription("Set up the welcome message")
            .addChannelOption(option => option.setName("channel").setDescription("Welcome channel").setRequired(true))
            .addStringOption(option => option.setName("message").setDescription("Supports {user}, {mention}, {server}, {membercount}").setMaxLength(2000))
            .addBooleanOption(option => option.setName("useai").setDescription("Use AI welcome text"))
            .addStringOption(option => option.setName("color").setDescription("Embed hex color, e.g. #5865F2"))
            .addBooleanOption(option => option.setName("thumbnail").setDescription("Show the member avatar"))
            .addStringOption(option => option.setName("image").setDescription("Embed banner URL").setMaxLength(2048))
            .addStringOption(option => option.setName("footer").setDescription("Footer text").setMaxLength(2048))
            .addBooleanOption(option => option.setName("card").setDescription("Generate a PNG welcome card"))
            .addStringOption(option => option.setName("theme").setDescription("Welcome card theme").addChoices(
                { name: "Classic", value: "classic" },
                { name: "Midnight", value: "midnight" },
                { name: "Neon", value: "neon" },
            ))
            .addStringOption(option => option.setName("background").setDescription("PNG card background URL").setMaxLength(2048))
            .addStringOption(option => option.setName("accent").setDescription("PNG card accent hex color"))
            .addStringOption(option => option.setName("media").setDescription("Fallback media URL").setMaxLength(2048)))
        .addSubcommand(sub => sub.setName("view").setDescription("View welcome configuration"))
        .addSubcommand(sub => sub.setName("preview").setDescription("Preview the welcome embed"))
        .addSubcommand(sub => sub.setName("test").setDescription("Send a live test welcome"))
        .addSubcommand(sub => sub.setName("disable").setDescription("Disable welcome messages")),
    new SlashCommandBuilder()
        .setName("autorole")
        .setDescription("Manage the role assigned to new members")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub => sub.setName("set").setDescription("Set the autorole")
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

function respond(interaction, payload, { ephemeral = true } = {}) {
    return replyInteraction(interaction, typeof payload === "string" ? { content: payload } : payload, { ephemeral })
}

async function replyError(interaction, message) {
    return respond(interaction, statusLine("error", message))
}

function ensureReason(config, reason) {
    const cleaned = typeof reason === "string" ? reason.trim() : ""
    if (cleaned) return { ok: true, reason: cleaned.slice(0, 2000) }
    if (config.requireModerationReason) return { ok: false, error: "This server requires a moderation reason." }
    return { ok: true, reason: "No reason provided" }
}

function formatDuration(durationMs) {
    if (!durationMs) return "Permanent / not applicable"
    const minutes = Math.round(durationMs / 60000)
    if (minutes % 1440 === 0) {
        const days = minutes / 1440
        return `${days} day${days === 1 ? "" : "s"}`
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60
        return `${hours} hour${hours === 1 ? "" : "s"}`
    }
    return `${minutes} minute${minutes === 1 ? "" : "s"}`
}

function caseEmbed(record) {
    const fields = [
        { name: "Action", value: record.action.replace(/_/g, " "), inline: true },
        { name: "Status", value: record.status, inline: true },
        { name: "Source", value: record.source, inline: true },
        { name: "Target", value: `<@${record.targetId}> (${record.targetTag})`, inline: false },
        { name: "Moderator", value: record.moderatorId ? `<@${record.moderatorId}> (${record.moderatorTag})` : record.moderatorTag, inline: false },
        { name: "Reason", value: record.reason.slice(0, 1024), inline: false },
    ]
    if (record.durationMs) fields.push({ name: "Duration", value: formatDuration(record.durationMs), inline: true })
    if (record.expiresAt) fields.push({ name: "Expires", value: `<t:${Math.floor(new Date(record.expiresAt).getTime() / 1000)}:R>`, inline: true })
    if (record.revokeReason) fields.push({ name: "Revocation", value: record.revokeReason.slice(0, 1024), inline: false })
    if (record.evidenceUrl) fields.push({ name: "Evidence", value: record.evidenceUrl, inline: false })
    const embed = moderationEmbed(`Case #${record.caseNumber}`, null, { fields })
    if (record.createdAt) embed.setTimestamp(new Date(record.createdAt))
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
        await respond(interaction, permissionDenied("configured moderator access"))
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
            await dmUser(target, config, `You were timed out in **${interaction.guild.name}** for ${formatDuration(durationMs)}.\nReason: ${reason}`)
            const result = await logAction(interaction.guild, {
                action: "TIMEOUT",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                durationMs,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic timeout applied${caseSuffix(result.caseRecord)}.`
        }
        if (threshold.action === "kick") {
            await dmUser(target, config, `You were kicked from **${interaction.guild.name}**.\nReason: ${reason}`)
            await safety.targetMember.kick(reason)
            const result = await logAction(interaction.guild, {
                action: "KICK",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic kick applied${caseSuffix(result.caseRecord)}.`
        }
        if (threshold.action === "ban") {
            await dmUser(target, config, `You were banned from **${interaction.guild.name}**.\nReason: ${reason}`)
            await interaction.guild.members.ban(target.id, { reason })
            const result = await logAction(interaction.guild, {
                action: "BAN",
                target: targetIdentity(target),
                moderator: actorIdentity(interaction.member),
                reason,
                source: "system",
                metadata: { warningEscalation: true, warningCount },
            })
            return `Automatic ban applied${caseSuffix(result.caseRecord)}.`
        }
    } catch (error) {
        return `Escalation failed: ${error.message}`
    }
    return null
}

async function handleCoreModeration(interaction, config) {
    const { commandName, guild, member } = interaction

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
            extra: `Active warnings: ${warnings.length}`,
        })
        await dmUser(target, config, `You were warned in **${guild.name}**.\nReason: ${reason}`)
        const escalation = await applyWarningEscalation(interaction, target, warnings.length, config)
        const fields = [
            { name: "Member", value: `<@${target.id}>`, inline: true },
            { name: "Active warnings", value: String(warnings.length), inline: true },
            { name: "Case", value: logResult.caseRecord ? `#${logResult.caseRecord.caseNumber}` : "Unavailable", inline: true },
            { name: "Reason", value: reason.slice(0, 1024), inline: false },
        ]
        if (escalation) fields.push({ name: "Escalation", value: escalation.slice(0, 1024), inline: false })
        await respond(interaction, { embeds: [moderationEmbed("Member warned", null, { fields })] })
        return true
    }

    if (commandName === "warnings") {
        const target = interaction.options.getUser("user", true)
        const warnings = getWarnings(guild.id, target.id)
        if (!warnings.length) {
            await respond(interaction, statusLine("success", `**${target.tag}** has no active warnings.`))
            return true
        }
        const lines = warnings.slice(-10).reverse().map((warning, index) => {
            const timestamp = Math.floor(new Date(warning.timestamp).getTime() / 1000)
            return `**${warnings.length - index}.** ${warning.reason}\n${warning.moderatorName} · <t:${timestamp}:d>`
        })
        await respond(interaction, { embeds: [moderationEmbed(`Warnings • ${target.tag}`, lines.join("\n\n").slice(0, 4000), {
            fields: [{ name: "Active warnings", value: String(warnings.length), inline: true }],
        })] })
        return true
    }

    if (commandName === "clearwarns") {
        const target = interaction.options.getUser("user", true)
        const reasonResult = ensureReason(config, interaction.options.getString("reason"))
        if (!reasonResult.ok) return replyError(interaction, reasonResult.error).then(() => true)
        const count = clearWarnings(guild.id, target.id, member.id)
        const logResult = await logAction(guild, {
            action: "CLEAR_WARNINGS",
            target: targetIdentity(target),
            moderator: actorIdentity(member),
            reason: reasonResult.reason,
            extra: `Cleared warnings: ${count}`,
        })
        await respond(interaction, statusLine("success", `Cleared **${count}** warning(s) for **${target.tag}**${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (["timeout", "mute"].includes(commandName)) {
        const target = interaction.options.getUser("user", true)
        const durationMinutes = interaction.options.getInteger("duration") ?? config.defaultTimeoutMinutes
        const reasonResult = ensureReason(config, interaction.options.getString("reason"))
        if (!reasonResult.ok) return replyError(interaction, reasonResult.error).then(() => true)
        const safety = await checkTarget(interaction, target, "TIMEOUT", config)
        if (!safety.ok) return true
        const durationMs = durationMinutes * 60 * 1000
        try {
            await safety.targetMember.timeout(durationMs, `${reasonResult.reason} • ${member.user.tag}`)
        } catch (error) {
            await replyError(interaction, `Could not timeout that member: ${error.message}`)
            return true
        }
        await dmUser(target, config, `You were timed out in **${guild.name}** for ${formatDuration(durationMs)}.\nReason: ${reasonResult.reason}`)
        const logResult = await logAction(guild, {
            action: "TIMEOUT",
            target: targetIdentity(target),
            moderator: actorIdentity(member),
            reason: reasonResult.reason,
            durationMs,
            extra: `Duration: ${formatDuration(durationMs)}`,
        })
        await respond(interaction, statusLine("success", `**${target.tag}** timed out for **${formatDuration(durationMs)}**${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (["untimeout", "unmute"].includes(commandName)) {
        const target = interaction.options.getUser("user", true)
        const reasonResult = ensureReason(config, interaction.options.getString("reason"))
        if (!reasonResult.ok) return replyError(interaction, reasonResult.error).then(() => true)
        const safety = await checkTarget(interaction, target, "UNTIMEOUT", config)
        if (!safety.ok) return true
        try {
            await safety.targetMember.timeout(null, `${reasonResult.reason} • ${member.user.tag}`)
        } catch (error) {
            await replyError(interaction, `Could not remove that timeout: ${error.message}`)
            return true
        }
        const logResult = await logAction(guild, {
            action: "UNTIMEOUT",
            target: targetIdentity(target),
            moderator: actorIdentity(member),
            reason: reasonResult.reason,
        })
        await respond(interaction, statusLine("success", `Timeout removed for **${target.tag}**${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (commandName === "kick") {
        const target = interaction.options.getUser("user", true)
        const reason = interaction.options.getString("reason", true).trim()
        const safety = await checkTarget(interaction, target, "KICK", config)
        if (!safety.ok) return true
        await dmUser(target, config, `You were kicked from **${guild.name}**.\nReason: ${reason}`)
        try {
            await safety.targetMember.kick(`${reason} • ${member.user.tag}`)
        } catch (error) {
            await replyError(interaction, `Could not kick that member: ${error.message}`)
            return true
        }
        const logResult = await logAction(guild, {
            action: "KICK",
            target: targetIdentity(target),
            moderator: actorIdentity(member),
            reason,
        })
        await respond(interaction, statusLine("success", `**${target.tag}** kicked${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (commandName === "ban") {
        const target = interaction.options.getUser("user", true)
        const reason = interaction.options.getString("reason", true).trim()
        const deleteDays = interaction.options.getInteger("delete_days") ?? 0
        const safety = await checkTarget(interaction, target, "BAN", config)
        if (!safety.ok) return true
        await dmUser(target, config, `You were banned from **${guild.name}**.\nReason: ${reason}`)
        try {
            await guild.members.ban(target.id, {
                reason: `${reason} • ${member.user.tag}`,
                deleteMessageSeconds: deleteDays * 24 * 60 * 60,
            })
        } catch (error) {
            await replyError(interaction, `Could not ban that user: ${error.message}`)
            return true
        }
        const logResult = await logAction(guild, {
            action: "BAN",
            target: targetIdentity(target),
            moderator: actorIdentity(member),
            reason,
            extra: deleteDays ? `Deleted ${deleteDays} day(s) of message history` : null,
        })
        await respond(interaction, statusLine("success", `**${target.tag}** banned${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (commandName === "unban") {
        const userId = interaction.options.getString("user_id", true).trim()
        if (!SNOWFLAKE.test(userId)) {
            await replyError(interaction, "Enter a valid Discord user ID.")
            return true
        }
        const reasonResult = ensureReason(config, interaction.options.getString("reason"))
        if (!reasonResult.ok) return replyError(interaction, reasonResult.error).then(() => true)
        if (!hasConfiguredModeratorRole(member, config) && !member.permissions.has(PermissionFlagsBits.BanMembers)) {
            await respond(interaction, permissionDenied("Ban Members or configured moderator access"))
            return true
        }
        if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            await respond(interaction, botPermissionMissing("Ban Members"))
            return true
        }
        const ban = await guild.bans.fetch(userId).catch(() => null)
        if (!ban) {
            await replyError(interaction, "That user is not banned in this server.")
            return true
        }
        try {
            await guild.members.unban(userId, `${reasonResult.reason} • ${member.user.tag}`)
        } catch (error) {
            await replyError(interaction, `Could not unban that user: ${error.message}`)
            return true
        }
        const logResult = await logAction(guild, {
            action: "UNBAN",
            target: { id: userId, tag: ban.user.tag },
            moderator: actorIdentity(member),
            reason: reasonResult.reason,
        })
        await respond(interaction, statusLine("success", `**${ban.user.tag}** unbanned${caseSuffix(logResult.caseRecord)}.`))
        return true
    }

    if (commandName === "case") {
        const subcommand = interaction.options.getSubcommand()
        const number = interaction.options.getInteger("number", true)
        if (subcommand === "view") {
            const record = await getCase(guild.id, number)
            if (!record) {
                await replyError(interaction, `Case #${number} was not found.`)
                return true
            }
            await respond(interaction, { embeds: [caseEmbed(record)] })
            return true
        }
        if (subcommand === "reason") {
            const record = await updateCaseReason(guild.id, number, interaction.options.getString("reason", true), actorIdentity(member))
            await respond(interaction, record
                ? statusLine("success", `Case **#${number}** reason updated.`)
                : statusLine("error", `Case #${number} was not found.`))
            return true
        }
        if (subcommand === "revoke") {
            const record = await revokeCase(guild.id, number, actorIdentity(member), interaction.options.getString("reason"))
            await respond(interaction, record
                ? statusLine("success", `Case **#${number}** marked revoked. The Discord action is unchanged.`)
                : statusLine("error", `Case #${number} was not found or is not active.`))
            return true
        }
        if (subcommand === "delete") {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await respond(interaction, permissionDenied("Manage Server"))
                return true
            }
            const record = await softDeleteCase(guild.id, number, actorIdentity(member))
            await respond(interaction, record
                ? statusLine("success", `Case **#${number}** removed from normal case views.`)
                : statusLine("error", `Case #${number} was not found.`))
            return true
        }
    }

    if (commandName === "cases") {
        const target = interaction.options.getUser("user")
        const action = interaction.options.getString("action")
        const limit = interaction.options.getInteger("limit") ?? 10
        const records = await listCases(guild.id, { targetId: target?.id, action, limit })
        if (!records.length) {
            await respond(interaction, "No matching moderation cases were found.")
            return true
        }
        const lines = records.map(record => {
            const timestamp = record.createdAt ? Math.floor(new Date(record.createdAt).getTime() / 1000) : null
            return `**#${record.caseNumber} · ${record.action.replace(/_/g, " ")}** · <@${record.targetId}>\n${record.reason.slice(0, 180)}${timestamp ? ` · <t:${timestamp}:R>` : ""} · ${record.status}`
        })
        await respond(interaction, { embeds: [moderationEmbed("Recent moderation cases", lines.join("\n\n").slice(0, 4000), {
            fields: [{ name: "Cases shown", value: String(records.length), inline: true }],
        })] })
        return true
    }

    return false
}

function validateHttpUrl(value) {
    if (!value) return true
    try {
        const url = new URL(value)
        return ["http:", "https:"].includes(url.protocol)
    } catch {
        return false
    }
}

async function handleWelcome(interaction) {
    const { guild, member } = interaction
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await respond(interaction, permissionDenied("Manage Server"))
        return true
    }

    const subcommand = interaction.options.getSubcommand()
    if (subcommand === "setup") {
        const channel = interaction.options.getChannel("channel", true)
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            await replyError(interaction, "Choose a text or announcement channel.")
            return true
        }
        const color = interaction.options.getString("color")
        const accent = interaction.options.getString("accent")
        if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            await replyError(interaction, "Embed color must be a six-digit hex color.")
            return true
        }
        if (accent && !/^#?[0-9A-Fa-f]{6}$/.test(accent)) {
            await replyError(interaction, "Accent color must be a six-digit hex color.")
            return true
        }
        for (const [label, value] of [
            ["image", interaction.options.getString("image")],
            ["background", interaction.options.getString("background")],
            ["media", interaction.options.getString("media")],
        ]) {
            if (!validateHttpUrl(value)) {
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
        await respond(interaction, statusLine("success", `Welcome messages enabled in <#${channel.id}>.`))
        return true
    }

    const config = getWelcome(guild.id)
    if (subcommand === "view") {
        await respond(interaction, { embeds: [adminEmbed("Welcome configuration", null, {
            fields: [
                { name: "Status", value: config.welcomeEnabled && config.welcomeChannelId ? "Enabled" : "Disabled", inline: true },
                { name: "Channel", value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : "Not selected", inline: true },
                { name: "AI", value: config.welcomeUseAI ? "Enabled" : "Disabled", inline: true },
                { name: "Card", value: config.welcomeCardEnabled ? config.welcomeCardTheme : "Disabled", inline: true },
                { name: "Message", value: (config.welcomeMessage || "Built-in default").slice(0, 1024), inline: false },
            ],
            footer: "CURSED • Welcome",
        })] })
        return true
    }
    if (subcommand === "preview") {
        if (!config.welcomeChannelId) {
            await replyError(interaction, "Configure a welcome channel first.")
            return true
        }
        await respond(interaction, { content: "Welcome preview", embeds: [buildPreviewEmbed(config, member)] })
        return true
    }
    if (subcommand === "test") {
        if (!config.welcomeChannelId) {
            await replyError(interaction, "Configure a welcome channel first.")
            return true
        }
        await interaction.deferReply({ ephemeral: true })
        const channel = await guild.channels.fetch(config.welcomeChannelId).catch(() => null)
        if (!channel?.isTextBased()) {
            await interaction.editReply(statusLine("error", "The configured welcome channel is unavailable."))
            return true
        }
        const { callAI } = require("../utils/ai")
        await testWelcome(channel, config, callAI, member)
        await interaction.editReply(statusLine("success", `Test welcome sent to <#${config.welcomeChannelId}>.`))
        return true
    }
    if (subcommand === "disable") {
        disableWelcome(guild.id)
        await respond(interaction, statusLine("success", "Welcome messages disabled. No fallback welcome will be sent."))
        return true
    }
    return false
}

async function handleAutorole(interaction) {
    const { guild, member } = interaction
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await respond(interaction, permissionDenied("Manage Roles"))
        return true
    }
    const subcommand = interaction.options.getSubcommand()
    if (subcommand === "set") {
        const role = interaction.options.getRole("role", true)
        const botMember = guild.members.me
        if (role.managed) {
            await replyError(interaction, "Integration-managed roles cannot be used as autoroles.")
            return true
        }
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await respond(interaction, botPermissionMissing("Manage Roles"))
            return true
        }
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
            await replyError(interaction, "Move CURSED's highest role above the selected role.")
            return true
        }
        setAutorole(guild.id, role.id, role.name)
        await respond(interaction, statusLine("success", `New members will receive **${role.name}**.`))
        return true
    }
    if (subcommand === "disable") {
        disableAutorole(guild.id)
        await respond(interaction, statusLine("success", "Autorole disabled."))
        return true
    }
    if (subcommand === "view") {
        const config = getAutorole(guild.id)
        await respond(interaction, config.autoroleId
            ? statusLine("success", `Autorole: <@&${config.autoroleId}>`)
            : statusLine("warning", "Autorole is disabled."))
        return true
    }
    return false
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.guild) return false
    const { commandName, guild } = interaction

    try {
        if (MODERATION_COMMANDS.has(commandName)) {
            const config = getModerationConfig(guild.id)
            if (!await authorizeModeration(interaction, config)) return true
            return handleCoreModeration(interaction, config)
        }
        if (commandName === "welcome") return handleWelcome(interaction)
        if (commandName === "autorole") return handleAutorole(interaction)
        return false
    } catch (error) {
        await replyError(interaction, `Command failed safely: ${error.message}`).catch(() => {})
        return true
    }
}

async function handlePrefixCommand(message) {
    const msgLower = message.content.toLowerCase().trim()
    const { guild, member } = message
    if (!guild || !member) return false
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator)

    const send = content => message.channel.send({ content, allowedMentions: SAFE_MENTIONS })

    if (msgLower === "!setmodlog") {
        if (!isAdmin) {
            await send(permissionDenied("Administrator"))
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        config.modLogChannelId = message.channel.id
        saveConfig(data)
        await send(statusLine("success", `Moderation logs will be sent to <#${message.channel.id}>.`))
        return true
    }

    for (const [prefix, key, label] of [
        ["!antispam ", "antiSpam", "Anti-Spam"],
        ["!antilink ", "antiLink", "Anti-Link"],
        ["!antiinvite ", "antiInvite", "Anti-Invite"],
    ]) {
        if (!msgLower.startsWith(prefix)) continue
        if (!isAdmin) {
            await send(permissionDenied("Administrator"))
            return true
        }
        const value = msgLower.slice(prefix.length).trim()
        if (!["on", "off"].includes(value)) {
            await send(invalidUsage(`${prefix.trim()} on|off`))
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        config[key] = value === "on"
        saveConfig(data)
        await send(statusLine("success", `${label} ${value === "on" ? "enabled" : "disabled"}.`))
        return true
    }

    if (msgLower.startsWith("!whitelist ")) {
        if (!isAdmin) {
            await send(permissionDenied("Administrator"))
            return true
        }
        const parts = message.content.trim().split(/\s+/)
        const subcommand = parts[1]?.toLowerCase()
        const domain = parts[2]?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
        if (!["add", "remove"].includes(subcommand) || !domain) {
            await send(statusLine("warning", "Usage: `!whitelist add <domain>` or `!whitelist remove <domain>`."))
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        if (!Array.isArray(config.linkWhitelist)) config.linkWhitelist = []
        if (subcommand === "add" && !config.linkWhitelist.includes(domain)) config.linkWhitelist.push(domain)
        if (subcommand === "remove") config.linkWhitelist = config.linkWhitelist.filter(item => item !== domain)
        saveConfig(data)
        await send(statusLine("success", `**${domain}** ${subcommand === "add" ? "added to" : "removed from"} the link whitelist.`))
        return true
    }

    return false
}

module.exports = { commands, handleInteraction, handlePrefixCommand }
