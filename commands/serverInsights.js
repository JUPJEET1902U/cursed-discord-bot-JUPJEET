/**
 * Live server information and opt-in activity tracking administration.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
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
const {
    admin: adminEmbed,
    info,
    statusLine,
    replyInteraction,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")

const log = logger.child("ServerInsights")

const serverCommand = new SlashCommandBuilder()
    .setName("server")
    .setDescription("View live information about this Discord server")
    .addSubcommand(sub => sub.setName("info").setDescription("Show a detailed live server overview"))
    .addSubcommand(sub => sub.setName("icon").setDescription("Show the server icon in full resolution"))
    .addSubcommand(sub => sub.setName("banner").setDescription("Show the server banner in full resolution"))

const statsCommand = new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Configure CURSED server activity tracking")
    .addSubcommand(sub => sub.setName("setup").setDescription("Enable privacy-safe daily activity tracking"))
    .addSubcommand(sub => sub.setName("status").setDescription("Show the activity-tracking configuration"))
    .addSubcommand(sub => sub.setName("enable").setDescription("Resume activity tracking without deleting data"))
    .addSubcommand(sub => sub.setName("disable").setDescription("Pause new activity tracking without deleting data"))
    .addSubcommand(sub => sub.setName("exclude").setDescription("Exclude a channel from new detailed statistics")
        .addChannelOption(option => option.setName("channel").setDescription("Channel to exclude").setRequired(true)))
    .addSubcommand(sub => sub.setName("include").setDescription("Include a previously excluded channel")
        .addChannelOption(option => option.setName("channel").setDescription("Channel to include").setRequired(true)))
    .addSubcommand(sub => sub.setName("reset").setDescription("Permanently delete all tracked activity for this server")
        .addBooleanOption(option => option.setName("confirm").setDescription("Confirm permanent deletion").setRequired(true)))

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
        else if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) text++
    }
    return { text, voice, categories, forums, stages }
}

function buildMemberBreakdown(guild) {
    const cached = guild.members.cache
    const humans = cached.filter(member => !member.user.bot).size
    const bots = cached.filter(member => member.user.bot).size
    return { humans, bots, cached: cached.size, complete: cached.size >= guild.memberCount }
}

async function buildServerInfoEmbed(guild) {
    const owner = await guild.fetchOwner().catch(() => null)
    const channels = buildChannelCounts(guild)
    const members = buildMemberBreakdown(guild)
    const icon = guild.iconURL({ extension: "png", size: 1024 })
    const banner = guild.bannerURL({ extension: "png", size: 1024 })
    const splash = guild.splashURL({ extension: "png", size: 1024 })
    const roles = Math.max(0, guild.roles.cache.size - 1)

    const embed = adminEmbed("Server information", safeText(guild.description, "Live Discord information for this server."), {
        fields: [
            { name: "Server", value: `${safeText(guild.name)}\nID: \`${guild.id}\``, inline: true },
            { name: "Owner", value: owner ? `${owner.user.tag}\n<@${owner.id}>` : `<@${guild.ownerId}>`, inline: true },
            { name: "Locale", value: safeText(guild.preferredLocale), inline: true },
            {
                name: "Members",
                value: members.complete
                    ? `${guild.memberCount.toLocaleString()} total · ${members.humans.toLocaleString()} humans · ${members.bots.toLocaleString()} bots`
                    : `${guild.memberCount.toLocaleString()} total · ${members.cached.toLocaleString()} cached`,
                inline: false,
            },
            { name: "Channels", value: `${channels.text} text · ${channels.voice} voice · ${channels.categories} categories · ${channels.forums} forums/media · ${channels.stages} stages`, inline: false },
            { name: "Community", value: `${roles} roles · ${guild.emojis.cache.size} emojis · ${guild.stickers.cache.size} stickers · ${guild.features.includes("COMMUNITY") ? "Community enabled" : "Community disabled"}`, inline: false },
            { name: "Boosts", value: `Tier ${guild.premiumTier} · ${guild.premiumSubscriptionCount || 0} boosts`, inline: true },
            { name: "Security", value: `Verification: ${verificationLabel(guild.verificationLevel)}\nMFA: ${guild.mfaLevel ? "Required" : "Not required"}\nContent filter: ${explicitFilterLabel(guild.explicitContentFilter)}`, inline: true },
            { name: "Created", value: `${discordTimestamp(guild.createdAt, "F")} · ${discordTimestamp(guild.createdAt, "R")}`, inline: false },
            { name: "CURSED joined", value: guild.members.me?.joinedAt ? `${discordTimestamp(guild.members.me.joinedAt, "F")} · ${discordTimestamp(guild.members.me.joinedAt, "R")}` : "Unknown", inline: false },
        ],
        footer: "CURSED • Server Management",
        timestamp: true,
    })
    if (icon) embed.setThumbnail(icon)
    if (banner || splash) embed.setImage(banner || splash)
    return embed
}

function assertManageGuild(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        const error = new Error("You need Manage Server to configure statistics.")
        error.code = "MISSING_PERMISSION"
        throw error
    }
}

function replyError(interaction, message) {
    return replyInteraction(interaction, { content: statusLine("error", message) }, { ephemeral: true }).catch(() => {})
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
            await interaction.editReply({ embeds: [await buildServerInfoEmbed(guild)], allowedMentions: SAFE_MENTIONS })
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
        const embed = info(`[Open full-resolution image](${url})`, {
            title: `${isIcon ? "Server icon" : "Server banner"} • ${safeText(guild.name)}`,
            footer: "CURSED • Server Management",
        })
        embed.setImage(url)
        await interaction.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        return true
    } catch (error) {
        log.error(`Server command failed: ${error.message}`, { guildId: interaction.guildId })
        await replyError(interaction, "Server information could not be loaded.")
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
            await replyInteraction(interaction, {
                content: statusLine("success", `Activity tracking enabled. CURSED stores IDs, dates and numerical counts only — never message content, attachments, links or voice audio. Tracking started ${discordTimestamp(config.trackingStartedAt, "R")}.`),
            }, { ephemeral: true })
            return true
        }

        if (subcommand === "status") {
            const config = await getStatsConfig(guildId, { fresh: true })
            const excluded = config.excludedChannelIds.length
                ? config.excludedChannelIds.map(id => `<#${id}>`).join(", ").slice(0, 1000)
                : "None"
            const embed = adminEmbed("Activity tracking", null, {
                fields: [
                    { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
                    { name: "Bots", value: config.excludeBots ? "Excluded" : "Included", inline: true },
                    { name: "Tracking since", value: config.trackingStartedAt ? discordTimestamp(config.trackingStartedAt, "F") : "Not started", inline: false },
                    { name: "Excluded channels", value: excluded, inline: false },
                    { name: "Stored data", value: "IDs, UTC dates and numerical activity counts only. No message content or voice audio.", inline: false },
                ],
                footer: "CURSED • Server Management",
            })
            embed.setColor(config.enabled ? 0x57F287 : 0x99AAB5)
            await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }

        if (subcommand === "enable" || subcommand === "disable") {
            const enabled = subcommand === "enable"
            const config = await setStatsEnabled(guildId, enabled)
            await replyInteraction(interaction, {
                content: statusLine("success", enabled
                    ? `Activity tracking enabled${config.trackingStartedAt ? ` · tracking since ${discordTimestamp(config.trackingStartedAt, "R")}` : ""}.`
                    : "Activity tracking disabled. Existing data was preserved."),
            }, { ephemeral: true })
            return true
        }

        if (subcommand === "exclude" || subcommand === "include") {
            const channel = interaction.options.getChannel("channel", true)
            if (channel.guildId !== guildId) throw new Error("That channel does not belong to this server.")
            const excluded = subcommand === "exclude"
            await setChannelExcluded(guildId, channel.id, excluded)
            await replyInteraction(interaction, {
                content: statusLine("success", `${channel} is now ${excluded ? "excluded from" : "included in"} new detailed statistics.`),
            }, { ephemeral: true })
            return true
        }

        if (subcommand === "reset") {
            if (!interaction.options.getBoolean("confirm", true)) {
                await replyInteraction(interaction, { content: "Reset cancelled. No statistics were deleted." }, { ephemeral: true })
                return true
            }
            await interaction.deferReply({ ephemeral: true })
            await resetGuildStats(guildId, { includeLifetime: true })
            await interaction.editReply({ content: statusLine("success", "All CURSED activity statistics for this server were deleted and tracking was disabled."), allowedMentions: SAFE_MENTIONS })
            return true
        }
        return false
    } catch (error) {
        log.error(`Stats configuration failed: ${error.message}`, { guildId: interaction.guildId })
        await replyError(interaction, error.code === "MISSING_PERMISSION" ? error.message : "Statistics configuration could not be updated.")
        return true
    }
}

async function handle() {
    return false
}

for (const command of [serverCommand, statsCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) moderation.commands.push(command)
}

if (!moderation.__serverInsightsPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedServerInsightsInteraction(interaction) {
        if (interaction.isChatInputCommand() && interaction.commandName === "server") return handleServerInteraction(interaction)
        if (interaction.isChatInputCommand() && interaction.commandName === "stats") return handleStatsInteraction(interaction)
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__serverInsightsPatched", { value: true, enumerable: false })
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
