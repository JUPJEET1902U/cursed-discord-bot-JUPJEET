const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js")
const moderation = require("./moderation")
const {
    getServerConfig,
    updateGuildConfigAndWait,
} = require("../utils/serverConfig")
const {
    DEFAULT_PHASE2_CONFIG,
    getPhase2Config,
} = require("../utils/moderationPhase2Config")
const {
    DEFAULT_SECURITY_PHASE3_CONFIG,
    TRUSTED_SCOPES,
    getSecurityPhase3Config,
} = require("../utils/securityPhase3Config")
const {
    buildEmbed,
    COLORS,
    security: securityEmbed,
    admin: adminEmbed,
    statusLine,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const logger = require("../utils/logger")

const log = logger.child("ProtectionControl")
const COMMAND_NAMES = new Set(["automod", "antinuke"])
const AUTOMOD_RULES = Object.freeze(["spam", "links", "invites", "message_shield"])
const ANTINUKE_EVENTS = Object.freeze([
    "bans", "kicks", "channelDeletes", "channelCreates", "channelUpdates",
    "roleDeletes", "roleCreates", "roleUpdates", "webhookChanges",
    "dangerousRoleChanges", "botAdds", "guildUpdates",
])
const TRUST_SCOPES = Object.freeze([
    "massModeration", "manageChannels", "manageRoles", "manageGuild", "addBots", "manageWebhooks",
])

const automodCommand = new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure CURSED automatic moderation")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("status").setDescription("Show AutoMod configuration"))
    .addSubcommand(sub => sub.setName("rule").setDescription("Enable or disable one AutoMod rule")
        .addStringOption(option => option.setName("rule").setDescription("Rule").setRequired(true).addChoices(
            { name: "Spam", value: "spam" },
            { name: "Links", value: "links" },
            { name: "Discord invites", value: "invites" },
            { name: "Message Shield", value: "message_shield" },
        ))
        .addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable this rule").setRequired(true)))
    .addSubcommand(sub => sub.setName("punishment").setDescription("Set the default response for link/invite/spam violations")
        .addStringOption(option => option.setName("action").setDescription("Default action").setRequired(true).addChoices(
            { name: "Delete message", value: "delete" },
            { name: "Delete + timeout", value: "timeout" },
        ))
        .addIntegerOption(option => option.setName("minutes").setDescription("Timeout duration when timeout is selected").setMinValue(1).setMaxValue(40320)))
    .addSubcommandGroup(group => group.setName("ignore").setDescription("Manage AutoMod exemptions")
        .addSubcommand(sub => sub.setName("add").setDescription("Add an AutoMod exemption")
            .addUserOption(option => option.setName("user").setDescription("User to exempt"))
            .addRoleOption(option => option.setName("role").setDescription("Role to exempt"))
            .addChannelOption(option => option.setName("channel").setDescription("Channel to exempt")))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove an AutoMod exemption")
            .addUserOption(option => option.setName("user").setDescription("User to remove"))
            .addRoleOption(option => option.setName("role").setDescription("Role to remove"))
            .addChannelOption(option => option.setName("channel").setDescription("Channel to remove")))
        .addSubcommand(sub => sub.setName("list").setDescription("List AutoMod exemptions"))
        .addSubcommand(sub => sub.setName("reset").setDescription("Clear AutoMod exemptions")))
    .addSubcommand(sub => sub.setName("reset").setDescription("Reset AutoMod rules to safe defaults"))

const antinukeCommand = new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription("Configure CURSED anti-nuke protection")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("status").setDescription("Show anti-nuke status and thresholds"))
    .addSubcommand(sub => sub.setName("enable").setDescription("Enable anti-nuke protection"))
    .addSubcommand(sub => sub.setName("disable").setDescription("Disable anti-nuke protection (server owner only)"))
    .addSubcommand(sub => sub.setName("action").setDescription("Set the anti-nuke response")
        .addStringOption(option => option.setName("action").setDescription("Response").setRequired(true).addChoices(
            { name: "Alert only", value: "alert" },
            { name: "Quarantine", value: "quarantine" },
            { name: "Lockdown", value: "lockdown" },
            { name: "Neutralize", value: "neutralize" },
        )))
    .addSubcommand(sub => sub.setName("limit").setDescription("Set an action threshold")
        .addStringOption(option => option.setName("event").setDescription("Protected event").setRequired(true).addChoices(
            ...ANTINUKE_EVENTS.map(value => ({ name: value.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()), value }))
        ))
        .addIntegerOption(option => option.setName("limit").setDescription("Allowed actions inside the configured window").setRequired(true).setMinValue(1).setMaxValue(50)))
    .addSubcommandGroup(group => group.setName("trust").setDescription("Manage scoped anti-nuke trust")
        .addSubcommand(sub => sub.setName("add").setDescription("Trust a user or role for one protection scope")
            .addUserOption(option => option.setName("user").setDescription("Trusted user"))
            .addRoleOption(option => option.setName("role").setDescription("Trusted role"))
            .addStringOption(option => option.setName("scope").setDescription("Allowed scope").setRequired(true).addChoices(
                ...TRUST_SCOPES.map(value => ({ name: value, value }))
            )))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove a trusted user or role")
            .addUserOption(option => option.setName("user").setDescription("User to remove"))
            .addRoleOption(option => option.setName("role").setDescription("Role to remove")))
        .addSubcommand(sub => sub.setName("list").setDescription("List scoped trusted users and roles")))
    .addSubcommand(sub => sub.setName("reset").setDescription("Reset Anti-Nuke configuration (server owner only)"))

