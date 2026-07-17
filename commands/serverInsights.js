/**
 * Live server information and opt-in activity-tracking administration.
 *
 * This PR intentionally does not expose historical reports yet. It establishes
 * accurate daily data so the next PR can build leaderboards, growth reports,
 * visual cards, and scheduled summaries without fabricating history.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require("discord.js")
const moderation = require("./moderation")
const {
    getStatsConfig,
    setupStats,
    setStatsEnabled,
    setChannelExcluded,
    resetGuildStats,
} = require("../utils/activityTracker")
const { humanizeEnum } = require("../utils/activityStatsHelpers")
const logger = require("../utils/logger")
const log = logger.child("ServerInsights")

const serverCommand = new SlashCommandBuilder()
    .setName("server")
    .setDescription("View live information about this Discord server")
    .addSubcommand(sub => sub
        .setName("info")
        .setDescription("Show a detailed live server overview"))
    .addSubcommand(sub => sub
        .setName("icon")
        .setDescription("Show the server icon in full resolution"))
    .addSubcommand(sub => sub
        .setName("banner")
        .setDescription("Show the server banner in full resolution"))

const statsCommand = new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Configure CURSED server activity tracking")
    .addSubcommand(sub => sub
        .setName("setup")
        .setDescription("Enable privacy-safe daily activity tracking"))
    .addSubcommand(sub => sub
        .setName("status")
        .setDescription("Show the activity-tracking configuration"))
    .addSubcommand(sub => sub
        .setName("enable")
        .setDescription("Resume activity tracking without deleting data"))
    .addSubcommand(sub => sub
        .setName("disable")
        .setDescription("Pause new activity tracking without deleting data"))
    .addSubcommand(sub => sub
        .setName("exclude")
        .setDescription("Exclude a channel from new detailed statistics")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("Channel to exclude")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("include")
        .setDescription("Include a previously excluded channel")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("Channel to include")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("reset")
        .setDescription("Permanently delete all tracked activity for this server")
        .addBooleanOption(option => option
            .setName("confirm")
            .setDescription("Confirm permanent deletion")
            .setRequired(true)))

function discordTimestamp(date, style = "F") {
    const value = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(value.getTime())) return "Unknown"
    return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`
}

function safeText(value, fallback = "Unknown") {
    const text = String(value ?? "").trim()
    return text || fallback
}

function verificationLabel(value) {
    const labels = ["None", "Low", "Medium", "High", "Very High"]
    return labels[Number(value)] || humanizeEnum(value)
}

function explicitFilterLabel(value) {
    const labels = ["Disabled", "Members Without Roles", "All Members"]
    return labels[Number(value)] || humanizeEnum(value)
}

function buildChannelCounts(guild) {
    let text = 0
    let voice = 0
    let categories = 0
    let forums = 0
    let stages = 0

    for (const channel of guild.channels.cache.values()) {
        if (channel.type === ChannelType.GuildCategory) categories++
        else if (channel.type === ChannelType.GuildVoice) voice++
        else if (channel.type === ChannelType.GuildStageVoice) stages++
        else if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) forums++
        else if (
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildAnnouncement
        ) text++
    }

    return { text, voice, categories, forums, stages }
}

function buildMemberBreakdown(guild) {
    const cached = guild.members.cache
    const humans = cached.filter(member => !member.user.bot).size
    const bots = cached.filter(member => member.user.bot).size
    const complete = cached.size >= guild.memberCount
    return { humans, bots, cached: cached.size, complete }
}

async function buildServerInfoEmbed(guild) {
    const owner = await guild.fetchOwner().catch(() => null)
    const channels = buildChannelCounts(guild)
    const members = buildMemberBreakdown(guild)
    const icon = guild.iconURL({ extension: "png", size: 1024 })
    const banner = guild.bannerURL({ extension: "png", size: 1024 })
    const splash = guild.splashURL({ extension: "png", size: 1024 })
    const roles = Math.max(0, guild.roles.cache.size - 1)
    const community = guild.features.includes("COMMUNITY") ? "Enabled" : "Disabled"
    const memberDetails = members.complete
        ? `**Total:** ${guild.memberCount.toLocaleString()}\n**Humans:** ${members.humans.toLocaleString()}\n**Bots:** ${members.bots.toLocaleString()}`
        : `**Total:** ${guild.memberCount.toLocaleString()}\n**Cached humans:** ${members.humans.toLocaleString()}\n**Cached bots:** ${members.bots.toLocaleString()}`

    const embed = new EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle(`🏰 ${safeText(guild.name)} — Server Information`)
        .setDescription(safeText(guild.description, "Live Discord information for this server."))
        .addFields(
            { name: "👑 Owner", value: owner ? `${owner.user.tag}\n<@${owner.id}>` : `<@${guild.ownerId}>`, inline: true },
            { name: "🆔 Server ID", value: `\`${guild.id}\``, inline: true },
            { name: "🌐 Locale", value: safeText(guild.preferredLocale), inline: true },
            { name: "👥 Members", value: memberDetails, inline: true },
            {
                name: "💬 Channels",
                value: `**Text:** ${channels.text}\n**Voice:** ${channels.voice}\n**Categories:** ${channels.categories}\n**Forums/Media:** ${channels.forums}\n**Stages:** ${channels.stages}`,
                inline: true,
            },
            {
                name: "🎨 Community",
                value: `**Roles:** ${roles}\n**Emojis:** ${guild.emojis.cache.size}\n**Stickers:** ${guild.stickers.cache.size}\n**Community:** ${community}`,
                inline: true,
            },
            {
                name: "🚀 Boosts",
                value: `**Level:** ${guild.premiumTier}\n**Boosts:** ${guild.premiumSubscriptionCount || 0}`,
                inline: true,
            },
            {
                name: "🛡️ Security",
                value: `**Verification:** ${verificationLabel(guild.verificationLevel)}\n**MFA:** ${guild.mfaLevel ? "Required" : "Not required"}\n**Explicit filter:** ${explicitFilterLabel(guild.explicitContentFilter)}`,
                inline: true,
            },
            {
                name: "💤 AFK",
                value: guild.afkChannel
                    ? `${guild.afkChannel}\n${Math.floor(guild.afkTimeout / 60)} minute timeout`
                    : "Not configured",
                inline: true,
            },
            {
                name: "📅 Created",
                value: `${discordTimestamp(guild.createdAt, "F")}\n${discordTimestamp(guild.createdAt, "R")}`,
                inline: false,
            },
            {
                name: "🤖 CURSED joined",
                value: guild.members.me?.joinedAt
                    ? `${discordTimestamp(guild.members.me.joinedAt, "F")}\n${discordTimestamp(guild.members.me.joinedAt, "R")}`
                    : "Unknown",
                inline: false,
            },
        )
        .setFooter({ text: "Live Discord data • Detailed activity tracking is opt-in with /stats setup" })
        .setTimestamp()

    if (icon) embed.setThumbnail(icon)
    if (banner || splash) embed.setImage(banner || splash)
    return embed
}

function assertManageGuild(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        const error = new Error("You need the Manage Server permission to configure statistics.")
        error.code = "MISSING_PERMISSION"
        throw error
    }
}

async function replyError(interaction, message) {
    const payload = { content: `❌ ${message}`, allowedMentions: { parse: [] } }
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ ...payload, embeds: [] }).catch(() => {})
    }
    return interaction.reply({ ...payload, ephemeral: true }).catch(() => {})
}

async function handleServerInteraction(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "server") return false
    if (!interaction.inGuild()) {
        await replyError(interaction, "This command can only be used inside a server.")
        return true
    }

    const subcommand = interaction.options.getSubcommand()
    const guild = interaction.guild

    try {
        if (subcommand === "info") {
            await interaction.deferReply()
            const embed = await buildServerInfoEmbed(guild)
            await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } })
            return true
        }

        const isIcon = subcommand === "icon"
        const url = isIcon
            ? guild.iconURL({ extension: "png", size: 4096 })
            : guild.bannerURL({ extension: "png", size: 4096 })
        if (!url) {
            await replyError(interaction, `This server does not have a ${isIcon ? "server icon" : "banner"}.`)
            return true
        }

        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle(`${isIcon ? "🖼️ Server Icon" : "🌌 Server Banner"} — ${safeText(guild.name)}`)
            .setImage(url)
            .setDescription(`[Open full-resolution image](${url})`)
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } })
        return true
    } catch (err) {
        log.error(`Server command failed: ${err.message}`, { guildId: interaction.guildId, stack: err.stack })
        await replyError(interaction, "CURSED could not load that server information.")
        return true
    }
}

async function handleStatsInteraction(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "stats") return false

    try {
        assertManageGuild(interaction)
        const guildId = interaction.guildId
        const subcommand = interaction.options.getSubcommand()

        if (subcommand === "setup") {
            const config = await setupStats(guildId)
            await interaction.reply({
                content:
                    "✅ **Server activity tracking is enabled.**\n" +
                    "CURSED stores only IDs, dates, and numerical counts—never message content, attachments, links, or voice audio.\n" +
                    `Tracking started: ${discordTimestamp(config.trackingStartedAt, "F")}`,
                ephemeral: true,
                allowedMentions: { parse: [] },
            })
            return true
        }

        if (subcommand === "status") {
            const config = await getStatsConfig(guildId, { fresh: true })
            const excluded = config.excludedChannelIds.length
                ? config.excludedChannelIds.map(id => `<#${id}>`).join(", ").slice(0, 1000)
                : "None"
            const embed = new EmbedBuilder()
                .setColor(config.enabled ? 0x22C55E : 0x6B7280)
                .setTitle("📊 Server Activity Tracking")
                .addFields(
                    { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
                    { name: "Bots", value: config.excludeBots ? "Excluded" : "Included", inline: true },
                    { name: "Tracking since", value: config.trackingStartedAt ? discordTimestamp(config.trackingStartedAt, "F") : "Not started", inline: false },
                    { name: "Excluded channels", value: excluded, inline: false },
                    { name: "Stored data", value: "IDs, UTC dates, and numerical activity counts only. No message content or voice audio.", inline: false },
                )
            await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } })
            return true
        }

        if (subcommand === "enable" || subcommand === "disable") {
            const enabled = subcommand === "enable"
            const config = await setStatsEnabled(guildId, enabled)
            await interaction.reply({
                content: `${enabled ? "✅" : "⏸️"} Activity tracking is now **${enabled ? "enabled" : "disabled"}**.${enabled ? ` Tracking from ${discordTimestamp(config.trackingStartedAt, "F")}.` : " Existing data was preserved."}`,
                ephemeral: true,
            })
            return true
        }

        if (subcommand === "exclude" || subcommand === "include") {
            const channel = interaction.options.getChannel("channel", true)
            if (channel.guildId !== guildId) throw new Error("That channel does not belong to this server.")
            const excluded = subcommand === "exclude"
            await setChannelExcluded(guildId, channel.id, excluded)
            await interaction.reply({
                content: `${excluded ? "🚫" : "✅"} ${channel} is now **${excluded ? "excluded from" : "included in"}** new detailed statistics.`,
                ephemeral: true,
                allowedMentions: { parse: [] },
            })
            return true
        }

        if (subcommand === "reset") {
            const confirmed = interaction.options.getBoolean("confirm", true)
            if (!confirmed) {
                await interaction.reply({ content: "Reset cancelled. No statistics were deleted.", ephemeral: true })
                return true
            }
            await interaction.deferReply({ ephemeral: true })
            await resetGuildStats(guildId, { includeLifetime: true })
            await interaction.editReply({
                content: "🗑️ All CURSED activity statistics for this server were permanently deleted. Tracking is now disabled.",
                allowedMentions: { parse: [] },
            })
            return true
        }

        return false
    } catch (err) {
        log.error(`Stats configuration failed: ${err.message}`, { guildId: interaction.guildId, stack: err.stack })
        const safeMessage = err.code === "MISSING_PERMISSION" ? err.message : "CURSED could not update the statistics configuration."
        await replyError(interaction, safeMessage)
        return true
    }
}

async function handle() {
    return false
}

for (const command of [serverCommand, statsCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) {
        moderation.commands.push(command)
    }
}

if (!moderation.__serverInsightsPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedServerInsightsInteraction(interaction) {
        if (interaction.isChatInputCommand() && interaction.commandName === "server") {
            return handleServerInteraction(interaction)
        }
        if (interaction.isChatInputCommand() && interaction.commandName === "stats") {
            return handleStatsInteraction(interaction)
        }
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__serverInsightsPatched", {
        value: true,
        enumerable: false,
    })
}

module.exports = {
    handle,
    serverCommand,
    statsCommand,
    handleServerInteraction,
    handleStatsInteraction,
    buildServerInfoEmbed,
    buildChannelCounts,
    buildMemberBreakdown,
}
