const {
    AttachmentBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js")
const { getModerationConfig, isModerator } = require("../utils/moderationConfig")
const { getSecurityPhase3Config } = require("../utils/securityPhase3Config")
const { COLORS, statusLine } = require("../utils/responseBuilder")
const {
    createSecuritySnapshot,
    listSecuritySnapshots,
    restoreSecuritySnapshot,
    approveBot,
    listBotApprovals,
    revokeBotApproval,
    getIncidentModeState,
    setIncidentMode,
    runSecurityHealthAudit,
    buildIncidentReport,
} = require("../utils/securityRecoverySuite")

const COMMAND_NAMES = new Set(["security"])

const commands = [
    new SlashCommandBuilder()
        .setName("security")
        .setDescription("Manage server protection, recovery, and incident controls")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommandGroup(group => group
            .setName("backup")
            .setDescription("Create and restore server security snapshots")
            .addSubcommand(command => command
                .setName("create")
                .setDescription("Create a security snapshot now")
                .addStringOption(option => option.setName("reason").setDescription("Snapshot reason").setMaxLength(500)))
            .addSubcommand(command => command
                .setName("list")
                .setDescription("List recent security snapshots"))
            .addSubcommand(command => command
                .setName("restore")
                .setDescription("Restore missing channels, roles, and safe server settings")
                .addStringOption(option => option.setName("snapshot_id").setDescription("Snapshot ID from /security backup list").setRequired(true))
                .addStringOption(option => option.setName("reason").setDescription("Restore reason").setMaxLength(500))))
        .addSubcommandGroup(group => group
            .setName("approval")
            .setDescription("Manage temporary bot approvals")
            .addSubcommand(command => command
                .setName("add")
                .setDescription("Approve a bot ID for one addition")
                .addStringOption(option => option.setName("bot_id").setDescription("Discord application or bot ID").setRequired(true))
                .addIntegerOption(option => option.setName("minutes").setDescription("Approval lifetime").setMinValue(1).setMaxValue(1440))
                .addStringOption(option => option.setName("note").setDescription("Reason for this approval").setMaxLength(500)))
            .addSubcommand(command => command.setName("list").setDescription("List recent bot approvals"))
            .addSubcommand(command => command
                .setName("revoke")
                .setDescription("Revoke a bot approval")
                .addStringOption(option => option.setName("approval_id").setDescription("Approval ID").setRequired(true))))
        .addSubcommandGroup(group => group
            .setName("incident")
            .setDescription("Control emergency incident mode")
            .addSubcommand(command => command
                .setName("enable")
                .setDescription("Enable incident mode and configured emergency responses")
                .addStringOption(option => option.setName("reason").setDescription("Incident reason").setRequired(true).setMaxLength(1000))
                .addIntegerOption(option => option.setName("minutes").setDescription("Duration").setMinValue(5).setMaxValue(1440)))
            .addSubcommand(command => command
                .setName("disable")
                .setDescription("End incident mode")
                .addStringOption(option => option.setName("reason").setDescription("Reason for ending incident mode").setMaxLength(1000)))
            .addSubcommand(command => command.setName("status").setDescription("Show current incident mode state")))
        .addSubcommand(command => command
            .setName("audit")
            .setDescription("Run a server protection health audit"))
        .addSubcommand(command => command
            .setName("report")
            .setDescription("Download an incident timeline report")
            .addStringOption(option => option.setName("incident_id").setDescription("Optional incident ID to focus the timeline"))
            .addStringOption(option => option
                .setName("format")
                .setDescription("Report format")
                .addChoices({ name: "HTML", value: "html" }, { name: "JSON", value: "json" }))),
]

function actor(interaction) {
    return { id: interaction.user.id, tag: interaction.user.tag || interaction.user.username }
}

async function safeReply(interaction, payload) {
    const body = { allowedMentions: { parse: [] }, ephemeral: true, ...payload }
    return interaction.replied || interaction.deferred ? interaction.followUp(body) : interaction.reply(body)
}

async function guard(interaction, { ownerOnly = false } = {}) {
    if (!interaction.inGuild() || !interaction.isChatInputCommand()) return { ok: false, handled: false }
    const moderation = getModerationConfig(interaction.guildId)
    if (!moderation.moderationCommandsEnabled) {
        await safeReply(interaction, { content: statusLine("error", "Moderation is disabled in this server.") })
        return { ok: false, handled: true }
    }
    if (!isModerator(interaction.member, moderation) || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await safeReply(interaction, { content: statusLine("error", "You need moderation access and Manage Server to use this command.") })
        return { ok: false, handled: true }
    }
    if (ownerOnly && interaction.user.id !== interaction.guild.ownerId) {
        await safeReply(interaction, { content: statusLine("error", "Only the server owner can perform this action.") })
        return { ok: false, handled: true }
    }
    return { ok: true, handled: true, config: getSecurityPhase3Config(interaction.guildId) }
}

function snapshotsEmbed(guild, snapshots) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("Security snapshots")
        .setDescription(snapshots.length ? "Recent recovery points for this server." : "No security snapshots are available yet.")
        .setFooter({ text: `CURSED • ${guild.name}` })
        .setTimestamp()
    if (snapshots.length) embed.addFields(snapshots.slice(0, 10).map(snapshot => ({
        name: snapshot.name,
        value: `ID: \`${snapshot.id}\`\n${snapshot.roleCount} roles • ${snapshot.channelCount} channels • ${snapshot.status}`,
        inline: false,
    })))
    return embed
}

