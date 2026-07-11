/**
 * Moderation commands for CURSED bot.
 *
 * Slash commands:
 *   /warn <user> <reason>
 *   /warnings <user>
 *   /clearwarns <user>
 *   /mute <user> [duration]
 *   /unmute <user>
 *   /kick <user> <reason>
 *   /ban <user> <reason>
 *   /welcome setup|view|preview|test|disable
 *   /autorole set|disable|view
 *
 * Prefix commands (admin convenience):
 *   !setmodlog  — set the current channel as the mod-log channel
 *   !antispam on|off
 *   !antilink on|off
 *   !antiinvite on|off
 *   !whitelist add|remove <domain>
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js")
const { addWarning, getWarnings, clearWarnings } = require("../utils/warnings")
const { logAction } = require("../utils/modlog")
const { getServerConfig, saveConfig } = require("../utils/serverConfig")
const { getWelcome, setWelcome, disableWelcome, testWelcome, buildPreviewEmbed } = require("../utils/welcome")
const { getAutorole, setAutorole, disableAutorole } = require("../utils/autorole")

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
    new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName("user").setDescription("User to warn").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the warning").setRequired(true)),

    new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("Show all warnings for a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName("user").setDescription("User to check").setRequired(true)),

    new SlashCommandBuilder()
        .setName("clearwarns")
        .setDescription("Clear all warnings for a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName("user").setDescription("User to clear warnings for").setRequired(true)),

    new SlashCommandBuilder()
        .setName("mute")
        .setDescription("Timeout (mute) a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName("user").setDescription("User to mute").setRequired(true))
        .addIntegerOption(o => o.setName("duration").setDescription("Duration in minutes (default: 10)").setMinValue(1).setMaxValue(40320)),

    new SlashCommandBuilder()
        .setName("unmute")
        .setDescription("Remove timeout from a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName("user").setDescription("User to unmute").setRequired(true)),

    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the kick").setRequired(true)),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server")
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the ban").setRequired(true)),

    new SlashCommandBuilder()
        .setName("welcome")
        .setDescription("Manage the welcome system")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName("setup")
            .setDescription("Set up the welcome message")
            .addChannelOption(o => o
                .setName("channel")
                .setDescription("Channel to send welcome messages in")
                .setRequired(true))
            .addStringOption(o => o
                .setName("message")
                .setDescription("Welcome message — supports {user}, {mention}, {server}, {membercount}")
                .setRequired(false))
            .addBooleanOption(o => o
                .setName("useai")
                .setDescription("Use AI to generate welcome messages (falls back to custom message on failure)")
                .setRequired(false))
            .addStringOption(o => o
                .setName("color")
                .setDescription("Embed color as a hex code, e.g. #FF5733 (default: Discord blurple)")
                .setRequired(false))
            .addBooleanOption(o => o
                .setName("thumbnail")
                .setDescription("Show the new member's avatar as the embed thumbnail (default: true)")
                .setRequired(false))
            .addStringOption(o => o
                .setName("image")
                .setDescription("URL of a banner image to show at the bottom of the embed")
                .setRequired(false))
            .addStringOption(o => o
                .setName("footer")
                .setDescription("Footer text — supports {membercount} and other placeholders")
                .setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName("view")
            .setDescription("View the current welcome configuration"))
        .addSubcommand(sub => sub
            .setName("preview")
            .setDescription("Preview the welcome embed here (ephemeral, shows exactly what new members will see)"))
        .addSubcommand(sub => sub
            .setName("test")
            .setDescription("Send a live test welcome to the configured welcome channel"))
        .addSubcommand(sub => sub
            .setName("disable")
            .setDescription("Disable the welcome system")),

    new SlashCommandBuilder()
        .setName("autorole")
        .setDescription("Manage the autorole assigned to new members")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub.setName("set")
                .setDescription("Set the role to assign to new members")
                .addRoleOption(o => o.setName("role").setDescription("Role to assign on join").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("disable")
                .setDescription("Disable the autorole for this server")
        )
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View the current autorole configuration")
        ),
]

// ─── Slash command handler ────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return false
    const { commandName, guild, member } = interaction
    if (!guild) return false

    // ── /warn ──────────────────────────────────────────────────────────────────
    if (commandName === "warn") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: "❌ I don't have the **Moderate Members** permission required to warn users.", ephemeral: true })
            return true
        }
        const target   = interaction.options.getUser("user")
        const reason   = interaction.options.getString("reason")
        const warnings = addWarning(
            guild.id, target.id, target.tag,
            reason,
            member.user.id, member.user.tag
        )

        await logAction(guild, {
            action:    "WARN",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
            reason,
            extra:     `Total warnings: **${warnings.length}**`,
        })

        const embed = new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle("⚠️ User Warned")
            .addFields(
                { name: "User",    value: `<@${target.id}>`,             inline: true },
                { name: "Reason",  value: reason,                        inline: true },
                { name: "Total",   value: `${warnings.length} warning(s)`, inline: true },
            )
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
        return true
    }

    // ── /warnings ──────────────────────────────────────────────────────────────
    if (commandName === "warnings") {
        const target   = interaction.options.getUser("user")
        const warnings = getWarnings(guild.id, target.id)

        if (warnings.length === 0) {
            await interaction.reply({ content: `✅ **${target.tag}** has no warnings. Clean record!`, ephemeral: true })
            return true
        }

        const lines = warnings.map((w, i) => {
            const date = new Date(w.timestamp).toLocaleDateString()
            return `**#${i + 1}** — ${w.reason}\n> By ${w.moderatorName} on ${date}`
        })

        const embed = new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle(`⚠️ Warnings for ${target.tag}`)
            .setDescription(lines.join("\n\n"))
            .setFooter({ text: `${warnings.length} total warning(s)` })
            .setTimestamp()

        await interaction.reply({ embeds: [embed], ephemeral: true })
        return true
    }

    // ── /clearwarns ────────────────────────────────────────────────────────────
    if (commandName === "clearwarns") {
        const target = interaction.options.getUser("user")
        const count  = clearWarnings(guild.id, target.id)

        await logAction(guild, {
            action:    "WARN",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
            reason:    `Cleared ${count} warning(s)`,
            extra:     "All warnings removed",
        })

        await interaction.reply({ content: `🗑️ Cleared **${count}** warning(s) for <@${target.id}>.` })
        return true
    }

    // ── /mute ──────────────────────────────────────────────────────────────────
    if (commandName === "mute") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: "❌ I don't have the **Moderate Members** permission required to mute users.", ephemeral: true })
            return true
        }
        const target      = interaction.options.getUser("user")
        const durationMin = interaction.options.getInteger("duration") ?? 10
        const durationMs  = durationMin * 60 * 1000

        const guildMember = guild.members.cache.get(target.id)
        if (!guildMember) {
            await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true })
            return true
        }

        try {
            await guildMember.timeout(durationMs, `Muted by ${member.user.tag}`)
        } catch (err) {
            await interaction.reply({ content: `❌ Could not mute: ${err.message}`, ephemeral: true })
            return true
        }

        await logAction(guild, {
            action:    "MUTE",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
            extra:     `Duration: **${durationMin} minute(s)**`,
        })

        await interaction.reply({ content: `🔇 <@${target.id}> has been muted for **${durationMin} minute(s)**.` })
        return true
    }

    // ── /unmute ────────────────────────────────────────────────────────────────
    if (commandName === "unmute") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: "❌ I don't have the **Moderate Members** permission required to unmute users.", ephemeral: true })
            return true
        }
        const target      = interaction.options.getUser("user")
        const guildMember = guild.members.cache.get(target.id)
        if (!guildMember) {
            await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true })
            return true
        }

        try {
            await guildMember.timeout(null)
        } catch (err) {
            await interaction.reply({ content: `❌ Could not unmute: ${err.message}`, ephemeral: true })
            return true
        }

        await logAction(guild, {
            action:    "UNMUTE",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
        })

        await interaction.reply({ content: `🔊 <@${target.id}> has been unmuted.` })
        return true
    }

    // ── /kick ──────────────────────────────────────────────────────────────────
    if (commandName === "kick") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
            await interaction.reply({ content: "❌ I don't have the **Kick Members** permission required to kick users.", ephemeral: true })
            return true
        }
        const target      = interaction.options.getUser("user")
        const reason      = interaction.options.getString("reason")
        const guildMember = guild.members.cache.get(target.id)
        if (!guildMember) {
            await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true })
            return true
        }

        try {
            await guildMember.kick(reason)
        } catch (err) {
            await interaction.reply({ content: `❌ Could not kick: ${err.message}`, ephemeral: true })
            return true
        }

        await logAction(guild, {
            action:    "KICK",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
            reason,
        })

        await interaction.reply({ content: `👢 **${target.tag}** has been kicked. Reason: ${reason}` })
        return true
    }

    // ── /ban ───────────────────────────────────────────────────────────────────
    if (commandName === "ban") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            await interaction.reply({ content: "❌ I don't have the **Ban Members** permission required to ban users.", ephemeral: true })
            return true
        }
        const target = interaction.options.getUser("user")
        const reason = interaction.options.getString("reason")

        try {
            await guild.members.ban(target.id, { reason })
        } catch (err) {
            await interaction.reply({ content: `❌ Could not ban: ${err.message}`, ephemeral: true })
            return true
        }

        await logAction(guild, {
            action:    "BAN",
            target:    { id: target.id, tag: target.tag },
            moderator: { id: member.user.id, tag: member.user.tag },
            reason,
        })

        await interaction.reply({ content: `🔨 **${target.tag}** has been banned. Reason: ${reason}` })
        return true
    }

    // ── /welcome ───────────────────────────────────────────────────────────────
    if (commandName === "welcome") {
        const sub = interaction.options.getSubcommand()

        // ── /welcome setup ─────────────────────────────────────────────────────
        if (sub === "setup") {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: "❌ You need the **Manage Server** permission to configure the welcome system.", ephemeral: true })
                return true
            }

            const channel   = interaction.options.getChannel("channel")
            const message   = interaction.options.getString("message")   ?? null
            const useAI     = interaction.options.getBoolean("useai")    ?? false
            const colorStr  = interaction.options.getString("color")     ?? null
            const thumbnail = interaction.options.getBoolean("thumbnail") ?? true
            const imageUrl  = interaction.options.getString("image")     ?? null
            const footer    = interaction.options.getString("footer")    ?? null

            // Validate channel is text-based
            if (!channel.isTextBased || !channel.isTextBased()) {
                await interaction.reply({ content: "❌ The welcome channel must be a text channel.", ephemeral: true })
                return true
            }

            // Validate hex color if provided
            if (colorStr && !/^#?[0-9A-Fa-f]{6}$/.test(colorStr)) {
                await interaction.reply({ content: "❌ Invalid color. Use a 6-digit hex code like `#FF5733`.", ephemeral: true })
                return true
            }

            // Validate image URL if provided
            if (imageUrl) {
                try {
                    const u = new URL(imageUrl)
                    if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol")
                } catch {
                    await interaction.reply({ content: "❌ Invalid image URL. It must start with `http://` or `https://`.", ephemeral: true })
                    return true
                }
            }

            setWelcome(guild.id, channel.id, {
                message,
                useAI,
                color:     colorStr,
                thumbnail,
                imageUrl,
                footer,
            })

            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("✅ Welcome System Configured")
                .addFields(
                    { name: "📢 Channel",     value: `<#${channel.id}>`,               inline: true },
                    { name: "🤖 AI Enabled",  value: useAI ? "Yes" : "No",             inline: true },
                    { name: "🖼️ Thumbnail",   value: thumbnail ? "Yes" : "No",         inline: true },
                    { name: "📝 Message",     value: (message || "*(default)*").slice(0, 512), inline: false },
                )
                .setFooter({ text: "Use /welcome preview to see the embed • /welcome test to send a live test" })
                .setTimestamp()

            if (colorStr)  embed.addFields({ name: "🎨 Color",  value: colorStr, inline: true })
            if (footer)    embed.addFields({ name: "📄 Footer", value: footer,   inline: true })
            if (imageUrl)  embed.addFields({ name: "🖼️ Image",  value: imageUrl, inline: false })

            await interaction.reply({ embeds: [embed] })
            return true
        }

        // ── /welcome view ──────────────────────────────────────────────────────
        if (sub === "view") {
            const config = getWelcome(guild.id)

            if (!config.welcomeChannelId) {
                await interaction.reply({ content: "ℹ️ No welcome system is configured for this server. Use `/welcome setup` to get started.", ephemeral: true })
                return true
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("📋 Welcome System Configuration")
                .addFields(
                    { name: "📢 Channel",    value: `<#${config.welcomeChannelId}>`,            inline: true },
                    { name: "🤖 AI Enabled", value: config.welcomeUseAI ? "Yes" : "No",         inline: true },
                    { name: "🖼️ Thumbnail",  value: config.welcomeThumbnail ? "Yes" : "No",     inline: true },
                    { name: "📝 Message",    value: (config.welcomeMessage || "*(default)*").slice(0, 512), inline: false },
                )
                .setFooter({ text: "Use /welcome preview to see the embed • /welcome disable to turn off" })
                .setTimestamp()

            if (config.welcomeColor)    embed.addFields({ name: "🎨 Color",  value: config.welcomeColor,    inline: true })
            if (config.welcomeFooter)   embed.addFields({ name: "📄 Footer", value: config.welcomeFooter,   inline: true })
            if (config.welcomeImageUrl) embed.addFields({ name: "🖼️ Image",  value: config.welcomeImageUrl, inline: false })

            await interaction.reply({ embeds: [embed], ephemeral: true })
            return true
        }

        // ── /welcome preview ───────────────────────────────────────────────────
        if (sub === "preview") {
            const config = getWelcome(guild.id)

            if (!config.welcomeChannelId) {
                await interaction.reply({ content: "⚠️ No welcome system is configured. Use `/welcome setup` first.", ephemeral: true })
                return true
            }

            // Build preview using the command invoker as the "member"
            const previewEmbed = buildPreviewEmbed(config, member)

            await interaction.reply({
                content: "👁️ **Welcome embed preview** — this is what new members will see:",
                embeds: [previewEmbed],
                ephemeral: true,
            })
            return true
        }

        // ── /welcome test ──────────────────────────────────────────────────────
        if (sub === "test") {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: "❌ You need the **Manage Server** permission to test the welcome system.", ephemeral: true })
                return true
            }

            const config = getWelcome(guild.id)
            if (!config.welcomeChannelId) {
                await interaction.reply({ content: "⚠️ No welcome system is configured. Use `/welcome setup` first.", ephemeral: true })
                return true
            }

            await interaction.deferReply({ ephemeral: true })

            const { callAI } = require("../utils/ai")
            try {
                // Fetch the configured welcome channel and send there
                const welcomeChannel = await guild.channels.fetch(config.welcomeChannelId).catch(() => null)
                if (!welcomeChannel) {
                    await interaction.editReply({ content: "❌ The configured welcome channel no longer exists. Update it with `/welcome setup`." })
                    return true
                }
                await testWelcome(welcomeChannel, config, callAI, member)
                await interaction.editReply({ content: `✅ Test welcome sent to <#${config.welcomeChannelId}>!` })
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed to send test welcome: ${err.message}` })
            }
            return true
        }

        // ── /welcome disable ───────────────────────────────────────────────────
        if (sub === "disable") {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: "❌ You need the **Manage Server** permission to configure the welcome system.", ephemeral: true })
                return true
            }

            disableWelcome(guild.id)
            await interaction.reply({ content: "✅ Welcome system has been **disabled**. New members will receive the default AI welcome." })
            return true
        }

        return true
    }

    // ── /autorole ──────────────────────────────────────────────────────────────
    if (commandName === "autorole") {
        const sub = interaction.options.getSubcommand()

        // /autorole set
        if (sub === "set") {
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await interaction.reply({ content: "❌ I don't have the **Manage Roles** permission required to assign roles.", ephemeral: true })
                return true
            }

            const role = interaction.options.getRole("role")

            if (role.managed) {
                await interaction.reply({ content: "❌ That role is managed by an integration and cannot be used as an autorole.", ephemeral: true })
                return true
            }

            const botMember = guild.members.me
            if (botMember.roles.highest.position <= role.position) {
                await interaction.reply({ content: `❌ I can't assign **${role.name}** because it is at or above my highest role in the hierarchy. Move my role above it first.`, ephemeral: true })
                return true
            }

            setAutorole(guild.id, role.id, role.name)

            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("✅ Autorole Set")
                .setDescription(`New members will automatically receive the <@&${role.id}> role when they join.`)
                .setTimestamp()

            await interaction.reply({ embeds: [embed] })
            return true
        }

        // /autorole disable
        if (sub === "disable") {
            const { autoroleId } = getAutorole(guild.id)
            if (!autoroleId) {
                await interaction.reply({ content: "ℹ️ Autorole is not currently configured for this server.", ephemeral: true })
                return true
            }

            disableAutorole(guild.id)

            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle("🚫 Autorole Disabled")
                .setDescription("New members will no longer be automatically assigned a role on join.")
                .setTimestamp()

            await interaction.reply({ embeds: [embed] })
            return true
        }

        // /autorole view
        if (sub === "view") {
            const { autoroleId, autoroleRoleName } = getAutorole(guild.id)

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("🔧 Autorole Configuration")
                .setTimestamp()

            if (autoroleId) {
                const role = guild.roles.cache.get(autoroleId)
                if (role) {
                    embed.setDescription(`**Status:** ✅ Enabled\n**Role:** <@&${autoroleId}> (${role.name})`)
                } else {
                    embed.setDescription(`**Status:** ⚠️ Configured but role no longer exists\n**Role ID:** \`${autoroleId}\` (${autoroleRoleName || "unknown"})\n\nUse \`/autorole disable\` to clear this, or \`/autorole set\` to pick a new role.`)
                }
            } else {
                embed.setDescription("**Status:** ❌ Disabled\n\nUse `/autorole set` to assign a role to new members automatically.")
            }

            await interaction.reply({ embeds: [embed], ephemeral: true })
            return true
        }
    }

    return false
}

// ─── Prefix command handler (admin config) ────────────────────────────────────

async function handlePrefixCommand(message) {
    const msgLower = message.content.toLowerCase().trim()
    const { guild, member } = message

    if (!guild || !member) return false
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator)

    // !setmodlog — save current channel as mod-log channel
    if (msgLower === "!setmodlog") {
        if (!isAdmin) {
            await message.channel.send("❌ You need **Administrator** permission to do that.")
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        config.modLogChannelId = message.channel.id
        saveConfig(data)
        process.env.MOD_LOG_CHANNEL_ID = message.channel.id
        await message.channel.send(`✅ Mod-log channel set to <#${message.channel.id}>. All moderation actions will be logged here.`)
        return true
    }

    // !antispam on|off
    if (msgLower.startsWith("!antispam ")) {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const val = msgLower.split(" ")[1]
        if (!["on", "off"].includes(val)) { await message.channel.send("Usage: `!antispam on|off`"); return true }
        const { data, config } = getServerConfig(guild.id)
        config.antiSpam = val === "on"
        saveConfig(data)
        await message.channel.send(`✅ Anti-spam is now **${val.toUpperCase()}**.`)
        return true
    }

    // !antilink on|off
    if (msgLower.startsWith("!antilink ")) {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const val = msgLower.split(" ")[1]
        if (!["on", "off"].includes(val)) { await message.channel.send("Usage: `!antilink on|off`"); return true }
        const { data, config } = getServerConfig(guild.id)
        config.antiLink = val === "on"
        saveConfig(data)
        await message.channel.send(`✅ Anti-link is now **${val.toUpperCase()}**.`)
        return true
    }

    // !antiinvite on|off
    if (msgLower.startsWith("!antiinvite ")) {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const val = msgLower.split(" ")[1]
        if (!["on", "off"].includes(val)) { await message.channel.send("Usage: `!antiinvite on|off`"); return true }
        const { data, config } = getServerConfig(guild.id)
        config.antiInvite = val === "on"
        saveConfig(data)
        await message.channel.send(`✅ Anti-invite is now **${val.toUpperCase()}**.`)
        return true
    }

    // !whitelist add|remove <domain>
    if (msgLower.startsWith("!whitelist ")) {
        if (!isAdmin) { await message.channel.send("❌ Administrator permission required."); return true }
        const parts  = message.content.trim().split(/\s+/)
        const sub    = parts[1]?.toLowerCase()
        const domain = parts[2]?.toLowerCase()
        if (!["add", "remove"].includes(sub) || !domain) {
            await message.channel.send("Usage: `!whitelist add <domain>` or `!whitelist remove <domain>`")
            return true
        }
        const { data, config } = getServerConfig(guild.id)
        if (!config.linkWhitelist) config.linkWhitelist = []
        if (sub === "add") {
            if (!config.linkWhitelist.includes(domain)) config.linkWhitelist.push(domain)
            await message.channel.send(`✅ **${domain}** added to the link whitelist.`)
        } else {
            config.linkWhitelist = config.linkWhitelist.filter(d => d !== domain)
            await message.channel.send(`✅ **${domain}** removed from the link whitelist.`)
        }
        saveConfig(data)
        return true
    }

    return false
}

module.exports = { commands, handleInteraction, handlePrefixCommand }
