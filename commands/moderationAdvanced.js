const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require("discord.js")
const mongoose = require("mongoose")
const { getModerationConfig, isModerator } = require("../utils/moderationConfig")
const {
    getPhase2Config,
    getWhitelistMatch,
    isCommandEnabled,
} = require("../utils/moderationPhase2Config")
const { validateModerationTarget } = require("../utils/moderationSafety")
const { logAction } = require("../utils/modlog")
const { createCase, listCases } = require("../utils/moderationCases")
const { scheduleTempbanUnban } = require("../utils/moderationTasks")
const { lockChannel, unlockChannel } = require("../utils/channelLockState")

const COMMAND_NAMES = new Set([
    "purge",
    "lock",
    "unlock",
    "slowmode",
    "nickname",
    "tempban",
    "softban",
    "note",
    "history",
])

const commands = [
    new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Delete a filtered batch of recent messages")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option => option.setName("amount").setDescription("Maximum messages to delete").setMinValue(1).setMaxValue(100).setRequired(true))
        .addUserOption(option => option.setName("user").setDescription("Only delete messages from this user"))
        .addBooleanOption(option => option.setName("bots").setDescription("Only delete bot messages"))
        .addStringOption(option => option.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(100)),

    new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock a text channel while preserving its previous permissions")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option => option.setName("channel").setDescription("Channel to lock").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(option => option.setName("reason").setDescription("Reason for locking the channel").setMaxLength(1000)),

    new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Restore a channel's permissions from its saved lock state")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option => option.setName("channel").setDescription("Channel to unlock").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(option => option.setName("reason").setDescription("Reason for unlocking the channel").setMaxLength(1000)),

    new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set or disable slowmode in a text channel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addIntegerOption(option => option.setName("seconds").setDescription("0 disables slowmode; maximum 21600").setMinValue(0).setMaxValue(21600).setRequired(true))
        .addChannelOption(option => option.setName("channel").setDescription("Channel to update").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(option => option.setName("reason").setDescription("Reason for changing slowmode").setMaxLength(1000)),

    new SlashCommandBuilder()
        .setName("nickname")
        .setDescription("Set or clear a member's server nickname")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .addUserOption(option => option.setName("user").setDescription("Member to update").setRequired(true))
        .addStringOption(option => option.setName("nickname").setDescription("New nickname; omit to reset").setMaxLength(32))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the nickname change").setMaxLength(1000)),

    new SlashCommandBuilder()
        .setName("tempban")
        .setDescription("Ban a user temporarily; expiry survives bot restarts")
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName("user").setDescription("User to temporarily ban").setRequired(true))
        .addStringOption(option => option.setName("duration").setDescription("Examples: 30m, 2h, 7d").setRequired(true).setMaxLength(20))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the temporary ban").setMaxLength(1000))
        .addAttachmentOption(option => option.setName("evidence").setDescription("Optional evidence attachment")),

    new SlashCommandBuilder()
        .setName("softban")
        .setDescription("Ban and immediately unban a user to remove recent messages")
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName("user").setDescription("User to softban").setRequired(true))
        .addIntegerOption(option => option.setName("delete_days").setDescription("Days of messages to remove").setMinValue(0).setMaxValue(7))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the softban").setMaxLength(1000))
        .addAttachmentOption(option => option.setName("evidence").setDescription("Optional evidence attachment")),

    new SlashCommandBuilder()
        .setName("note")
        .setDescription("Add a private moderator note to a user's case history")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName("user").setDescription("User the note is about").setRequired(true))
        .addStringOption(option => option.setName("text").setDescription("Private moderator note").setRequired(true).setMaxLength(2000))
        .addAttachmentOption(option => option.setName("evidence").setDescription("Optional evidence attachment")),

    new SlashCommandBuilder()
        .setName("history")
        .setDescription("View a user's recent moderation history")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName("user").setDescription("User to inspect").setRequired(true))
        .addIntegerOption(option => option.setName("limit").setDescription("Number of cases to show").setMinValue(1).setMaxValue(20)),
]

function actor(interaction) {
    return {
        id: interaction.user.id,
        tag: interaction.user.tag || interaction.user.username,
    }
}

function target(user) {
    return { id: user.id, tag: user.tag || user.username }
}

function safeReply(interaction, payload) {
    const body = {
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
        ...payload,
    }
    if (interaction.deferred || interaction.replied) return interaction.followUp(body)
    return interaction.reply(body)
}