function approvalsEmbed(approvals) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("Bot approvals")
        .setDescription(approvals.length ? "Recent temporary bot approvals." : "No bot approvals are available.")
        .setFooter({ text: "CURSED • Server Protection" })
        .setTimestamp()
    if (approvals.length) embed.addFields(approvals.slice(0, 10).map(item => ({
        name: `${item.active ? "Active" : "Used or expired"} • ${item.botId}`,
        value: `Approval ID: \`${item.id}\`\nExpires: <t:${Math.floor(new Date(item.expiresAt).getTime() / 1000)}:R>${item.note ? `\n${item.note}` : ""}`,
    })))
    return embed
}

async function handleBackup(interaction, subcommand, config) {
    if (subcommand === "list") {
        const snapshots = await listSecuritySnapshots(interaction.guildId, 10)
        await safeReply(interaction, { embeds: [snapshotsEmbed(interaction.guild, snapshots)] })
        return true
    }
    if (subcommand === "create") {
        await interaction.deferReply({ ephemeral: true })
        const result = await createSecuritySnapshot(interaction.guild, {
            reason: interaction.options.getString("reason") || "Manual security snapshot",
            actor: actor(interaction),
            retentionCount: config.backup.retentionCount,
        })
        await safeReply(interaction, { content: result.ok
            ? statusLine("success", `Snapshot created • **${result.snapshot.name}** • ID: \`${result.snapshot.id}\``)
            : statusLine("error", result.error) })
        return true
    }
    const ownerGuard = await guard(interaction, { ownerOnly: true })
    if (!ownerGuard.ok) return ownerGuard.handled
    await interaction.deferReply({ ephemeral: true })
    const result = await restoreSecuritySnapshot(
        interaction.guild,
        interaction.options.getString("snapshot_id", true),
        {
            reason: interaction.options.getString("reason") || "Owner-requested security recovery",
            actor: actor(interaction),
            restoreServerSettings: config.backup.restoreServerSettings,
        }
    )
    await safeReply(interaction, { content: result.ok
        ? statusLine("success", `Recovery complete • ${result.rolesCreated} roles and ${result.channelsCreated} channels recreated.${result.errors.length ? ` ${result.errors.length} item(s) could not be restored.` : ""}`)
        : statusLine("error", result.error || "Recovery failed safely.") })
    return true
}

async function handleApproval(interaction, subcommand, config) {
    const ownerGuard = await guard(interaction, { ownerOnly: true })
    if (!ownerGuard.ok) return ownerGuard.handled
    if (!config.botApprovals.enabled) {
        await safeReply(interaction, { content: statusLine("error", "Bot approvals are disabled in Server Protection settings.") })
        return true
    }
    if (subcommand === "list") {
        const approvals = await listBotApprovals(interaction.guildId)
        await safeReply(interaction, { embeds: [approvalsEmbed(approvals)] })
        return true
    }
    if (subcommand === "add") {
        const result = await approveBot(interaction.guildId, interaction.options.getString("bot_id", true), {
            actor: actor(interaction),
            expiresMinutes: interaction.options.getInteger("minutes") || config.botApprovals.defaultExpiryMinutes,
            note: interaction.options.getString("note"),
        })
        await safeReply(interaction, { content: result.ok
            ? statusLine("success", `Bot **${result.approval.botId}** approved for one addition until <t:${Math.floor(new Date(result.approval.expiresAt).getTime() / 1000)}:R>.`)
            : statusLine("error", result.error) })
        return true
    }
    const result = await revokeBotApproval(interaction.guildId, interaction.options.getString("approval_id", true))
    await safeReply(interaction, { content: result.ok ? statusLine("success", "Bot approval revoked.") : statusLine("error", result.error) })
    return true
}

