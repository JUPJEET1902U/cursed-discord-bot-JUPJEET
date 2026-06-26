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
const { getAutorole, setAutorole, disableAutorole } = require("../utils/autorole")
const { applyMassRole } = require("../utils/massrole")

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

    // ── /autorole ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("autorole")
        .setDescription("Manage the auto-role assigned to new members")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub.setName("set")
                .setDescription("Set the role to auto-assign to new members")
                .addRoleOption(o => o.setName("role").setDescription("Role to auto-assign").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("disable")
                .setDescription("Disable auto-role for this server")
        )
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View the current auto-role configuration")
        ),

    // ── /massrole ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("massrole")
        .setDescription("Bulk add or remove a role from members")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName("add")
                .setDescription("Add a role to members in bulk")
                .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))
                .addStringOption(o =>
                    o.setName("filter")
                        .setDescription("Which members to target (default: everyone)")
                        .addChoices(
                            { name: "Everyone", value: "everyone" },
                            { name: "Humans only", value: "humans" },
                            { name: "Bots only", value: "bots" },
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName("remove")
                .setDescription("Remove a role from members in bulk")
                .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true))
                .addStringOption(o =>
                    o.setName("filter")
                        .setDescription("Which members to target (default: everyone)")
                        .addChoices(
                            { name: "Everyone", value: "everyone" },
                            { name: "Humans only", value: "humans" },
                            { name: "Bots only", value: "bots" },
                        )
                )
        ),
]

// ─── Slash command handler ────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return false
    const { commandName, guild, member } = interaction
    if (!guild) return false

    // ── /warn ──────────────────────────────────────────────────────────────────
    if (commandName === "warn") {
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
                { name: "User",    value: `<@${target.id}>`,    inline: true },
                { name: "Reason",  value: reason,               inline: true },
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

    // ── /autorole ──────────────────────────────────────────────────────────────
    if (commandName === "autorole") {
        const sub = interaction.options.getSubcommand()

        if (sub === "set") {
            const role = interaction.options.getRole("role")
            const me   = guild.members.me

            // Permission check
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await interaction.reply({ content: "❌ I don't have the **Manage Roles** permission.", ephemeral: true })
                return true
            }

            // Hierarchy check
            if (me.roles.highest.position <= role.position) {
                await interaction.reply({
                    content: `❌ I can't assign **${role.name}** — it's above my highest role in the hierarchy.`,
                    ephemeral: true,
                })
                return true
            }

            await setAutorole(guild.id, role.id, role.name)

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("✅ Autorole Configured")
                .addFields(
                    { name: "Role",    value: `<@&${role.id}>`, inline: true },
                    { name: "Status",  value: "Enabled",        inline: true },
                )
                .setFooter({ text: "New members will automatically receive this role on join." })
                .setTimestamp()

            await interaction.reply({ embeds: [embed] })
            return true
        }

        if (sub === "disable") {
            const existing = await getAutorole(guild.id)
            if (!existing) {
                await interaction.reply({ content: "ℹ️ Autorole is not currently configured for this server.", ephemeral: true })
                return true
            }
            await disableAutorole(guild.id)

            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle("🚫 Autorole Disabled")
                .setDescription("New members will no longer be automatically assigned a role.")
                .setTimestamp()

            await interaction.reply({ embeds: [embed] })
            return true
        }

        if (sub === "view") {
            const config = await getAutorole(guild.id)

            if (!config) {
                const embed = new EmbedBuilder()
                    .setColor(0x99AAB5)
                    .setTitle("🔍 Autorole Configuration")
                    .setDescription("Autorole is **not configured** for this server.\nUse `/autorole set <role>` to enable it.")
                    .setTimestamp()
                await interaction.reply({ embeds: [embed], ephemeral: true })
                return true
            }

            // Verify the role still exists
            const role = guild.roles.cache.get(config.roleId)
            const roleDisplay = role ? `<@&${config.roleId}>` : `~~${config.roleName}~~ *(deleted)*`

            const embed = new EmbedBuilder()
                .setColor(role ? 0x57F287 : 0xED4245)
                .setTitle("🔍 Autorole Configuration")
                .addFields(
                    { name: "Role",       value: roleDisplay,                                    inline: true },
                    { name: "Status",     value: role ? "✅ Active" : "⚠️ Role deleted",         inline: true },
                    { name: "Configured", value: `<t:${Math.floor(new Date(config.createdAt).getTime() / 1000)}:R>`, inline: true },
                )
                .setTimestamp()

            await interaction.reply({ embeds: [embed], ephemeral: true })
            return true
        }
    }

    // ── /massrole ──────────────────────────────────────────────────────────────
    if (commandName === "massrole") {
        const sub    = interaction.options.getSubcommand()
        const role   = interaction.options.getRole("role")
        const filter = interaction.options.getString("filter") ?? "everyone"
        const isAdd  = sub === "add"

        const me = guild.members.me

        // Permission check
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.reply({ content: "❌ I don't have the **Manage Roles** permission.", ephemeral: true })
            return true
        }

        // Hierarchy check
        if (me.roles.highest.position <= role.position) {
            await interaction.reply({
                content: `❌ I can't manage **${role.name}** — it's above my highest role in the hierarchy.`,
                ephemeral: true,
            })
            return true
        }

        const filterLabel = filter === "humans" ? "humans" : filter === "bots" ? "bots" : "everyone"
        const actionLabel = isAdd ? "Adding" : "Removing"

        // Defer — this can take a while
        await interaction.deferReply()
        await interaction.editReply({
            content: `⏳ **${actionLabel}** role **${role.name}** to/from **${filterLabel}**… This may take a while.`,
        })

        const counts = await applyMassRole(guild, role, filter, isAdd)

        const embed = new EmbedBuilder()
            .setColor(isAdd ? 0x57F287 : 0xED4245)
            .setTitle(`${isAdd ? "➕" : "➖"} Mass Role — ${isAdd ? "Add" : "Remove"} Complete`)
            .addFields(
                { name: "Role",    value: `<@&${role.id}>`,          inline: true },
                { name: "Filter",  value: filterLabel,               inline: true },
                { name: "\u200B",  value: "\u200B",                  inline: true },
                { name: "✅ Added",   value: `${counts.added}`,   inline: true },
                { name: "🗑️ Removed", value: `${counts.removed}`, inline: true },
                { name: "⏭️ Skipped", value: `${counts.skipped}`, inline: true },
                { name: "❌ Failed",  value: `${counts.failed}`,  inline: true },
            )
            .setTimestamp()

        await interaction.editReply({ content: null, embeds: [embed] })
        return true
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
        // Also set env-like variable at runtime (for this process only)
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
        const parts = message.content.trim().split(/\s+/)
        const sub   = parts[1]?.toLowerCase()
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