function canManage(interaction) {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
}

function requireOwnerIdentity(guild, userId) {
    if (String(guild?.ownerId) !== String(userId)) throw new Error("Only the server owner can perform this action")
}

function clone(value) {
    return JSON.parse(JSON.stringify(value || {}))
}

function rawSecurity(guildId) {
    const raw = clone(getServerConfig(guildId).config.securityPhase3 || {})
    raw.antiNuke = { ...clone(DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke), ...(raw.antiNuke || {}) }
    raw.messageShield = { ...clone(DEFAULT_SECURITY_PHASE3_CONFIG.messageShield), ...(raw.messageShield || {}) }
    raw.trusted = { ...clone(DEFAULT_SECURITY_PHASE3_CONFIG.trusted), ...(raw.trusted || {}) }
    raw.trusted.entries = Array.isArray(raw.trusted.entries) ? raw.trusted.entries : []
    return raw
}

function rawPhase2(guildId) {
    const raw = clone(getServerConfig(guildId).config.moderationPhase2 || {})
    const normalized = getPhase2Config(guildId)
    return {
        ...clone(DEFAULT_PHASE2_CONFIG),
        ...normalized,
        ...raw,
        commandToggles: { ...normalized.commandToggles, ...(raw.commandToggles || {}) },
        logging: { ...normalized.logging, ...(raw.logging || {}) },
        whitelist: { ...normalized.whitelist, ...(raw.whitelist || {}) },
    }
}

async function saveSecurity(guildId, securityPhase3) {
    return updateGuildConfigAndWait(guildId, { securityPhase3 })
}

async function savePhase2(guildId, moderationPhase2) {
    return updateGuildConfigAndWait(guildId, { moderationPhase2 })
}

function yesNo(value) {
    return value ? "Enabled" : "Disabled"
}

function automodStatusEmbed(guildId) {
    const raw = getServerConfig(guildId).config
    const security = getSecurityPhase3Config(guildId)
    const phase2 = getPhase2Config(guildId)
    const policy = raw.automodPolicy && typeof raw.automodPolicy === "object" ? raw.automodPolicy : null
    const ignored = phase2.whitelist
    return adminEmbed("AutoMod", "Automatic message protection and scoped exemptions.", {
        fields: [
            { name: "Spam", value: yesNo(raw.antiSpam === true), inline: true },
            { name: "Links", value: yesNo(raw.antiLink === true), inline: true },
            { name: "Invites", value: yesNo(raw.antiInvite === true), inline: true },
            { name: "Message Shield", value: yesNo(security.enabled && security.messageShield.enabled), inline: true },
            { name: "Default response", value: policy ? (policy.action === "timeout" ? `Delete + ${policy.timeoutMinutes || 1}m timeout` : "Delete") : "Per-rule defaults", inline: true },
            { name: "Ignored", value: `${ignored.userIds.length} users · ${ignored.roleIds.length} roles · ${ignored.channelIds.length} channels`, inline: true },
        ],
        footer: "CURSED • AutoMod",
    })
}

