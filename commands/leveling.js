/**
 * Arcane-style server leveling commands.
 * Public: /rank, /levels
 * Manage Server: /leveling setup|channel|enable|disable|status|ignore|include|test
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
    escapeMarkdown,
} = require("discord.js")
const moderation = require("./moderation")
const {
    getLevelingConfig,
    setupLeveling,
    setLevelingEnabled,
    setLevelUpChannel,
    setIgnoredChannel,
    getMemberRank,
    getLeaderboard,
    sendLevelUpAnnouncement,
} = require("../utils/leveling")
const { getLevelProgress, buildProgressBar } = require("../utils/levelingMath")
const logger = require("../utils/logger")

const log = logger.child("LevelingCommands")
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your server level and XP rank")
    .addUserOption(option => option
        .setName("user")
        .setDescription("Member whose rank you want to view")
        .setRequired(false))

const levelsCommand = new SlashCommandBuilder()
    .setName("levels")
    .setDescription("Show this server's leveling leaderboard")

const levelingCommand = new SlashCommandBuilder()
    .setName("leveling")
    .setDescription("Configure CURSED server leveling")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
        .setName("setup")
        .setDescription("Enable leveling and choose the level-up announcement channel")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("Channel where level-up messages will be posted")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("channel")
        .setDescription("Change the level-up announcement channel")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("New level-up announcement channel")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("enable")
        .setDescription("Resume leveling without deleting member XP"))
    .addSubcommand(sub => sub
        .setName("disable")
        .setDescription("Pause leveling without deleting member XP"))
    .addSubcommand(sub => sub
        .setName("status")
        .setDescription("Show the current leveling configuration"))
    .addSubcommand(sub => sub
        .setName("ignore")
        .setDescription("Stop awarding XP in a channel")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("Channel to ignore")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("include")
        .setDescription("Allow XP again in an ignored channel")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("Channel to include")
            .setRequired(true)))
    .addSubcommand(sub => sub
        .setName("test")
        .setDescription("Send a level-up card preview without changing XP")
        .addUserOption(option => option
            .setName("user")
            .setDescription("Member to use in the preview")
            .setRequired(false)))

function discordTimestamp(date, style = "F") {
    const value = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(value.getTime())) return "Unknown"
    return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`
}

function isAnnouncementChannel(channel) {
    return Boolean(channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
}

function assertManageGuild(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        const err = new Error("You need the Manage Server permission to configure leveling.")
        err.code = "MISSING_PERMISSION"
        throw err
    }
}

function validateAnnouncementChannel(interaction, channel) {
    if (!isAnnouncementChannel(channel) || channel.guildId !== interaction.guildId) {
        const err = new Error("Choose a normal server text or announcement channel.")
        err.code = "INVALID_CHANNEL"
        throw err
    }

    const me = interaction.guild.members.me
    const permissions = me ? channel.permissionsFor(me) : null
    if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) {
        const err = new Error("CURSED cannot view that channel.")
        err.code = "BOT_PERMISSION"
        throw err
    }
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
        const err = new Error("CURSED cannot send messages in that channel.")
        err.code = "BOT_PERMISSION"
        throw err
    }

    return {
        canAttach: !permissions || permissions.has(PermissionFlagsBits.AttachFiles),
    }
}

async function replyError(interaction, message) {
    const payload = { content: `❌ ${message}`, ephemeral: true, allowedMentions: SAFE_MENTIONS }
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: payload.content, embeds: [], components: [], files: [], allowedMentions: SAFE_MENTIONS }).catch(() => {})
    }
    return interaction.reply(payload).catch(() => {})
}

async function handleRank(interaction) {
    if (!interaction.inGuild()) {
        await replyError(interaction, "This command can only be used inside a server.")
        return true
    }

    await interaction.deferReply()
    const config = await getLevelingConfig(interaction.guildId, { fresh: true })
    if (!config.enabled) {
        await interaction.editReply({
            content: "📴 Server leveling is currently disabled.",
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    const target = interaction.options.getUser("user") || interaction.user
    if (target.bot) {
        await interaction.editReply({ content: "🤖 Bots do not earn server XP.", allowedMentions: SAFE_MENTIONS })
        return true
    }

    const ranked = await getMemberRank(interaction.guildId, target.id)
    if (!ranked) {
        await interaction.editReply({
            content: `📊 **${escapeMarkdown(target.username)}** has not earned server XP yet.`,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    const progress = getLevelProgress(ranked.xp)
    const bar = buildProgressBar(progress.ratio, 14)
    const member = interaction.guild.members.cache.get(target.id)
    const displayName = member?.displayName || ranked.displayName || target.username
    const embed = new EmbedBuilder()
        .setColor(0xA855F7)
        .setAuthor({
            name: `${displayName}'s Server Rank`,
            iconURL: target.displayAvatarURL({ extension: "png", size: 128 }),
        })
        .setDescription(
            `⭐ **Level ${progress.level}**  •  🏆 **Rank #${ranked.rank}**\n` +
            `\`${bar}\` **${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP**`
        )
        .addFields(
            { name: "Total XP", value: ranked.xp.toLocaleString(), inline: true },
            { name: "XP Messages", value: Number(ranked.messageCount || 0).toLocaleString(), inline: true },
            { name: "Next Level", value: `Level ${progress.level + 1}`, inline: true },
        )
        .setThumbnail(target.displayAvatarURL({ extension: "png", size: 256 }))
        .setFooter({ text: `${interaction.guild.name} • CURSED Leveling` })
        .setTimestamp()

    await interaction.editReply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    return true
}

async function handleLevels(interaction) {
    if (!interaction.inGuild()) {
        await replyError(interaction, "This command can only be used inside a server.")
        return true
    }

    await interaction.deferReply()
    const config = await getLevelingConfig(interaction.guildId, { fresh: true })
    if (!config.enabled) {
        await interaction.editReply({ content: "📴 Server leveling is currently disabled.", allowedMentions: SAFE_MENTIONS })
        return true
    }

    const leaders = await getLeaderboard(interaction.guildId, 10)
    if (!leaders.length) {
        await interaction.editReply({ content: "📊 Nobody has earned server XP yet.", allowedMentions: SAFE_MENTIONS })
        return true
    }

    const medals = ["🥇", "🥈", "🥉"]
    const lines = leaders.map((entry, index) => {
        const name = escapeMarkdown(String(entry.displayName || `Member ${entry.userId}`).slice(0, 40))
        const badge = medals[index] || `**#${index + 1}**`
        const level = getLevelProgress(entry.xp).level
        return `${badge} **${name}** — Level **${level}** • ${Number(entry.xp).toLocaleString()} XP`
    })

    const embed = new EmbedBuilder()
        .setColor(0xA855F7)
        .setTitle(`🏆 ${interaction.guild.name} — Level Leaderboard`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Server-specific XP • Commands and spam do not earn XP" })
        .setTimestamp()

    const icon = interaction.guild.iconURL({ extension: "png", size: 128 })
    if (icon) embed.setThumbnail(icon)
    await interaction.editReply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    return true
}

async function handleLevelingAdmin(interaction) {
    assertManageGuild(interaction)
    const subcommand = interaction.options.getSubcommand()
    const guildId = interaction.guildId

    if (subcommand === "setup" || subcommand === "channel") {
        const channel = interaction.options.getChannel("channel", true)
        const { canAttach } = validateAnnouncementChannel(interaction, channel)
        const config = subcommand === "setup"
            ? await setupLeveling(guildId, channel.id)
            : await setLevelUpChannel(guildId, channel.id)

        await interaction.reply({
            content:
                `${subcommand === "setup" ? "✅ Server leveling is now enabled" : "✅ Level-up channel updated"}: ${channel}.\n` +
                `Members earn **${config.xpMin}–${config.xpMax} XP** once every **${config.cooldownSeconds} seconds** from eligible messages.` +
                (canAttach ? "" : "\n⚠️ CURSED lacks **Attach Files**, so level-ups will use text-only fallback messages."),
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    if (subcommand === "enable" || subcommand === "disable") {
        const enabled = subcommand === "enable"
        const current = await getLevelingConfig(guildId, { fresh: true })
        if (enabled && !current.levelUpChannelId) {
            await replyError(interaction, "Set a level-up channel first with `/leveling setup`.")
            return true
        }
        await setLevelingEnabled(guildId, enabled)
        await interaction.reply({
            content: enabled
                ? "✅ Server leveling is enabled. Existing XP was preserved."
                : "⏸️ Server leveling is disabled. Existing XP was preserved.",
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    if (subcommand === "ignore" || subcommand === "include") {
        const channel = interaction.options.getChannel("channel", true)
        if (channel.guildId !== guildId) {
            const err = new Error("That channel does not belong to this server.")
            err.code = "INVALID_CHANNEL"
            throw err
        }
        const ignored = subcommand === "ignore"
        await setIgnoredChannel(guildId, channel.id, ignored)
        await interaction.reply({
            content: `${ignored ? "🚫" : "✅"} ${channel} is now **${ignored ? "ignored by" : "included in"}** server leveling.`,
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    if (subcommand === "status") {
        const config = await getLevelingConfig(guildId, { fresh: true })
        const channel = config.levelUpChannelId
            ? interaction.guild.channels.cache.get(config.levelUpChannelId)
            : null
        const ignored = config.ignoredChannelIds.length
            ? config.ignoredChannelIds.map(id => `<#${id}>`).join(", ").slice(0, 1000)
            : "None"
        const embed = new EmbedBuilder()
            .setColor(config.enabled ? 0x22C55E : 0x6B7280)
            .setTitle("⭐ CURSED Server Leveling")
            .addFields(
                { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
                { name: "Level-up channel", value: channel ? `${channel}` : config.levelUpChannelId ? "Missing or inaccessible" : "Not configured", inline: true },
                { name: "XP per message", value: `${config.xpMin}–${config.xpMax}`, inline: true },
                { name: "Cooldown", value: `${config.cooldownSeconds} seconds`, inline: true },
                { name: "Tracking since", value: config.trackingStartedAt ? discordTimestamp(config.trackingStartedAt, "F") : "Not started", inline: true },
                { name: "Ignored channels", value: ignored, inline: false },
                { name: "Spam protection", value: "Commands, very short messages, repeated text, bots, and cooldown messages earn no XP.", inline: false },
            )
            .setFooter({ text: "Configuration view • Manage Server required" })
            .setTimestamp()
        await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (subcommand === "test") {
        const config = await getLevelingConfig(guildId, { fresh: true })
        if (!config.levelUpChannelId) {
            await replyError(interaction, "Set a level-up channel first with `/leveling setup`.")
            return true
        }
        const user = interaction.options.getUser("user") || interaction.user
        const member = interaction.guild.members.cache.get(user.id)
        const ranked = await getMemberRank(guildId, user.id)
        const oldLevel = ranked?.level || 0
        const result = await sendLevelUpAnnouncement({
            guild: interaction.guild,
            user,
            displayName: member?.displayName || user.username,
            oldLevel,
            newLevel: oldLevel + 1,
            channelId: config.levelUpChannelId,
            mention: true,
        })
        if (!result.sent) {
            await replyError(interaction, `The preview could not be sent (${result.reason}).`)
            return true
        }
        await interaction.reply({
            content: `✅ Level-up preview sent to <#${result.channelId}>. No XP was changed.`,
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    return false
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return false

    try {
        if (interaction.commandName === "rank") return handleRank(interaction)
        if (interaction.commandName === "levels") return handleLevels(interaction)
        if (interaction.commandName === "leveling") return handleLevelingAdmin(interaction)
        return false
    } catch (err) {
        log.error(`Leveling command failed: ${err.message}`, {
            guildId: interaction.guildId,
            userId: interaction.user?.id,
            command: interaction.commandName,
            stack: err.stack,
        })
        const known = new Set(["MISSING_PERMISSION", "INVALID_CHANNEL", "BOT_PERMISSION"])
        await replyError(interaction, known.has(err.code) ? err.message : "CURSED could not process that leveling command.")
        return true
    }
}

async function handle() {
    return false
}

for (const command of [rankCommand, levelsCommand, levelingCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) {
        moderation.commands.push(command)
    }
}

if (!moderation.__levelingPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedLevelingInteraction(interaction) {
        if (["rank", "levels", "leveling"].includes(interaction.commandName)) {
            return handleInteraction(interaction)
        }
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__levelingPatched", {
        value: true,
        enumerable: false,
    })
}

module.exports = {
    handle,
    handleInteraction,
    rankCommand,
    levelsCommand,
    levelingCommand,
}
