const {
    AuditLogEvent,
    EmbedBuilder,
    Events,
    PermissionFlagsBits,
} = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { createSecurityIncident } = require("./securityIncidents")
const { quarantineMember } = require("./quarantineState")
const { enableEmergencyLockdown } = require("./lockdownState")
const {
    neutralizeExecutor,
    restoreDeletedChannel,
    restoreDeletedRole,
    notifyOwner,
} = require("./securityResponse")

const joinWindows = new Map()
const activeRaids = new Map()
const actionWindows = new Map()
const triggerCooldowns = new Map()
const processedAuditIds = new Set()
let attached = false

const EVENT_DEFINITIONS = Object.freeze({
    bans: { thresholdKey: "bans", scope: "massModeration", severity: "critical", label: "Mass bans" },
    kicks: { thresholdKey: "kicks", scope: "massModeration", severity: "critical", label: "Mass kicks" },
    channelDeletes: { thresholdKey: "channelDeletes", scope: "manageChannels", severity: "critical", label: "Channel deletion" },
    channelCreates: { thresholdKey: "channelCreates", scope: "manageChannels", severity: "high", label: "Mass channel creation" },
    channelUpdates: { thresholdKey: "channelUpdates", scope: "manageChannels", severity: "high", label: "Mass channel edits" },
    roleDeletes: { thresholdKey: "roleDeletes", scope: "manageRoles", severity: "critical", label: "Role deletion" },
    roleCreates: { thresholdKey: "roleCreates", scope: "manageRoles", severity: "high", label: "Mass role creation" },
    roleUpdates: { thresholdKey: "roleUpdates", scope: "manageRoles", severity: "high", label: "Mass role edits" },
    webhookChanges: { thresholdKey: "webhookChanges", scope: "manageWebhooks", severity: "critical", label: "Webhook abuse" },
    dangerousRoleChanges: { thresholdKey: "dangerousRoleChanges", scope: "manageRoles", severity: "critical", label: "Dangerous role permission changes" },
    botAdds: { thresholdKey: "botAdds", scope: "addBots", severity: "critical", label: "Unauthorized bot addition" },
    guildUpdates: { thresholdKey: "guildUpdates", scope: "manageRoles", severity: "high", label: "Mass server setting changes" },
})

function now() {
    return Date.now()
}

function rememberAuditId(id) {
    if (!id || processedAuditIds.has(id)) return false
    processedAuditIds.add(id)
    if (processedAuditIds.size > 4000) {
        const first = processedAuditIds.values().next().value
        processedAuditIds.delete(first)
    }
    return true
}

function pruneTimes(times, windowMs) {
    const cutoff = now() - windowMs
    return times.filter(timestamp => timestamp >= cutoff)
}

function counterKey(guildId, executorId, eventType) {
    return `${guildId}:${executorId}:${eventType}`
}

function addActionCount(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, eventType)
    const times = pruneTimes(actionWindows.get(key) || [], windowMs)
    times.push(now())
    actionWindows.set(key, times)
    return times.length
}

function shouldTrigger(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, `trigger:${eventType}`)
    const last = triggerCooldowns.get(key) || 0
    if (now() - last < Math.max(2500, windowMs / 2)) return false
    triggerCooldowns.set(key, now())
    return true
}

function userTag(user) {
    return user?.tag || user?.username || user?.name || "Unknown user"
}

async function sendSecurityAlert(guild, incident, config) {
    const channelId = config.securityLogChannelId
    const channel = channelId ? guild.channels.cache.get(channelId) : null
    if (!channel?.isTextBased()) return false
    const executor = incident.executorId ? `<@${incident.executorId}>` : "Unknown"
    const target = incident.targetId ? `\`${incident.targetId}\`` : "Multiple targets"
    const embed = new EmbedBuilder()
        .setColor(incident.severity === "critical" ? 0xE53935 : incident.severity === "high" ? 0xFF7A00 : 0xF5B041)
        .setTitle(`🛡️ ${String(incident.type || "Security incident").replace(/_/g, " ")}`)
        .addFields(
            { name: "Executor", value: executor, inline: true },
            { name: "Target", value: target, inline: true },
            { name: "Response", value: String(incident.actionTaken || "alert").slice(0, 1024), inline: true },
        )
        .setDescription(String(incident.details?.summary || "CURSED detected suspicious server activity.").slice(0, 4000))
        .setTimestamp()
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {})
    return true
}