function automodIgnoreEmbed(guildId) {
    const ignored = getPhase2Config(guildId).whitelist
    return adminEmbed("AutoMod exemptions", null, {
        fields: [
            { name: "Users", value: ignored.userIds.length ? ignored.userIds.map(id => `<@${id}>`).join("\n") : "None", inline: true },
            { name: "Roles", value: ignored.roleIds.length ? ignored.roleIds.map(id => `<@&${id}>`).join("\n") : "None", inline: true },
            { name: "Channels", value: ignored.channelIds.length ? ignored.channelIds.map(id => `<#${id}>`).join("\n") : "None", inline: true },
        ],
        footer: "CURSED • AutoMod",
    })
}

function thresholdLines(config) {
    return Object.entries(config.antiNuke.thresholds)
        .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: **${value}**`)
        .join("\n")
}

function antinukeStatusEmbed(guildId) {
    const config = getSecurityPhase3Config(guildId)
    return securityEmbed("Anti-Nuke", "Protection against destructive server actions.", {
        fields: [
            { name: "Protection", value: config.enabled && config.antiNuke.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Response", value: config.antiNuke.action, inline: true },
            { name: "Window", value: `${config.antiNuke.windowSeconds}s`, inline: true },
            { name: "Thresholds", value: thresholdLines(config), inline: false },
            { name: "Recovery", value: [
                `Channels: ${config.antiNuke.restoreDeletedChannels ? "restore" : "log only"}`,
                `Roles: ${config.antiNuke.restoreDeletedRoles ? "restore" : "log only"}`,
                `Malicious bots: ${config.antiNuke.banMaliciousBots ? "remove" : "configured action only"}`,
            ].join("\n"), inline: false },
        ],
    })
}

function antinukeTrustEmbed(guildId) {
    const config = getSecurityPhase3Config(guildId)
    const entries = config.trusted.entries.filter(entry => entry.scopes.some(scope => TRUST_SCOPES.includes(scope)))
    return securityEmbed("Anti-Nuke trust", entries.length
        ? entries.map(entry => `**${entry.subjectType}** <@${entry.subjectType === "role" ? "&" : ""}${entry.subjectId}>\n${entry.scopes.join(", ")}`).join("\n\n")
        : "No scoped trust entries configured.", {
        color: COLORS.primary,
    })
}

function getSelectedSubject(interaction) {
    const user = interaction.options.getUser("user")
    const role = interaction.options.getRole("role")
    if ((user && role) || (!user && !role)) throw new Error("Choose exactly one user or role")
    return user
        ? { subjectType: user.bot ? "bot" : "user", subjectId: user.id }
        : { subjectType: "role", subjectId: role.id }
}

async function handleAutomodInteraction(interaction) {
    if (!canManage(interaction)) throw new Error("Manage Server is required")
    const group = interaction.options.getSubcommandGroup(false)
    const sub = interaction.options.getSubcommand()
    const guildId = interaction.guildId

    if (!group && sub === "status") {
        await interaction.reply({ embeds: [automodStatusEmbed(guildId)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "rule") {
        const rule = interaction.options.getString("rule", true)
        const enabled = interaction.options.getBoolean("enabled", true)
        if (rule === "spam") await updateGuildConfigAndWait(guildId, { antiSpam: enabled })
        else if (rule === "links") await updateGuildConfigAndWait(guildId, { antiLink: enabled })
        else if (rule === "invites") await updateGuildConfigAndWait(guildId, { antiInvite: enabled })
        else if (rule === "message_shield") {
            const security = rawSecurity(guildId)
            security.enabled = enabled ? true : security.enabled === true
            security.messageShield = { ...security.messageShield, enabled }
            await saveSecurity(guildId, security)
        }
        await interaction.reply({ content: statusLine("success", `${rule.replace(/_/g, " ")} ${enabled ? "enabled" : "disabled"}.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "punishment") {
        const action = interaction.options.getString("action", true)
        const timeoutMinutes = action === "timeout" ? (interaction.options.getInteger("minutes") || 1) : 0
        await updateGuildConfigAndWait(guildId, { automodPolicy: { action, timeoutMinutes, dmUser: true } })
        await interaction.reply({ content: statusLine("success", action === "timeout" ? `AutoMod response set to delete + ${timeoutMinutes}m timeout.` : "AutoMod response set to delete messages."), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (group === "ignore") {
        const phase2 = rawPhase2(guildId)
        const whitelist = phase2.whitelist
        if (sub === "list") {
            await interaction.reply({ embeds: [automodIgnoreEmbed(guildId)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        if (sub === "reset") {
            phase2.whitelist = { ...whitelist, enabled: false, userIds: [], roleIds: [], channelIds: [], botIds: [] }
            await savePhase2(guildId, phase2)
            await interaction.reply({ content: statusLine("success", "AutoMod exemptions cleared."), ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        const user = interaction.options.getUser("user")
        const role = interaction.options.getRole("role")
        const channel = interaction.options.getChannel("channel")
        const selected = [user && [user.bot ? "botIds" : "userIds", user.id], role && ["roleIds", role.id], channel && ["channelIds", channel.id]].filter(Boolean)
        if (selected.length !== 1) throw new Error("Choose exactly one user, role, or channel")
        const [key, id] = selected[0]
        const values = new Set(whitelist[key] || [])
        if (sub === "add") values.add(id)
        else values.delete(id)
        phase2.whitelist = { ...whitelist, enabled: true, exemptFromAutomod: true, [key]: [...values] }
        await savePhase2(guildId, phase2)
        await interaction.reply({ content: statusLine("success", `AutoMod exemption ${sub === "add" ? "added" : "removed"}.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "reset") {
        const security = rawSecurity(guildId)
        security.messageShield = { ...security.messageShield, enabled: false }
        await Promise.all([
            updateGuildConfigAndWait(guildId, { antiSpam: false, antiLink: false, antiInvite: false, automodPolicy: undefined }),
            saveSecurity(guildId, security),
        ])
        await interaction.reply({ content: statusLine("success", "AutoMod rules reset. Exemption lists were preserved."), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }
    return false
}

async function handleAntinukeInteraction(interaction) {
    if (!canManage(interaction)) throw new Error("Manage Server is required")
    const group = interaction.options.getSubcommandGroup(false)
    const sub = interaction.options.getSubcommand()
    const guildId = interaction.guildId

    if (!group && sub === "status") {
        await interaction.reply({ embeds: [antinukeStatusEmbed(guildId)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && ["enable", "disable"].includes(sub)) {
        if (sub === "disable") requireOwnerIdentity(interaction.guild, interaction.user.id)
        const security = rawSecurity(guildId)
        security.enabled = sub === "enable" ? true : security.enabled
        security.antiNuke = { ...security.antiNuke, enabled: sub === "enable" }
        await saveSecurity(guildId, security)
        await interaction.reply({ content: statusLine(sub === "enable" ? "security" : "success", `Anti-Nuke ${sub === "enable" ? "enabled" : "disabled"}.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "action") {
        const security = rawSecurity(guildId)
        const action = interaction.options.getString("action", true)
        security.enabled = true
        security.antiNuke = { ...security.antiNuke, enabled: true, action }
        await saveSecurity(guildId, security)
        await interaction.reply({ content: statusLine("success", `Anti-Nuke response set to **${action}**.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "limit") {
        const security = rawSecurity(guildId)
        const event = interaction.options.getString("event", true)
        const limit = interaction.options.getInteger("limit", true)
        if (!ANTINUKE_EVENTS.includes(event)) throw new Error("Unsupported anti-nuke event")
        security.enabled = true
        security.antiNuke = {
            ...security.antiNuke,
            enabled: true,
            thresholds: { ...security.antiNuke.thresholds, [event]: limit },
        }
        await saveSecurity(guildId, security)
        await interaction.reply({ content: statusLine("success", `${event.replace(/([A-Z])/g, " $1")} threshold set to ${limit}.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (group === "trust") {
        const security = rawSecurity(guildId)
        if (sub === "list") {
            await interaction.reply({ embeds: [antinukeTrustEmbed(guildId)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        const subject = getSelectedSubject(interaction)
        if (sub === "remove") {
            security.trusted.entries = security.trusted.entries.filter(entry => !(entry.subjectType === subject.subjectType && entry.subjectId === subject.subjectId))
            await saveSecurity(guildId, security)
            await interaction.reply({ content: statusLine("success", "Anti-Nuke trust entry removed."), ephemeral: true, allowedMentions: SAFE_MENTIONS })
            return true
        }
        const scope = interaction.options.getString("scope", true)
        if (!TRUSTED_SCOPES.includes(scope)) throw new Error("Unsupported trust scope")
        const existing = security.trusted.entries.find(entry => entry.subjectType === subject.subjectType && entry.subjectId === subject.subjectId)
        if (existing) existing.scopes = [...new Set([...(existing.scopes || []), scope])]
        else security.trusted.entries.push({ ...subject, scopes: [scope] })
        security.trusted.enabled = true
        await saveSecurity(guildId, security)
        await interaction.reply({ content: statusLine("success", `Trusted for **${scope}**.`), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (!group && sub === "reset") {
        requireOwnerIdentity(interaction.guild, interaction.user.id)
        const security = rawSecurity(guildId)
        security.antiNuke = clone(DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke)
        await saveSecurity(guildId, security)
        await interaction.reply({ content: statusLine("success", "Anti-Nuke configuration reset to safe defaults. Scoped trust was preserved."), ephemeral: true, allowedMentions: SAFE_MENTIONS })
        return true
    }
    return false
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.() || !COMMAND_NAMES.has(interaction.commandName)) return false
    try {
        if (!interaction.inGuild()) throw new Error("Use this command inside a server")
        if (interaction.commandName === "automod") return handleAutomodInteraction(interaction)
        if (interaction.commandName === "antinuke") return handleAntinukeInteraction(interaction)
        return false
    } catch (error) {
        log.warn(`${interaction.commandName} control failed: ${error.message}`)
        const payload = { content: statusLine("error", error.message), ephemeral: true, allowedMentions: SAFE_MENTIONS }
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {})
        else await interaction.reply(payload).catch(() => {})
        return true
    }
}

function prefixBody(content, command) {
    const match = String(content || "").trim().match(new RegExp(`^!${command}(?:\\s+|$)`, "i"))
    if (!match) return null
    return String(content).trim().slice(match[0].length).trim()
}

async function prefixReply(message, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload
    return message.reply({ ...body, allowedMentions: SAFE_MENTIONS }).catch(() => message.channel.send({ ...body, allowedMentions: SAFE_MENTIONS }))
}

function ensurePrefixManager(message) {
    if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild) && !message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        throw new Error("Manage Server is required")
    }
}

async function handleAutomodPrefix(message, body) {
    ensurePrefixManager(message)
    const prefix = getGuildPrefix(message.guild.id)
    const args = body.split(/\s+/).filter(Boolean)
    const sub = (args.shift() || "status").toLowerCase()
    if (sub === "status") {
        await prefixReply(message, { embeds: [automodStatusEmbed(message.guild.id)] })
        return true
    }
    if (["enable", "disable"].includes(sub)) {
        const rule = String(args[0] || "").toLowerCase()
        if (!AUTOMOD_RULES.includes(rule)) throw new Error(`Usage: ${prefix}automod ${sub} spam|links|invites|message_shield`)
        const enabled = sub === "enable"
        if (rule === "spam") await updateGuildConfigAndWait(message.guild.id, { antiSpam: enabled })
        else if (rule === "links") await updateGuildConfigAndWait(message.guild.id, { antiLink: enabled })
        else if (rule === "invites") await updateGuildConfigAndWait(message.guild.id, { antiInvite: enabled })
        else {
            const security = rawSecurity(message.guild.id)
            security.enabled = enabled ? true : security.enabled
            security.messageShield = { ...security.messageShield, enabled }
            await saveSecurity(message.guild.id, security)
        }
        await prefixReply(message, statusLine("success", `${rule.replace(/_/g, " ")} ${enabled ? "enabled" : "disabled"}.`))
        return true
    }
    if (sub === "punishment") {
        const action = String(args[0] || "").toLowerCase()
        if (!["delete", "timeout"].includes(action)) throw new Error(`Usage: ${prefix}automod punishment delete|timeout [minutes]`)
        const minutes = action === "timeout" ? Math.max(1, Math.min(40320, Number(args[1]) || 1)) : 0
        await updateGuildConfigAndWait(message.guild.id, { automodPolicy: { action, timeoutMinutes: minutes, dmUser: true } })
        await prefixReply(message, statusLine("success", action === "timeout" ? `AutoMod response: delete + ${minutes}m timeout.` : "AutoMod response: delete."))
        return true
    }
    if (sub === "reset") {
        const security = rawSecurity(message.guild.id)
        security.messageShield = { ...security.messageShield, enabled: false }
        await Promise.all([
            updateGuildConfigAndWait(message.guild.id, { antiSpam: false, antiLink: false, antiInvite: false, automodPolicy: undefined }),
            saveSecurity(message.guild.id, security),
        ])
        await prefixReply(message, statusLine("success", "AutoMod rules reset. Exemptions preserved."))
        return true
    }
    throw new Error(`Use ${prefix}automod status|enable|disable|punishment|reset or /automod ignore ...`)
}

async function handleAntinukePrefix(message, body) {
    ensurePrefixManager(message)
    const prefix = getGuildPrefix(message.guild.id)
    const args = body.split(/\s+/).filter(Boolean)
    const sub = (args.shift() || "status").toLowerCase()
    if (sub === "status") {
        await prefixReply(message, { embeds: [antinukeStatusEmbed(message.guild.id)] })
        return true
    }
    if (sub === "enable" || sub === "disable") {
        if (sub === "disable") requireOwnerIdentity(message.guild, message.author.id)
        const security = rawSecurity(message.guild.id)
        security.enabled = sub === "enable" ? true : security.enabled
        security.antiNuke = { ...security.antiNuke, enabled: sub === "enable" }
        await saveSecurity(message.guild.id, security)
        await prefixReply(message, statusLine("success", `Anti-Nuke ${sub === "enable" ? "enabled" : "disabled"}.`))
        return true
    }
    if (sub === "action") {
        const action = String(args[0] || "").toLowerCase()
        if (!["alert", "quarantine", "lockdown", "neutralize"].includes(action)) throw new Error(`Usage: ${prefix}antinuke action alert|quarantine|lockdown|neutralize`)
        const security = rawSecurity(message.guild.id)
        security.enabled = true
        security.antiNuke = { ...security.antiNuke, enabled: true, action }
        await saveSecurity(message.guild.id, security)
        await prefixReply(message, statusLine("success", `Anti-Nuke response set to ${action}.`))
        return true
    }
    if (sub === "limit") {
        const event = args[0]
        const limit = Number(args[1])
        if (!ANTINUKE_EVENTS.includes(event) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error(`Usage: ${prefix}antinuke limit <event> <1-50>`)
        const security = rawSecurity(message.guild.id)
        security.enabled = true
        security.antiNuke = { ...security.antiNuke, enabled: true, thresholds: { ...security.antiNuke.thresholds, [event]: limit } }
        await saveSecurity(message.guild.id, security)
        await prefixReply(message, statusLine("success", `${event} threshold set to ${limit}.`))
        return true
    }
    if (sub === "reset") {
        requireOwnerIdentity(message.guild, message.author.id)
        const security = rawSecurity(message.guild.id)
        security.antiNuke = clone(DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke)
        await saveSecurity(message.guild.id, security)
        await prefixReply(message, statusLine("success", "Anti-Nuke reset to safe defaults. Trust entries preserved."))
        return true
    }
    throw new Error(`Use ${prefix}antinuke status|enable|disable|action|limit|reset or /antinuke trust ...`)
}

async function handle(message) {
    if (!message.guild) return false
    const automod = prefixBody(message.content, "automod")
    const antinuke = prefixBody(message.content, "antinuke")
    if (automod === null && antinuke === null) return false
    try {
        if (automod !== null) return handleAutomodPrefix(message, automod)
        return handleAntinukePrefix(message, antinuke)
    } catch (error) {
        await prefixReply(message, statusLine("error", error.message))
        return true
    }
}

for (const command of [automodCommand, antinukeCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) moderation.commands.push(command)
}

if (!moderation.__protectionControlPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedProtectionControlInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__protectionControlPatched", { value: true, enumerable: false })
}

module.exports = {
    handle,
    handleInteraction,
    automodCommand,
    antinukeCommand,
    AUTOMOD_RULES,
    ANTINUKE_EVENTS,
    TRUST_SCOPES,
    automodStatusEmbed,
    antinukeStatusEmbed,
}
