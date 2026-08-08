const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js")
const moderation = require("./moderation")
const { BRAND } = require("../utils/productSystem")
const {
    COLORS,
    SAFE_MENTIONS,
    buildEmbed,
    statusLine,
} = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const {
    buildGuildHealth,
    systemStatusLines,
} = require("../utils/systemHealth")
const {
    buildRecommendedInvite,
} = require("../utils/botPermissions")
const logger = require("../utils/logger")

const log = logger.child("SystemCommands")
const COMMAND_NAMES = new Set(["cursed", "doctor"])

const cursedCommand = new SlashCommandBuilder()
    .setName("cursed")
    .setDescription("View CURSED status and product information")
    .addSubcommand(sub => sub
        .setName("status")
        .setDescription("Show live bot status for this server"))
    .addSubcommand(sub => sub
        .setName("about")
        .setDescription("Show the CURSED product overview"))

const doctorCommand = new SlashCommandBuilder()
    .setName("doctor")
    .setDescription("Diagnose CURSED configuration and permissions")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
        .setName("health")
        .setDescription("Check systems, persistence, AI, and permissions"))
    .addSubcommand(sub => sub
        .setName("permissions")
        .setDescription("Show the exact bot permissions available and missing"))

function formatDuration(totalSeconds) {
    let seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
    const days = Math.floor(seconds / 86400)
    seconds %= 86400
    const hours = Math.floor(seconds / 3600)
    seconds %= 3600
    const minutes = Math.floor(seconds / 60)
    seconds %= 60
    const parts = []
    if (days) parts.push(`${days}d`)
    if (hours) parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    if (!parts.length || seconds) parts.push(`${seconds}s`)
    return parts.slice(0, 3).join(" ")
}

function botLatency(client) {
    const ping = Number(client?.ws?.ping)
    return Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)}ms` : "Measuring"
}

function aboutEmbed() {
    return buildEmbed({
        title: "CURSED",
        description:
            `${BRAND.tagline}\n\n` +
            "CURSED is organized around a small set of predictable systems instead of a wall of unrelated commands.",
        color: COLORS.primary,
        fields: [
            { name: "Server Management", value: "Moderation • Server Protection • Configuration", inline: false },
            { name: "AI & Creative", value: "AI chat • Memory • Image features", inline: false },
            { name: "Community", value: "Welcome • Tickets • Profiles • Leveling • Birthdays • Custom roles", inline: false },
            { name: "Economy & Games", value: "Economy • Shop • Games • Gambling • Pets • Quests", inline: false },
            { name: "Utilities", value: "Server information • Statistics • Account utilities", inline: false },
        ],
        footer: "CURSED • Predictable by design",
    })
}

function publicStatusEmbed(client, guild) {
    const prefix = getGuildPrefix(guild.id)
    return buildEmbed({
        title: "CURSED Status",
        description: "Live process and Discord gateway status.",
        color: COLORS.success,
        fields: [
            { name: "Gateway", value: `Online • ${botLatency(client)}`, inline: true },
            { name: "Uptime", value: formatDuration(process.uptime()), inline: true },
            { name: "Prefix", value: `\`${prefix}\``, inline: true },
            { name: "Commands", value: `Use \`${prefix}help\` or Discord slash commands.`, inline: false },
        ],
        footer: "CURSED • Status",
        timestamp: true,
    })
}

function permissionBlock(title, report) {
    if (report.complete) return `✅ **${title}** — all ${report.total} available`
    return `⚠️ **${title}** — missing: ${report.missingLabels.join(", ")}`
}

function permissionEmbed(health, clientId) {
    const invite = buildRecommendedInvite(clientId)
    const description = [
        "CURSED does **not** require Discord Administrator permission. Grant only the permissions needed by the systems you use.",
        "",
        permissionBlock("Current channel", health.channelReport),
        permissionBlock("Core guild access", health.permissionReport.core),
        permissionBlock("Moderation", health.permissionReport.moderation),
        permissionBlock("Server protection", health.permissionReport.protection),
    ].join("\n")

    const fields = []
    if (invite) fields.push({
        name: "Recommended permission invite",
        value: `[Open Discord authorization](${invite})`,
        inline: false,
    })

    return buildEmbed({
        title: "CURSED Permissions",
        description,
        color: health.channelReport.complete ? COLORS.info : COLORS.warning,
        fields,
        footer: "CURSED • Least-privilege permission model",
        timestamp: true,
    })
}