async function executeSecurityResponse(guild, config, action, { member = null, reason, actor = null } = {}) {
    if (action === "neutralize" && member) {
        const result = await neutralizeExecutor(guild, member, config, { reason, actor })
        return result.ok ? "neutralized" : `alert (neutralization unavailable: ${result.errors?.join("; ") || result.error || "unknown"})`
    }
    if (action === "quarantine" && member) {
        const result = await quarantineMember(guild, member, config, { reason, moderator: actor })
        if (result.ok) return "quarantine"
        const fallback = await neutralizeExecutor(guild, member, { ...config, antiNuke: { ...config.antiNuke, autoLockdown: false } }, { reason, actor })
        return fallback.ok ? "neutralized (quarantine fallback)" : `alert (quarantine unavailable: ${result.error})`
    }
    if (action === "lockdown" && config.lockdown.enabled) {
        const result = await enableEmergencyLockdown(guild, config, { reason, actor })
        return result.ok ? "lockdown" : `alert (lockdown unavailable: ${result.error})`
    }
    return "alert"
}

async function recordAndAlert(guild, config, input) {
    const incident = await createSecurityIncident({ guildId: guild.id, ...input }) || { guildId: guild.id, ...input }
    await sendSecurityAlert(guild, incident, config)
    if (config.antiNuke.ownerAlerts !== false && input.severity === "critical") {
        await notifyOwner(guild, `🚨 CURSED detected **${String(input.type).replace(/_/g, " ")}** in **${guild.name}**. ${input.details?.summary || "A critical response was triggered."} Response: ${input.actionTaken || "alert"}.`)
    }
    return incident
}

async function processJoin(member) {
    const guild = member?.guild
    if (!guild || member.user?.bot) return false
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.antiRaid.enabled) return false
    if (isTrustedForScope({ guildId: guild.id, member, userId: member.id, isBot: false, scope: "antiRaid" })) return false

    const raid = config.antiRaid
    const windowMs = raid.windowSeconds * 1000
    const times = pruneTimes(joinWindows.get(guild.id) || [], windowMs)
    times.push(now())
    joinWindows.set(guild.id, times)

    const accountAgeHours = Math.floor((now() - member.user.createdTimestamp) / 3600000)
    const suspiciousAccount = accountAgeHours < raid.minAccountAgeHours
    const activeUntil = activeRaids.get(guild.id) || 0
    const thresholdReached = times.length >= raid.joinThreshold
    const raidActive = thresholdReached || activeUntil > now()
    if (!raidActive) return false

    if (thresholdReached) activeRaids.set(guild.id, now() + raid.activeRaidSeconds * 1000)
    if (!suspiciousAccount && !thresholdReached) return false

    const summary = `Detected ${times.length} joins within ${raid.windowSeconds} seconds. ${member.user.tag} account age: ${accountAgeHours} hour(s).`
    const response = await executeSecurityResponse(guild, config, raid.action, {
        member,
        reason: `Anti-raid: ${summary}`,
        actor: { id: guild.members.me?.id, tag: "CURSED Anti-Raid" },
    })
    await recordAndAlert(guild, config, {
        type: "ANTI_RAID",
        severity: thresholdReached ? "critical" : "high",
        executorId: null,
        executorTag: "Automated raid detection",
        targetId: member.id,
        targetTag: userTag(member.user),
        actionTaken: response,
        details: { summary, joins: times.length, windowSeconds: raid.windowSeconds, accountAgeHours },
    })
    return true
}

async function fetchMatchingAuditEntry(guild, auditTypes, targetId = null) {
    const types = Array.isArray(auditTypes) ? auditTypes : [auditTypes]
    const candidates = []
    for (const type of types) {
        try {
            const logs = await guild.fetchAuditLogs({ type, limit: 8 })
            for (const entry of logs.entries.values()) candidates.push(entry)
        } catch { /* missing View Audit Log or unsupported audit event */ }
    }
    return candidates
        .filter(entry => now() - entry.createdTimestamp < 20000)
        .filter(entry => !targetId || String(entry.targetId || entry.target?.id || "") === String(targetId))
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] || null
}

async function recoveryForEvent(guild, config, eventType, target, summary) {
    if (eventType === "channelDeletes" && config.antiNuke.restoreDeletedChannels && target) {
        return restoreDeletedChannel(guild, target, `Anti-nuke recovery: ${summary}`)
    }
    if (eventType === "roleDeletes" && config.antiNuke.restoreDeletedRoles && target) {
        return restoreDeletedRole(guild, target, `Anti-nuke recovery: ${summary}`)
    }
    return null
}

