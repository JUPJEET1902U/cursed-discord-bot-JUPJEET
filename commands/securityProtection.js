const {
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js")
const { getModerationConfig, isModerator } = require("../utils/moderationConfig")
const { getSecurityPhase3Config, isTrustedForScope } = require("../utils/securityPhase3Config")
const { quarantineMember, releaseQuarantine, getActiveQuarantineCount } = require("../utils/quarantineState")
const { enableEmergencyLockdown, disableEmergencyLockdown, getLockdownStatus } = require("../utils/lockdownState")
const { getSecurityIncidentStats } = require("../utils/securityIncidents")
const { logAction } = require("../utils/modlog")

const COMMAND_NAMES = new Set(["quarantine", "unquarantine", "lockdown", "security-status"])

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
        .setDescription("Show CURSED anti-raid, anti-nuke, quarantine, and lockdown status")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
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
    return { ok: true, handled: true, moderation, security }
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
        await safeReply(interaction, { content: `❌ ${result.error}`, ephemeral: true })
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
    await safeReply(interaction, {
        content: `🛡️ **${user.tag}** was quarantined safely${log.caseRecord ? ` • Case #${log.caseRecord.caseNumber}` : ""}.`,
        ephemeral: true,
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
        await safeReply(interaction, { content: `❌ ${result.error}`, ephemeral: true })
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
    await safeReply(interaction, {
        content: `✅ **${user.tag}** was released from quarantine${log.caseRecord ? ` • Case #${log.caseRecord.caseNumber}` : ""}.${missing}`,
        ephemeral: true,
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
            await safeReply(interaction, { content: "❌ Emergency lockdown is disabled in dashboard settings.", ephemeral: true })
            return true
        }
        const result = await enableEmergencyLockdown(interaction.guild, guardResult.security, { reason, actor: actor(interaction) })
        if (!result.ok) {
            await safeReply(interaction, { content: `❌ ${result.error}`, ephemeral: true })
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
        await safeReply(interaction, { content: `🔒 Emergency lockdown enabled for **${result.affectedChannels}** channel(s).`, ephemeral: true })
        return true
    }
    const result = await disableEmergencyLockdown(interaction.guild, { reason, actor: actor(interaction) })
    if (!result.ok) {
        await safeReply(interaction, { content: `❌ ${result.error}`, ephemeral: true })
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
    await safeReply(interaction, { content: "🔓 Emergency lockdown ended. Saved channel permissions were restored.", ephemeral: true })
    return true
}

async function handleStatus(interaction, security) {
    const [stats, lockdown, quarantined] = await Promise.all([
        getSecurityIncidentStats(interaction.guildId),
        getLockdownStatus(interaction.guildId),
        getActiveQuarantineCount(interaction.guildId),
    ])
    const embed = new EmbedBuilder()
        .setColor(security.enabled ? 0x57F287 : 0x99AABB)
        .setTitle("🛡️ CURSED Server Protection")
        .addFields(
            { name: "Master protection", value: security.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Anti-raid", value: security.antiRaid.enabled ? `${security.antiRaid.joinThreshold} joins / ${security.antiRaid.windowSeconds}s` : "Disabled", inline: true },
            { name: "Anti-nuke", value: security.antiNuke.enabled ? `Enabled • ${security.antiNuke.action}` : "Disabled", inline: true },
            { name: "Lockdown", value: lockdown.active ? "Active" : "Inactive", inline: true },
            { name: "Quarantined", value: String(quarantined), inline: true },
            { name: "Open incidents", value: stats.available ? String(stats.open) : "Unavailable", inline: true },
        )
        .setTimestamp()
    await safeReply(interaction, { embeds: [embed], ephemeral: true })
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
    if (interaction.commandName === "security-status") {
        const result = await guard(interaction, { requireSecurityEnabled: false })
        if (!result.ok) return result.handled
        return handleStatus(interaction, result.security)
    }
    return false
}

module.exports = {
    commands,
    handleInteraction,
    COMMAND_NAMES,
}