function parseDuration(input) {
    const text = String(input || "").trim().toLowerCase()
    const match = text.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/)
    if (!match) return null
    const amount = Number(match[1])
    const unit = match[2][0]
    const multiplier = unit === "m"
        ? 60 * 1000
        : unit === "h"
            ? 60 * 60 * 1000
            : unit === "d"
                ? 24 * 60 * 60 * 1000
                : 7 * 24 * 60 * 60 * 1000
    const durationMs = amount * multiplier
    const max = 365 * 24 * 60 * 60 * 1000
    if (!Number.isSafeInteger(durationMs) || durationMs < 60 * 1000 || durationMs > max) return null
    return durationMs
}

function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes} minute(s)`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour(s)`
    const days = Math.floor(hours / 24)
    return `${days} day(s)`
}

function requiredReason(interaction, moderationConfig, fallback) {
    const reason = interaction.options.getString("reason")?.trim() || ""
    if (moderationConfig.requireModerationReason && !reason) return null
    return reason || fallback
}

function isAdministrator(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true
}

async function guard(interaction, commandName, { dangerous = false } = {}) {
    if (!interaction.inGuild() || !interaction.isChatInputCommand()) return { ok: false, handled: false }
    const moderationConfig = getModerationConfig(interaction.guildId)
    const phase2 = getPhase2Config(interaction.guildId)

    if (!moderationConfig.moderationCommandsEnabled || !phase2.advancedModerationEnabled) {
        await safeReply(interaction, { content: "⛔ Advanced moderation is disabled in this server.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (!isCommandEnabled(phase2, commandName)) {
        await safeReply(interaction, { content: "⛔ That moderation command is disabled in this server.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (!isModerator(interaction.member, moderationConfig)) {
        await safeReply(interaction, { content: "❌ You are not authorized to use CURSED moderation commands.", ephemeral: true })
        return { ok: false, handled: true }
    }
    if (dangerous && phase2.dangerousCommandsAdminOnly && !isAdministrator(interaction)) {
        await safeReply(interaction, { content: "❌ This server restricts dangerous moderation commands to administrators.", ephemeral: true })
        return { ok: false, handled: true }
    }
    return { ok: true, moderationConfig, phase2, handled: true }
}

async function checkTargetWhitelist(interaction, user, phase2) {
    const member = interaction.guild.members.cache.get(user.id)
        || await interaction.guild.members.fetch(user.id).catch(() => null)
    const match = getWhitelistMatch({
        guildId: interaction.guildId,
        member,
        userId: user.id,
        channelId: interaction.channelId,
        isBot: user.bot,
    })
    if (match && phase2.whitelist.protectFromManualModeration && interaction.user.id !== interaction.guild.ownerId) {
        await safeReply(interaction, {
            content: `🛡️ That target is protected by the moderation whitelist (${match.type}). Only the server owner can override it.`,
            ephemeral: true,
        })
        return false
    }
    return true
}

async function handlePurge(interaction, guardResult) {
    const requested = interaction.options.getInteger("amount", true)
    const max = guardResult.phase2.maxPurgeAmount
    if (requested > max) {
        await safeReply(interaction, { content: `❌ This server limits purge operations to **${max}** messages.`, ephemeral: true })
        return true
    }
    const channel = interaction.channel
    if (!channel?.messages?.fetch || !channel.bulkDelete) {
        await safeReply(interaction, { content: "❌ This channel does not support bulk message deletion.", ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await safeReply(interaction, { content: "❌ I need **Manage Messages** permission.", ephemeral: true })
        return true
    }

    await interaction.deferReply({ ephemeral: true })
    const user = interaction.options.getUser("user")
    const botsOnly = interaction.options.getBoolean("bots") === true
    const contains = interaction.options.getString("contains")?.toLowerCase() || null
    const fetched = await channel.messages.fetch({ limit: 100 })
    const candidates = fetched.filter(message => {
        if (message.pinned) return false
        if (user && message.author.id !== user.id) return false
        if (botsOnly && !message.author.bot) return false
        if (contains && !message.content.toLowerCase().includes(contains)) return false
        return true
    }).first(requested)

    if (!candidates.length) {
        await interaction.editReply("ℹ️ No recent messages matched those filters.")
        return true
    }

    const deleted = await channel.bulkDelete(candidates, true)
    const result = await logAction(interaction.guild, {
        action: "PURGE",
        target: { id: channel.id, tag: `#${channel.name}` },
        moderator: actor(interaction),
        reason: "Bulk message cleanup",
        extra: `Deleted **${deleted.size}** message(s).`,
        metadata: {
            targetType: "channel",
            channelId: channel.id,
            filters: { userId: user?.id || null, botsOnly, contains },
        },
    })
    await interaction.editReply(`🧹 Deleted **${deleted.size}** recent message(s).${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`)
    return true
}

async function handleLock(interaction, guardResult, unlock = false) {
    const channel = interaction.options.getChannel("channel") || interaction.channel
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        await safeReply(interaction, { content: "❌ Choose a text or announcement channel.", ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await safeReply(interaction, { content: "❌ I need **Manage Channels** permission.", ephemeral: true })
        return true
    }
    const reason = interaction.options.getString("reason")?.trim() || (unlock ? "Channel unlocked" : "Channel locked")
    try {
        if (unlock) {
            const restored = await unlockChannel(channel, reason)
            if (!restored.restored) {
                await safeReply(interaction, { content: `ℹ️ ${restored.message}`, ephemeral: true })
                return true
            }
        } else {
            await lockChannel(channel, actor(interaction), reason)
        }
        const action = unlock ? "UNLOCK" : "LOCK"
        const result = await logAction(interaction.guild, {
            action,
            target: { id: channel.id, tag: `#${channel.name}` },
            moderator: actor(interaction),
            reason,
            metadata: { targetType: "channel", channelId: channel.id },
        })
        await safeReply(interaction, {
            content: `${unlock ? "🔓" : "🔒"} <#${channel.id}> has been **${unlock ? "unlocked" : "locked"}**.${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`,
            ephemeral: true,
        })
    } catch (err) {
        await safeReply(interaction, { content: `❌ Could not ${unlock ? "unlock" : "lock"} the channel: ${err.message}`, ephemeral: true })
    }
    return true
}

async function handleSlowmode(interaction) {
    const channel = interaction.options.getChannel("channel") || interaction.channel
    const seconds = interaction.options.getInteger("seconds", true)
    if (!channel?.setRateLimitPerUser) {
        await safeReply(interaction, { content: "❌ This channel does not support slowmode.", ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await safeReply(interaction, { content: "❌ I need **Manage Channels** permission.", ephemeral: true })
        return true
    }
    const reason = interaction.options.getString("reason")?.trim() || "Slowmode updated"
    await channel.setRateLimitPerUser(seconds, reason)
    const result = await logAction(interaction.guild, {
        action: "SLOWMODE",
        target: { id: channel.id, tag: `#${channel.name}` },
        moderator: actor(interaction),
        reason,
        extra: seconds === 0 ? "Slowmode disabled" : `Slowmode set to **${seconds} seconds**`,
        metadata: { targetType: "channel", channelId: channel.id, seconds },
    })
    await safeReply(interaction, {
        content: seconds === 0
            ? `🐢 Slowmode disabled in <#${channel.id}>.${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`
            : `🐢 Slowmode set to **${seconds}s** in <#${channel.id}>.${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`,
        ephemeral: true,
    })
    return true
}

async function handleNickname(interaction, guardResult) {
    const user = interaction.options.getUser("user", true)
    if (!await checkTargetWhitelist(interaction, user, guardResult.phase2)) return true
    const safety = await validateModerationTarget({
        guild: interaction.guild,
        actorMember: interaction.member,
        targetUser: user,
        action: "NICKNAME",
        skipActorPermission: true,
    })
    if (!safety.ok) {
        await safeReply(interaction, { content: `❌ ${safety.error}`, ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        await safeReply(interaction, { content: "❌ I need **Manage Nicknames** permission.", ephemeral: true })
        return true
    }
    const nickname = interaction.options.getString("nickname")?.trim() || null
    const reason = requiredReason(interaction, guardResult.moderationConfig, nickname ? "Nickname changed" : "Nickname reset")
    if (reason === null) {
        await safeReply(interaction, { content: "❌ A reason is required by this server's moderation settings.", ephemeral: true })
        return true
    }
    await safety.targetMember.setNickname(nickname, reason)
    const result = await logAction(interaction.guild, {
        action: "NICKNAME",
        target: target(user),
        moderator: actor(interaction),
        reason,
        extra: nickname ? `New nickname: **${nickname}**` : "Nickname reset",
        metadata: { nickname },
    })
    await safeReply(interaction, {
        content: `✅ ${nickname ? `Nickname changed to **${nickname}**` : "Nickname reset"} for **${user.tag}**.${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`,
        ephemeral: true,
    })
    return true
}

async function handleTempban(interaction, guardResult) {
    if (!guardResult.phase2.tempBansEnabled) {
        await safeReply(interaction, { content: "⛔ Temporary bans are disabled in this server.", ephemeral: true })
        return true
    }
    if (mongoose.connection.readyState !== 1) {
        await safeReply(interaction, { content: "❌ MongoDB is unavailable, so a restart-safe temporary ban cannot be created.", ephemeral: true })
        return true
    }
    const user = interaction.options.getUser("user", true)
    if (!await checkTargetWhitelist(interaction, user, guardResult.phase2)) return true
    const durationMs = parseDuration(interaction.options.getString("duration", true))
    if (!durationMs) {
        await safeReply(interaction, { content: "❌ Invalid duration. Use values such as `30m`, `2h`, `7d`, or `2w` (maximum one year).", ephemeral: true })
        return true
    }
    const reason = requiredReason(interaction, guardResult.moderationConfig, "Temporary ban")
    if (reason === null) {
        await safeReply(interaction, { content: "❌ A reason is required by this server's moderation settings.", ephemeral: true })
        return true
    }
    const safety = await validateModerationTarget({
        guild: interaction.guild,
        actorMember: interaction.member,
        targetUser: user,
        action: "TEMPBAN",
        skipActorPermission: true,
    })
    if (!safety.ok) {
        await safeReply(interaction, { content: `❌ ${safety.error}`, ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await safeReply(interaction, { content: "❌ I need **Ban Members** permission.", ephemeral: true })
        return true
    }

    const evidence = interaction.options.getAttachment("evidence")
    if (guardResult.moderationConfig.dmPunishedUsers) {
        await user.send(`🔨 You were temporarily banned from **${interaction.guild.name}** for **${formatDuration(durationMs)}**.\nReason: ${reason}`).catch(() => {})
    }

    await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: 0 })
    const logged = await logAction(interaction.guild, {
        action: "TEMPBAN",
        target: target(user),
        moderator: actor(interaction),
        reason,
        durationMs,
        evidenceUrl: evidence?.url || null,
        extra: `Duration: **${formatDuration(durationMs)}**`,
    })

    try {
        await scheduleTempbanUnban({
            guildId: interaction.guildId,
            target: target(user),
            caseNumber: logged.caseRecord?.caseNumber || null,
            executeAt: new Date(Date.now() + durationMs),
            reason,
        })
    } catch (err) {
        await interaction.guild.members.unban(user.id, "Temporary ban scheduling failed; safety rollback").catch(() => {})
        await safeReply(interaction, { content: `❌ The expiry task could not be saved, so the ban was rolled back: ${err.message}`, ephemeral: true })
        return true
    }

    await safeReply(interaction, {
        content: `⏳ **${user.tag}** was banned for **${formatDuration(durationMs)}**.${logged.caseRecord ? ` Case #${logged.caseRecord.caseNumber}.` : ""}`,
        ephemeral: true,
    })
    return true
}

async function handleSoftban(interaction, guardResult) {
    if (!guardResult.phase2.softbansEnabled) {
        await safeReply(interaction, { content: "⛔ Softbans are disabled in this server.", ephemeral: true })
        return true
    }
    const user = interaction.options.getUser("user", true)
    if (!await checkTargetWhitelist(interaction, user, guardResult.phase2)) return true
    const reason = requiredReason(interaction, guardResult.moderationConfig, "Softban")
    if (reason === null) {
        await safeReply(interaction, { content: "❌ A reason is required by this server's moderation settings.", ephemeral: true })
        return true
    }
    const safety = await validateModerationTarget({
        guild: interaction.guild,
        actorMember: interaction.member,
        targetUser: user,
        action: "SOFTBAN",
        skipActorPermission: true,
    })
    if (!safety.ok) {
        await safeReply(interaction, { content: `❌ ${safety.error}`, ephemeral: true })
        return true
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await safeReply(interaction, { content: "❌ I need **Ban Members** permission.", ephemeral: true })
        return true
    }

    const deleteDays = interaction.options.getInteger("delete_days") ?? 1
    const evidence = interaction.options.getAttachment("evidence")
    if (guardResult.moderationConfig.dmPunishedUsers) {
        await user.send(`🧹 You were softbanned from **${interaction.guild.name}**.\nReason: ${reason}\nYou may rejoin using a valid invite.`).catch(() => {})
    }
    await interaction.guild.members.ban(user.id, {
        reason,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
    })
    await interaction.guild.members.unban(user.id, "Softban completed")
    const result = await logAction(interaction.guild, {
        action: "SOFTBAN",
        target: target(user),
        moderator: actor(interaction),
        reason,
        evidenceUrl: evidence?.url || null,
        extra: `Deleted up to **${deleteDays} day(s)** of recent messages.`,
        metadata: { deleteDays },
    })
    await safeReply(interaction, {
        content: `🧹 **${user.tag}** was softbanned and can rejoin.${result.caseRecord ? ` Case #${result.caseRecord.caseNumber}.` : ""}`,
        ephemeral: true,
    })
    return true
}

async function handleNote(interaction, guardResult) {
    if (!guardResult.phase2.moderatorNotesEnabled) {
        await safeReply(interaction, { content: "⛔ Moderator notes are disabled in this server.", ephemeral: true })
        return true
    }
    const user = interaction.options.getUser("user", true)
    const text = interaction.options.getString("text", true).trim()
    const evidence = interaction.options.getAttachment("evidence")
    const record = await createCase({
        guildId: interaction.guildId,
        action: "NOTE",
        target: target(user),
        moderator: actor(interaction),
        reason: text,
        evidenceUrl: evidence?.url || null,
        source: "manual",
        metadata: { private: true, note: text },
    })
    if (!record) {
        await safeReply(interaction, { content: "❌ The private note could not be persisted because MongoDB is unavailable.", ephemeral: true })
        return true
    }
    await safeReply(interaction, { content: `📝 Private note saved as case **#${record.caseNumber}** for **${user.tag}**.`, ephemeral: true })
    return true
}

async function handleHistory(interaction) {
    const user = interaction.options.getUser("user", true)
    const limit = interaction.options.getInteger("limit") ?? 10
    const cases = await listCases(interaction.guildId, { targetId: user.id, limit })
    if (!cases.length) {
        await safeReply(interaction, { content: `✅ **${user.tag}** has no persisted moderation history.`, ephemeral: true })
        return true
    }
    const lines = cases.map(record => {
        const date = record.createdAt ? `<t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:d>` : "Unknown date"
        return `**#${record.caseNumber} · ${record.action.replace(/_/g, " ")}** — ${record.status}\n${record.reason.slice(0, 180)} · ${date}`
    })
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🗂️ Moderation history for ${user.tag}`)
        .setDescription(lines.join("\n\n").slice(0, 4000))
        .setFooter({ text: `${cases.length} recent case(s)` })
        .setTimestamp()
    await safeReply(interaction, { embeds: [embed], ephemeral: true })
    return true
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !COMMAND_NAMES.has(interaction.commandName)) return false
    const dangerous = ["purge", "lock", "unlock", "tempban", "softban"].includes(interaction.commandName)
    const guardResult = await guard(interaction, interaction.commandName, { dangerous })
    if (!guardResult.ok) return guardResult.handled

    try {
        if (interaction.commandName === "purge") return handlePurge(interaction, guardResult)
        if (interaction.commandName === "lock") return handleLock(interaction, guardResult, false)
        if (interaction.commandName === "unlock") return handleLock(interaction, guardResult, true)
        if (interaction.commandName === "slowmode") return handleSlowmode(interaction)
        if (interaction.commandName === "nickname") return handleNickname(interaction, guardResult)
        if (interaction.commandName === "tempban") return handleTempban(interaction, guardResult)
        if (interaction.commandName === "softban") return handleSoftban(interaction, guardResult)
        if (interaction.commandName === "note") return handleNote(interaction, guardResult)
        if (interaction.commandName === "history") return handleHistory(interaction)
    } catch (err) {
        await safeReply(interaction, { content: `❌ Moderation command failed safely: ${err.message}`, ephemeral: true }).catch(() => {})
        return true
    }
    return false
}

module.exports = {
    commands,
    COMMAND_NAMES,
    handleInteraction,
    parseDuration,
}