async function processAuditEvent(guild, eventType, auditTypes, target = null, extra = {}) {
    const definition = EVENT_DEFINITIONS[eventType]
    if (!guild || !definition) return false
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.antiNuke.enabled) return false
    const entry = await fetchMatchingAuditEntry(guild, auditTypes, target?.id || null)
    if (!entry || !rememberAuditId(entry.id)) return false

    const executorId = String(entry.executorId || entry.executor?.id || "")
    if (!executorId || executorId === guild.ownerId || executorId === guild.members.me?.id) return false
    const executorMember = guild.members.cache.get(executorId) || await guild.members.fetch(executorId).catch(() => null)
    if (isTrustedForScope({
        guildId: guild.id,
        member: executorMember,
        userId: executorId,
        isBot: entry.executor?.bot,
        scope: definition.scope,
    })) return false

    const antiNuke = config.antiNuke
    const threshold = antiNuke.thresholds[definition.thresholdKey]
    const windowMs = antiNuke.windowSeconds * 1000
    const count = addActionCount(guild.id, executorId, eventType, windowMs)
    const summary = `${definition.label}: ${count} action(s) by ${userTag(entry.executor)} within ${antiNuke.windowSeconds} seconds (threshold ${threshold}).`
    const recovery = await recoveryForEvent(guild, config, eventType, target, summary)

    if (count < threshold || !shouldTrigger(guild.id, executorId, eventType, windowMs)) return Boolean(recovery?.ok)

    const response = await executeSecurityResponse(guild, config, antiNuke.action, {
        member: executorMember,
        reason: `Anti-nuke: ${summary}`,
        actor: { id: guild.members.me?.id, tag: "CURSED Anti-Nuke" },
    })
    await recordAndAlert(guild, config, {
        type: `ANTI_NUKE_${eventType.toUpperCase()}`,
        severity: definition.severity,
        executorId,
        executorTag: userTag(entry.executor),
        targetId: target?.id || String(entry.targetId || entry.target?.id || "") || null,
        targetTag: target?.name || target?.tag || entry.target?.name || userTag(entry.target) || null,
        actionTaken: response,
        auditLogEntryId: entry.id,
        details: { summary, count, threshold, windowSeconds: antiNuke.windowSeconds, recovery, ...extra },
    })
    return true
}

function dangerousPermissionsAdded(oldRole, newRole) {
    const dangerous = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.MentionEveryone,
    ]
    return dangerous.some(permission => !oldRole.permissions.has(permission) && newRole.permissions.has(permission))
}

function safeListener(label, handler) {
    return (...args) => Promise.resolve(handler(...args)).catch(err => {
        console.error(`[SecurityPhase3:${label}]`, err.message)
    })
}

function attachSecurityProtection(client) {
    if (attached || !client) return
    attached = true

    client.on(Events.GuildMemberAdd, safeListener("member-add", async member => {
        await processJoin(member)
        if (member.user?.bot) await processAuditEvent(member.guild, "botAdds", AuditLogEvent.BotAdd, member.user)
    }))
    client.on(Events.GuildBanAdd, safeListener("ban-add", ban => processAuditEvent(ban.guild, "bans", AuditLogEvent.MemberBanAdd, ban.user)))
    client.on(Events.GuildMemberRemove, safeListener("member-remove", member => processAuditEvent(member.guild, "kicks", AuditLogEvent.MemberKick, member.user)))
    client.on(Events.ChannelDelete, safeListener("channel-delete", channel => processAuditEvent(channel.guild, "channelDeletes", AuditLogEvent.ChannelDelete, channel)))
    client.on(Events.ChannelCreate, safeListener("channel-create", channel => processAuditEvent(channel.guild, "channelCreates", AuditLogEvent.ChannelCreate, channel)))
    client.on(Events.ChannelUpdate, safeListener("channel-update", (oldChannel, newChannel) => processAuditEvent(newChannel.guild, "channelUpdates", AuditLogEvent.ChannelUpdate, newChannel, { oldName: oldChannel.name, newName: newChannel.name })))
    client.on(Events.GuildRoleDelete, safeListener("role-delete", role => processAuditEvent(role.guild, "roleDeletes", AuditLogEvent.RoleDelete, role)))
    client.on(Events.GuildRoleCreate, safeListener("role-create", role => processAuditEvent(role.guild, "roleCreates", AuditLogEvent.RoleCreate, role)))
    client.on(Events.GuildRoleUpdate, safeListener("role-update", async (oldRole, newRole) => {
        await processAuditEvent(newRole.guild, "roleUpdates", AuditLogEvent.RoleUpdate, newRole, {
            oldPermissions: oldRole.permissions.bitfield.toString(),
            newPermissions: newRole.permissions.bitfield.toString(),
        })
        if (dangerousPermissionsAdded(oldRole, newRole)) {
            await processAuditEvent(newRole.guild, "dangerousRoleChanges", AuditLogEvent.RoleUpdate, newRole, {
                oldPermissions: oldRole.permissions.bitfield.toString(),
                newPermissions: newRole.permissions.bitfield.toString(),
            })
        }
    }))
    client.on(Events.WebhooksUpdate, safeListener("webhook-update", channel => processAuditEvent(
        channel.guild,
        "webhookChanges",
        [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookDelete, AuditLogEvent.WebhookUpdate],
        null,
        { channelId: channel.id }
    )))
    client.on(Events.GuildUpdate, safeListener("guild-update", (oldGuild, newGuild) => processAuditEvent(newGuild, "guildUpdates", AuditLogEvent.GuildUpdate, newGuild, {
        oldName: oldGuild.name,
        newName: newGuild.name,
    })))
}

module.exports = {
    attachSecurityProtection,
    processJoin,
    processAuditEvent,
    dangerousPermissionsAdded,
}
