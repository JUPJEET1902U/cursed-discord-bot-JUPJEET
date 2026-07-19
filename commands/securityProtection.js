const {
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js")
const { getModerationConfig, isModerator } = require("../utils/moderationConfig")
const { getSecurityPhase3Config, isTrustedForScope } = require("../utils/securityPhase3Config")
const { getFortressConfig } = require("../utils/fortressConfig")
const { quarantineMember, releaseQuarantine, getActiveQuarantineCount } = require("../utils/quarantineState")
const { enableEmergencyLockdown, disableEmergencyLockdown, getLockdownStatus } = require("../utils/lockdownState")
const { getSecurityIncidentStats } = require("../utils/securityIncidents")
const { captureGuildSnapshot, listGuildSnapshots, restoreGuildSnapshot } = require("../utils/securitySnapshots")
const { evaluateSecurityHealth } = require("../utils/securityHealth")
const { logAction } = require("../utils/modlog")

const COMMAND_NAMES = new Set([
    "quarantine",
    "unquarantine",
    "lockdown",
    "security-status",
    "panic",
    "security-check",
    "security-snapshot",
])

const commands = [
    new SlashCommandBuilder()
        .setName("quarantine")
        .setDescription("Isolate a member and safely preserve their restorable roles")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(option => option.setName("user").setDescription("Member to quarantine").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for quarantine").setRequired(true).setMaxLength(1000)),
    new SlashCommandBuilder()
        .setName("unquarantine")
        .setDescription("Release a quarantined member and restore saved roles")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(option => option.setName("user").setDescription("Member to release").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for release").setMaxLength(1000)),
    new SlashCommandBuilder()
        .setName("lockdown")
        .setDescription("Control CURSED emergency server lockdown")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(option => option
            .setName("enable")
            .setDescription("Lock configured public channels and preserve their permissions")
            .addStringOption(input => input.setName("reason").setDescription("Reason for lockdown").setRequired(true).setMaxLength(1000)))
        .addSubcommand(option => option
            .setName("disable")
            .setDescription("Restore the exact saved channel permissions")
            .addStringOption(input => input.setName("reason").setDescription("Reason for ending lockdown").setMaxLength(1000)))
        .addSubcommand(option => option.setName("status").setDescription("Show current lockdown state")),
    new SlashCommandBuilder()
        .setName("security-status")
        .setDescription("Show CURSED anti-raid, anti-nuke, Fortress, quarantine, and lockdown status")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
        .setName("panic")
        .setDescription("Immediately seal or release the server during an active attack")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(option => option
            .setName("enable")
            .setDescription("Create a recovery snapshot and immediately lock the server")
            .addStringOption(input => input.setName("reason").setDescription("Reason for panic mode").setRequired(true).setMaxLength(1000)))
        .addSubcommand(option => option
            .setName("disable")
            .setDescription("Release panic mode and restore saved channel permissions")
            .addStringOption(input => input.setName("reason").setDescription("Reason for release").setMaxLength(1000)))
        .addSubcommand(option => option.setName("status").setDescription("Show panic and lockdown status")),
    new SlashCommandBuilder()
        .setName("security-check")
        .setDescription("Audit CURSED permissions, hierarchy, recovery, and protection readiness")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName("security-snapshot")
        .setDescription("Create, list, or restore structural security snapshots")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(option => option
            .setName("create")
            .setDescription("Create a manual server structure snapshot")
            .addStringOption(input => input.setName("reason").setDescription("Snapshot label").setMaxLength(500)))
        .addSubcommand(option => option.setName("list").setDescription("List recent security snapshots"))
        .addSubcommand(option => option
            .setName("restore")
            .setDescription("Recreate missing roles and channels from a snapshot")
            .addStringOption(input => input.setName("snapshot_id").setDescription("Snapshot ID from the list").setRequired(true).setMaxLength(32))
            .addBooleanOption(input => input.setName("confirm").setDescription("Confirm structural restoration").setRequired(true))
            .addStringOption(input => input.setName("reason").setDescription("Restore reason").setMaxLength(500))),
]

function safeReply(interaction, payload) {
    const body = {
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
        ...payload,
    }
    return interaction.replied || interaction.deferred
        ? interaction.followUp(body)
        : interaction.reply(body)
}

function actor(interaction) {
    return { id: interaction.user.id, tag: interaction.user.tag || interaction.user.username }
}

function target(user) {
    return { id: user.id, tag: user.tag || user.username }
}

async function guard(interaction, { requireSecurityEnabled = true, permission = null } = {}) {
    if (!interaction.inGuild() || !interaction.isChatInputCommand()) return { ok: false, handled: false }
    const moderation = getModerationConfig(interaction.guildId)
    const security = getSecurityPhase3Config(interaction.guildId)
    const fortress = getFortressConfig(interaction.guildId)
    if (!moderation.moderationCommandsEnabled) {
        await safeReply(interaction, { content: "⛔ Moderation is disabled in this server.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (requireSecurityEnabled && !security.enabled) {
        await safeReply(interaction, { content: "⛔ Server Protection is disabled. Enable it from the dashboard first.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (!isModerator(interaction.member, moderation)) {
        await safeReply(interaction, { content: "❌ You are not authorized to use CURSED security commands.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (permission && !interaction.memberPermissions?.has(permission)) {
        await safeReply(interaction, { content: "❌ You do not have the Discord permission required for that action.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (permission && !interaction.guild.members.me?.permissions.has(permission)) {
        await safeReply(interaction, { content: "❌ CURSED does not have the Discord permission required for that action.", ephemeral: true })
        return { ok: false, handled: true }
    }
    return { ok: true, handled: true, moderation, security, fortress }
}

async function validateQuarantineTarget(interaction, user, security) {
    const guild = interaction.guild
    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null)
    if (!member) return { ok: false, error: "That user is not currently in this server." }
    if (user.id === interaction.user.id) return { ok: false, error: "You cannot quarantine yourself." }
    if (user.id === guild.ownerId) return { ok: false, error: "The server owner cannot be quarantined." }
    if (user.id === guild.members.me?.id) return { ok: false, error: "CURSED cannot quarantine itself." }
    if (!member.manageable) return { ok: false, error: "Discord role hierarchy prevents CURSED from managing that member." }
    const actorIsOwner = interaction.user.id === guild.ownerId
    if (!actorIsOwner && interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        return { ok: false, error: "That member's highest role is equal to or above yours." }
    }
    if (!actorIsOwner && isTrustedForScope({
        guildId: guild.id,
        member,
        userId: member.id,
        isBot: member.user.bot,
        scope: "manualModeration",
    })) {
        return { ok: false, error: "That member is protected by the granular security whitelist. Only the server owner can override it." }
    }
    if (!security.quarantine.enabled) return { ok: false, error: "Quarantine is disabled in Server Protection settings." }
    return { ok: true, member }
}

async function handleQuarantine(interaction, guardResult) {
    const user = interaction.options.getUser("user", true)
    const reason = interaction.options.getString("reason", true).trim()
    const validation = await validateQuarantineTarget(interaction, user, guardResult.security)
    if (!validation.ok) {
        await safeReply(interaction, { content: `❌ ${validation.error}`, ephemeral: true })
        return true
    }
    await interaction.deferReply({ ephemeral: true })
    const result = await quarantineMember(interaction.guild, validation.member, guardResult.security, {
        reason,
        moderator: actor(interaction),
    })
    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
        return true
    }
    const log = await logAction(interaction.guild, {
        action: "QUARANTINE",
        target: target(user),
        moderator: actor(interaction),
        reason,
        source: "manual",
        metadata: { originalRoleIds: result.state.originalRoleIds || [] },
    })
    await interaction.editReply({
        content: `🛡️ **${user.tag}** was quarantined safely${log.caseRecord ? ` • Case #${log.caseRecord.caseNumber}` : ""}.`,
        allowedMentions: { parse: [] },
    })
    return true
}

async function handleUnquarantine(interaction) {
    const user = interaction.options.getUser("user", true)
    const reason = interaction.options.getString("reason")?.trim() || "Quarantine released"
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null)
    if (!member) {
        await safeReply(interaction, { content: "❌ That user is not currently in this server.", ephemeral: true })
        return true
    }
    await interaction.deferReply({ ephemeral: true })
    const result = await releaseQuarantine(interaction.guild, member, { reason, moderator: actor(interaction) })
    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
        return true
    }
    const log = await logAction(interaction.guild, {
        action: "UNQUARANTINE",
        target: target(user),
        moderator: actor(interaction),
        reason,
        source: "manual",
        metadata: { missingRoleIds: result.missingRoleIds || [] },
    })
    const missing = result.missingRoleIds?.length ? ` ${result.missingRoleIds.length} deleted or unmanageable role(s) could not be restored.` : ""
    await interaction.editReply({
        content: `✅ **${user.tag}** was released from quarantine${log.caseRecord ? ` • Case #${log.caseRecord.caseNumber}` : ""}.${missing}`,
        allowedMentions: { parse: [] },
    })
    return true
}

async function handleLockdown(interaction, guardResult) {
    const subcommand = interaction.options.getSubcommand(true)
    if (subcommand === "status") {
        const state = await getLockdownStatus(interaction.guildId)
        await safeReply(interaction, {
            content: state.active
                ? `🔒 Emergency lockdown is **active** across **${state.snapshots?.length || 0}** saved channel(s).`
                : `🔓 Emergency lockdown is **not active**. Last state: **${state.status || "inactive"}**.`,
            ephemeral: true,
        })
        return true
    }
    const reason = interaction.options.getString("reason")?.trim()
        || (subcommand === "enable" ? "Emergency security lockdown" : "Emergency lockdown released")
    await interaction.deferReply({ ephemeral: true })
    if (subcommand === "enable") {
        if (!guardResult.security.lockdown.enabled) {
            await interaction.editReply({ content: "❌ Emergency lockdown is disabled in dashboard settings.", allowedMentions: { parse: [] } })
            return true
        }
        const result = await enableEmergencyLockdown(interaction.guild, guardResult.security, { reason, actor: actor(interaction) })
        if (!result.ok) {
            await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
            return true
        }
        await logAction(interaction.guild, {
            action: "LOCKDOWN_ENABLE",
            target: { id: interaction.guildId, tag: interaction.guild.name },
            moderator: actor(interaction),
            reason,
            source: "manual",
            metadata: { affectedChannels: result.affectedChannels },
        })
        await interaction.editReply({ content: `🔒 Emergency lockdown enabled for **${result.affectedChannels}** channel(s).`, allowedMentions: { parse: [] } })
        return true
    }
    const result = await disableEmergencyLockdown(interaction.guild, { reason, actor: actor(interaction) })
    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
        return true
    }
    await logAction(interaction.guild, {
        action: "LOCKDOWN_DISABLE",
        target: { id: interaction.guildId, tag: interaction.guild.name },
        moderator: actor(interaction),
        reason,
        source: "manual",
        metadata: { missingChannelIds: result.missingChannelIds || [] },
    })
    await interaction.editReply({ content: "🔓 Emergency lockdown ended. Saved channel permissions were restored.", allowedMentions: { parse: [] } })
    return true
}

async function handlePanic(interaction, guardResult) {
    const subcommand = interaction.options.getSubcommand(true)
    if (subcommand === "status") return handleLockdown(interaction, guardResult)

    const reason = interaction.options.getString("reason")?.trim()
        || (subcommand === "enable" ? "Manual Fortress panic mode" : "Manual Fortress panic release")
    await interaction.deferReply({ ephemeral: true })

    if (subcommand === "disable") {
        const result = await disableEmergencyLockdown(interaction.guild, { reason, actor: actor(interaction) })
        if (!result.ok) {
            await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
            return true
        }
        await logAction(interaction.guild, {
            action: "PANIC_DISABLE",
            target: { id: interaction.guildId, tag: interaction.guild.name },
            moderator: actor(interaction),
            reason,
            source: "manual",
        })
        await interaction.editReply({ content: "🔓 Panic mode ended and saved channel permissions were restored.", allowedMentions: { parse: [] } })
        return true
    }

    if (!guardResult.fortress.panic.enabled) {
        await interaction.editReply({ content: "❌ Fortress panic mode is disabled in dashboard settings.", allowedMentions: { parse: [] } })
        return true
    }

    let snapshotNote = "Snapshot skipped."
    if (guardResult.fortress.backups.enabled) {
        const snapshot = await captureGuildSnapshot(interaction.guild, {
            reason: `Pre-panic snapshot: ${reason}`,
            actor: actor(interaction),
            maxSnapshots: guardResult.fortress.backups.maxSnapshots,
        })
        snapshotNote = snapshot.ok ? `Snapshot \`${snapshot.snapshot.snapshotId}\` created.` : `Snapshot failed: ${snapshot.error}`
    }

    const result = await enableEmergencyLockdown(interaction.guild, guardResult.security, { reason, actor: actor(interaction) })
    if (!result.ok) {
        await interaction.editReply({ content: `❌ Panic mode could not lock the server: ${result.error}\n${snapshotNote}`, allowedMentions: { parse: [] } })
        return true
    }
    await logAction(interaction.guild, {
        action: "PANIC_ENABLE",
        target: { id: interaction.guildId, tag: interaction.guild.name },
        moderator: actor(interaction),
        reason,
        source: "manual",
        metadata: { affectedChannels: result.affectedChannels, snapshotNote },
    })
    await interaction.editReply({
        content: `🚨 **PANIC MODE ACTIVE** • ${result.affectedChannels} channel(s) locked. ${snapshotNote}`,
        allowedMentions: { parse: [] },
    })
    return true
}

async function handleStatus(interaction, security, fortress) {
    const [stats, lockdown, quarantined, health] = await Promise.all([
        getSecurityIncidentStats(interaction.guildId),
        getLockdownStatus(interaction.guildId),
        getActiveQuarantineCount(interaction.guildId),
        evaluateSecurityHealth(interaction.guild),
    ])
    const embed = new EmbedBuilder()
        .setColor(health.score >= 90 ? 0x57F287 : health.score >= 70 ? 0xFEE75C : 0xED4245)
        .setTitle("🛡️ CURSED Fortress Status")
        .addFields(
            { name: "Readiness", value: `**${health.score}/100** • ${health.status}`, inline: true },
            { name: "Master protection", value: security.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Fortress", value: fortress.enabled ? `${fortress.mode} mode` : "Disabled", inline: true },
            { name: "Anti-raid", value: security.antiRaid.enabled ? `${security.antiRaid.joinThreshold} joins / ${security.antiRaid.windowSeconds}s` : "Disabled", inline: true },
            { name: "Anti-nuke", value: security.antiNuke.enabled ? `Enabled • rollback ${fortress.rollback.enabled ? "on" : "off"}` : "Disabled", inline: true },
            { name: "Heat AutoMod", value: fortress.automod.enabled ? (fortress.automod.dryRun ? "Monitor only" : "Active") : "Disabled", inline: true },
            { name: "Lockdown", value: lockdown.active ? "Active" : "Inactive", inline: true },
            { name: "Quarantined", value: String(quarantined), inline: true },
            { name: "Open incidents", value: stats.available ? String(stats.open) : "Unavailable", inline: true },
        )
        .setFooter({ text: health.issues.length ? `${health.issues.length} readiness issue(s) • run /security-check` : "No readiness issues detected" })
        .setTimestamp()
    await safeReply(interaction, { embeds: [embed], ephemeral: true })
    return true
}

async function handleSecurityCheck(interaction) {
    await interaction.deferReply({ ephemeral: true })
    const health = await evaluateSecurityHealth(interaction.guild)
    const issues = health.issues.slice(0, 10).map(item =>
        `**${item.severity.toUpperCase()} • ${item.title}**\n${item.detail}\nFix: ${item.fix}`
    ).join("\n\n")
    const embed = new EmbedBuilder()
        .setColor(health.score >= 90 ? 0x57F287 : health.score >= 70 ? 0xFEE75C : 0xED4245)
        .setTitle(`🩺 Security Readiness: ${health.score}/100`)
        .setDescription(issues || "✅ CURSED passed the current permission, hierarchy, persistence, quarantine, lockdown, and recovery checks.")
        .setFooter({ text: health.issues.length > 10 ? `${health.issues.length - 10} additional issue(s) are available in the dashboard.` : "CURSED Fortress preflight" })
        .setTimestamp()
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } })
    return true
}

async function handleSnapshot(interaction, guardResult) {
    const subcommand = interaction.options.getSubcommand(true)
    await interaction.deferReply({ ephemeral: true })

    if (subcommand === "create") {
        const reason = interaction.options.getString("reason")?.trim() || "Manual security snapshot"
        const result = await captureGuildSnapshot(interaction.guild, {
            reason,
            actor: actor(interaction),
            maxSnapshots: guardResult.fortress.backups.maxSnapshots,
        })
        if (!result.ok) {
            await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
            return true
        }
        await interaction.editReply({
            content: `✅ Structural snapshot created: \`${result.snapshot.snapshotId}\` • ${result.snapshot.stats.roleCount} roles • ${result.snapshot.stats.channelCount} channels.`,
            allowedMentions: { parse: [] },
        })
        return true
    }

    if (subcommand === "list") {
        const snapshots = await listGuildSnapshots(interaction.guildId, 10)
        if (!snapshots.length) {
            await interaction.editReply({ content: "No security snapshots are stored for this server.", allowedMentions: { parse: [] } })
            return true
        }
        const description = snapshots.map(item =>
            `• \`${item.snapshotId}\` • <t:${Math.floor(new Date(item.createdAt).getTime() / 1000)}:R> • ${item.stats?.roleCount || 0} roles / ${item.stats?.channelCount || 0} channels\n  ${String(item.reason || "Snapshot").slice(0, 120)}`
        ).join("\n")
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x7C3AED).setTitle("Fortress Snapshots").setDescription(description).setFooter({ text: "Snapshots restore structure, not deleted message history." })],
            allowedMentions: { parse: [] },
        })
        return true
    }

    const confirmed = interaction.options.getBoolean("confirm", true)
    if (!confirmed) {
        await interaction.editReply({ content: "Restore cancelled because confirmation was false.", allowedMentions: { parse: [] } })
        return true
    }
    const snapshotId = interaction.options.getString("snapshot_id", true).trim()
    const reason = interaction.options.getString("reason")?.trim() || `Manual restore from ${snapshotId}`
    const result = await restoreGuildSnapshot(interaction.guild, snapshotId, { reason, actor: actor(interaction) })
    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}`, allowedMentions: { parse: [] } })
        return true
    }
    await logAction(interaction.guild, {
        action: "SECURITY_SNAPSHOT_RESTORE",
        target: { id: interaction.guildId, tag: interaction.guild.name },
        moderator: actor(interaction),
        reason,
        source: "manual",
        metadata: { snapshotId, rolesCreated: result.rolesCreated, channelsCreated: result.channelsCreated, warnings: result.warnings },
    })
    await interaction.editReply({
        content: `✅ Snapshot \`${snapshotId}\` restore completed • **${result.rolesCreated}** role(s) and **${result.channelsCreated}** channel(s) recreated. Warnings: **${result.warnings.length}**. Deleted message history cannot be restored by Discord.`,
        allowedMentions: { parse: [] },
    })
    return true
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !COMMAND_NAMES.has(interaction.commandName)) return false

    if (interaction.commandName === "quarantine") {
        const result = await guard(interaction, { permission: PermissionFlagsBits.ManageRoles })
        if (!result.ok) return result.handled
        return handleQuarantine(interaction, result)
    }
    if (interaction.commandName === "unquarantine") {
        const result = await guard(interaction, { permission: PermissionFlagsBits.ManageRoles })
        if (!result.ok) return result.handled
        return handleUnquarantine(interaction)
    }
    if (interaction.commandName === "lockdown") {
        const result = await guard(interaction, { permission: PermissionFlagsBits.ManageGuild })
        if (!result.ok) return result.handled
        return handleLockdown(interaction, result)
    }
    if (interaction.commandName === "panic") {
        const result = await guard(interaction, { permission: PermissionFlagsBits.ManageGuild })
        if (!result.ok) return result.handled
        return handlePanic(interaction, result)
    }
    if (interaction.commandName === "security-status") {
        const result = await guard(interaction, { requireSecurityEnabled: false })
        if (!result.ok) return result.handled
        return handleStatus(interaction, result.security, result.fortress)
    }
    if (interaction.commandName === "security-check") {
        const result = await guard(interaction, { requireSecurityEnabled: false, permission: PermissionFlagsBits.ManageGuild })
        if (!result.ok) return result.handled
        return handleSecurityCheck(interaction)
    }
    if (interaction.commandName === "security-snapshot") {
        const result = await guard(interaction, { permission: PermissionFlagsBits.ManageGuild })
        if (!result.ok) return result.handled
        return handleSnapshot(interaction, result)
    }
    return false
}

module.exports = {
    commands,
    handleInteraction,
    COMMAND_NAMES,
}
