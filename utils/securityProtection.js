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

const joinWindows = new Map()
const activeRaids = new Map()
const actionWindows = new Map()
const triggerCooldowns = new Map()
const processedAuditIds = new Set()
let attached = false

const EVENT_DEFINITIONS = Object.freeze({
    bans: { thresholdKey: "bans", scope: "massModeration", severity: "critical", label: "Mass bans" },
    kicks: { thresholdKey: "kicks", scope: "massModeration", severity: "critical", label: "Mass kicks" },
    channelDeletes: { thresholdKey: "channelDeletes", scope: "manageChannels", severity: "critical", label: "Mass channel deletion" },
    roleDeletes: { thresholdKey: "roleDeletes", scope: "manageRoles", severity: "critical", label: "Mass role deletion" },
    webhookChanges: { thresholdKey: "webhookChanges", scope: "manageWebhooks", severity: "high", label: "Webhook abuse" },
    dangerousRoleChanges: { thresholdKey: "dangerousRoleChanges", scope: "manageRoles", severity: "critical", label: "Dangerous role permission changes" },
    botAdds: { thresholdKey: "botAdds", scope: "addBots", severity: "high", label: "Rapid bot additions" },
})

function now() {
    return Date.now()
}

function rememberAuditId(id) {
    if (!id || processedAuditIds.has(id)) return false
    processedAuditIds.add(id)
    if (processedAuditIds.size > 2000) {
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
    if (now() - last < windowMs) return false
    triggerCooldowns.set(key, now())
    return true
}

function userTag(user) {
    return user?.tag || user?.username || "Unknown user"
}

async function sendSecurityAlert(guild, incident, config) {
    const channelId = config.securityLogChannelId
    const channel = channelId ? guild.channels.cache.get(channelId) : null
    if (!channel?.isTextBased()) return false
    const executor = incident.executorId ? `<@${incident.executorId}>` : "Unknown"
    const target = incident.targetId ? `<@${incident.targetId}>` : "Multiple targets"
    const embed = new EmbedBuilder()
        .setColor(incident.severity === "critical" ? 0xE53935 : incident.severity === "high" ? 0xFF7A00 : 0xF5B041)
        .setTitle(`🛡️ ${String(incident.type || "Security incident").replace(/_/g, " ")}`)
        .addFields(
            { name: "Executor", value: executor, inline: true },
            { name: "Target", value: target, inline: true },
            { name: "Response", value: String(incident.actionTaken || "alert"), inline: true },
        )
        .setDescription(String(incident.details?.summary || "CURSED detected suspicious server activity.").slice(0, 4000))
        .setTimestamp()
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {})
    return true
}

async function executeSecurityResponse(guild, config, action, { member = null, reason, actor = null } = {}) {
    if (action === "quarantine" && member) {
        const result = await quarantineMember(guild, member, config, { reason, moderator: actor })
        return result.ok ? "quarantine" : `alert (quarantine unavailable: ${result.error})`
    }
    if (action === "lockdown" && config.lockdown.enabled) {
        const result = await enableEmergencyLockdown(guild, config, { reason, actor })
        return result.ok ? "lockdown" : `alert (lockdown unavailable: ${result.error})`
    }
    return "alert"
}

async function recordAndAlert(guild, config, input) {
    const incident = await createSecurityIncident({
        guildId: guild.id,
        ...input,
    }) || {
        guildId: guild.id,
        ...input,
    }
    await sendSecurityAlert(guild, incident, config)
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
            const logs = await guild.fetchAuditLogs({ type, limit: 6 })
            for (const entry of logs.entries.values()) candidates.push(entry)
        } catch { /* missing View Audit Log or unsupported audit event */ }
    }
    return candidates
        .filter(entry => now() - entry.createdTimestamp < 15000)
        .filter(entry => !targetId || String(entry.targetId || entry.target?.id || "") === String(targetId))
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] || null
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
    const executorMember = guild.members.cache.get(executorId)
        || await guild.members.fetch(executorId).catch(() => null)
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
    if (count < threshold || !shouldTrigger(guild.id, executorId, eventType, windowMs)) return false

    const summary = `${definition.label}: ${count} action(s) by ${userTag(entry.executor)} within ${antiNuke.windowSeconds} seconds (threshold ${threshold}).`
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
        details: { summary, count, threshold, windowSeconds: antiNuke.windowSeconds, ...extra },
    })
    return true
}

function dangerousPermissionsAdded(oldRole, newRole) {
    const dangerous = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ManageWebhooks,
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
        if (member.user?.bot) {
            await processAuditEvent(member.guild, "botAdds", AuditLogEvent.BotAdd, member.user)
        }
    }))
    client.on(Events.GuildBanAdd, safeListener("ban-add", ban => (
        processAuditEvent(ban.guild, "bans", AuditLogEvent.MemberBanAdd, ban.user)
    )))
    client.on(Events.GuildMemberRemove, safeListener("member-remove", member => (
        processAuditEvent(member.guild, "kicks", AuditLogEvent.MemberKick, member.user)
    )))
    client.on(Events.ChannelDelete, safeListener("channel-delete", channel => (
        processAuditEvent(channel.guild, "channelDeletes", AuditLogEvent.ChannelDelete, channel)
    )))
    client.on(Events.GuildRoleDelete, safeListener("role-delete", role => (
        processAuditEvent(role.guild, "roleDeletes", AuditLogEvent.RoleDelete, role)
    )))
    client.on(Events.GuildRoleUpdate, safeListener("role-update", async (oldRole, newRole) => {
        if (!dangerousPermissionsAdded(oldRole, newRole)) return
        await processAuditEvent(newRole.guild, "dangerousRoleChanges", AuditLogEvent.RoleUpdate, newRole, {
            oldPermissions: oldRole.permissions.bitfield.toString(),
            newPermissions: newRole.permissions.bitfield.toString(),
        })
    }))
    client.on(Events.WebhooksUpdate, safeListener("webhook-update", channel => (
        processAuditEvent(
            channel.guild,
            "webhookChanges",
            [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookDelete, AuditLogEvent.WebhookUpdate],
            null,
            { channelId: channel.id }
        )
    )))
}

module.exports = {
    attachSecurityProtection,
    processJoin,
    processAuditEvent,
    dangerousPermissionsAdded,
}