function doctorEmbed(health) {
    const attention = health.systems.filter(item => item.status === "attention").length
    const ready = health.systems.filter(item => item.status === "ready").length
    const disabled = health.systems.filter(item => item.status === "disabled").length
    const recommendationText = health.recommendations.length
        ? health.recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "No immediate action required."

    return buildEmbed({
        title: health.overall === "ready" ? "CURSED Doctor • Ready" : "CURSED Doctor • Attention required",
        description: "A read-only diagnostic. Nothing is changed by this command.",
        color: health.overall === "ready" ? COLORS.success : COLORS.warning,
        fields: [
            { name: "Persistence", value: health.database, inline: true },
            { name: "AI providers", value: health.ai.configured.length ? health.ai.configured.join(" → ") : "None configured", inline: true },
            { name: "Prefix", value: `\`${health.prefix}\``, inline: true },
            { name: "Systems", value: `Ready: **${ready}** • Attention: **${attention}** • Disabled/not configured: **${disabled}**\n\n${systemStatusLines(health.systems).join("\n")}`.slice(0, 1024), inline: false },
            { name: "Current channel", value: health.channelReport.complete ? "Core message permissions are available." : `Missing: ${health.channelReport.missingLabels.join(", ")}`, inline: false },
            { name: "Recommended actions", value: recommendationText.slice(0, 1024), inline: false },
        ],
        footer: "CURSED • Diagnostics",
        timestamp: true,
    })
}

function canManage(member) {
    return Boolean(
        member?.permissions?.has(PermissionFlagsBits.Administrator)
        || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    )
}

async function sendPrefixEmbed(message, embed) {
    return message.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS }).catch(() =>
        message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    )
}

async function handle(message) {
    if (!message.guild) return false
    const input = String(message.content || "").trim().toLowerCase().replace(/\s+/g, " ")
    const status = input === "!status" || input === "!cursed" || input === "!cursed status"
    const about = input === "!about" || input === "!cursed about"
    const doctor = input === "!doctor" || input === "!doctor health"
    const permissions = input === "!permissions" || input === "!doctor permissions"
    if (!status && !about && !doctor && !permissions) return false

    if (about) {
        await sendPrefixEmbed(message, aboutEmbed())
        return true
    }
    if (status) {
        await sendPrefixEmbed(message, publicStatusEmbed(message.client, message.guild))
        return true
    }

    if (!canManage(message.member)) {
        await message.reply({
            content: statusLine("error", "You need **Manage Server** to run CURSED diagnostics."),
            allowedMentions: SAFE_MENTIONS,
        }).catch(() => {})
        return true
    }

    const health = await buildGuildHealth(message.guild, message.channel)
    await sendPrefixEmbed(
        message,
        permissions
            ? permissionEmbed(health, message.client.user?.id)
            : doctorEmbed(health)
    )
    return true
}

async function replyInteraction(interaction, payload, ephemeral = false) {
    const body = { ...payload, ephemeral, allowedMentions: SAFE_MENTIONS }
    if (interaction.deferred) {
        const { ephemeral: _ephemeral, ...edit } = body
        return interaction.editReply(edit)
    }
    if (interaction.replied) return interaction.followUp(body)
    return interaction.reply(body)
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !COMMAND_NAMES.has(interaction.commandName)) return false

    try {
        if (interaction.commandName === "cursed") {
            if (!interaction.inGuild()) {
                await replyInteraction(interaction, { content: statusLine("error", "Use this command inside a server.") }, true)
                return true
            }
            const sub = interaction.options.getSubcommand()
            const embed = sub === "about"
                ? aboutEmbed()
                : publicStatusEmbed(interaction.client, interaction.guild)
            await replyInteraction(interaction, { embeds: [embed] }, false)
            return true
        }

        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await replyInteraction(interaction, { content: statusLine("error", "You need **Manage Server** to run CURSED diagnostics.") }, true)
            return true
        }

        await interaction.deferReply({ ephemeral: true })
        const health = await buildGuildHealth(interaction.guild, interaction.channel)
        const embed = interaction.options.getSubcommand() === "permissions"
            ? permissionEmbed(health, interaction.client.user?.id)
            : doctorEmbed(health)
        await interaction.editReply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        return true
    } catch (err) {
        log.error(`System command failed: ${err.message}`, {
            guildId: interaction.guildId,
            command: interaction.commandName,
            stack: err.stack,
        })
        await replyInteraction(interaction, { content: statusLine("error", "CURSED diagnostics could not complete. Try again in a moment.") }, true).catch(() => {})
        return true
    }
}

for (const command of [cursedCommand, doctorCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) {
        moderation.commands.push(command)
    }
}

if (!moderation.__systemCommandsPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedSystemInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__systemCommandsPatched", {
        value: true,
        enumerable: false,
    })
}

module.exports = {
    handle,
    handleInteraction,
    cursedCommand,
    doctorCommand,
    aboutEmbed,
    publicStatusEmbed,
    permissionEmbed,
    doctorEmbed,
    formatDuration,
    COMMAND_NAMES,
}