async function handleIncident(interaction, subcommand, config) {
    if (subcommand === "status") {
        const mode = await getIncidentModeState(interaction.guildId)
        await safeReply(interaction, { content: mode.active
            ? statusLine("security", `Incident mode active${mode.expiresAt ? ` until <t:${Math.floor(new Date(mode.expiresAt).getTime() / 1000)}:R>` : ""}. Reason: ${mode.reason || "Not provided"}`)
            : statusLine("success", "Incident mode is not active.") })
        return true
    }
    const ownerGuard = await guard(interaction, { ownerOnly: true })
    if (!ownerGuard.ok) return ownerGuard.handled
    if (!config.incidentMode.enabled) {
        await safeReply(interaction, { content: statusLine("error", "Incident mode is disabled in Server Protection settings.") })
        return true
    }
    await interaction.deferReply({ ephemeral: true })
    const active = subcommand === "enable"
    const result = await setIncidentMode(interaction.guild, active, config, {
        reason: interaction.options.getString("reason") || (active ? "Manual emergency activation" : "Owner ended incident mode"),
        actor: actor(interaction),
        durationMinutes: interaction.options.getInteger("minutes") || config.incidentMode.durationMinutes,
    })
    await safeReply(interaction, { content: result.ok
        ? active
            ? statusLine("security", "Incident mode enabled. Protection sensitivity has been increased.")
            : statusLine("success", "Incident mode ended.")
        : statusLine("error", result.error) })
    return true
}

async function handleAudit(interaction, config) {
    await interaction.deferReply({ ephemeral: true })
    const audit = await runSecurityHealthAudit(interaction.guild, config)
    const embed = new EmbedBuilder()
        .setColor(audit.score >= 80 ? COLORS.success : audit.score >= 60 ? COLORS.warning : COLORS.error)
        .setTitle(`Security health • ${audit.score}/100 (${audit.grade})`)
        .addFields(
            { name: "Issues", value: audit.issues.length ? audit.issues.slice(0, 8).map(item => `• ${item}`).join("\n") : "No critical issues found." },
            { name: "Recommendations", value: audit.recommendations.length ? audit.recommendations.slice(0, 8).map(item => `• ${item}`).join("\n") : "Current configuration is strong." },
        )
        .setFooter({ text: "CURSED • Server Protection" })
        .setTimestamp()
    await safeReply(interaction, { embeds: [embed] })
    return true
}

async function handleReport(interaction, config) {
    if (!config.reports.enabled) {
        await safeReply(interaction, { content: statusLine("error", "Incident reports are disabled.") })
        return true
    }
    await interaction.deferReply({ ephemeral: true })
    const format = interaction.options.getString("format") || "html"
    const result = await buildIncidentReport(interaction.guildId, interaction.options.getString("incident_id"), config.reports.maxTimelineEvents)
    if (!result.ok) {
        await safeReply(interaction, { content: statusLine("error", result.error) })
        return true
    }
    const content = format === "json" ? JSON.stringify(result.report, null, 2) : result.html
    const filename = `cursed-security-report-${Date.now()}.${format === "json" ? "json" : "html"}`
    await safeReply(interaction, {
        content: statusLine("success", `Security report generated • ${result.report.incidentCount} incident(s).`),
        files: [new AttachmentBuilder(Buffer.from(content, "utf8"), { name: filename })],
    })
    return true
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "security") return false
    const result = await guard(interaction)
    if (!result.ok) return result.handled
    const group = interaction.options.getSubcommandGroup(false)
    const subcommand = interaction.options.getSubcommand(true)
    if (group === "backup") return handleBackup(interaction, subcommand, result.config)
    if (group === "approval") return handleApproval(interaction, subcommand, result.config)
    if (group === "incident") return handleIncident(interaction, subcommand, result.config)
    if (subcommand === "audit") return handleAudit(interaction, result.config)
    if (subcommand === "report") return handleReport(interaction, result.config)
    return false
}

module.exports = { commands, handleInteraction, COMMAND_NAMES }
