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
const { consumeBotApproval, setIncidentMode } = require("./securityRecoverySuite")
const { resolveAuditEntry } = require("./auditLogResolver")
const { evaluateJoinRisk } = require("./antiRaidRisk")
const { recordTiming } = require("./runtimeMetrics")

const joinWindows = new Map()
const activeRaids = new Map()
const actionWindows = new Map()
const triggerCooldowns = new Map()
const processedAuditIds = new Set()
const processingAddedBots = new Set()
let attached = false

const MAX_RUNTIME_KEYS = 5000
const RUNTIME_STATE_TTL_MS = 30 * 60 * 1000
const runtimeTouchedAt = new Map()

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
    guildUpdates: { thresholdKey: "guildUpdates", scope: "manageGuild", severity: "high", label: "Mass server setting changes" },
})

function now() {
    return Date.now()
}

function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

function touchRuntimeKey(key) {
    runtimeTouchedAt.set(key, now())
}

function cleanupRuntimeState() {
    const cutoff = now() - RUNTIME_STATE_TTL_MS
    for (const [key, touchedAt] of runtimeTouchedAt.entries()) {
        if (touchedAt >= cutoff) continue
        runtimeTouchedAt.delete(key)
        actionWindows.delete(key)
        triggerCooldowns.delete(key)
    }
    for (const [guildId, timestamps] of joinWindows.entries()) {
        if (!timestamps.length || Math.max(...timestamps) < cutoff) joinWindows.delete(guildId)
    }
    for (const [guildId, expiresAt] of activeRaids.entries()) {
        if (expiresAt <= now()) activeRaids.delete(guildId)
    }
    while (runtimeTouchedAt.size > MAX_RUNTIME_KEYS) {
        const oldest = runtimeTouchedAt.keys().next().value
        runtimeTouchedAt.delete(oldest)
        actionWindows.delete(oldest)
        triggerCooldowns.delete(oldest)
    }
}

const cleanupTimer = setInterval(cleanupRuntimeState, 60_000)
cleanupTimer.unref?.()

function rememberAuditId(id) {
    if (!id || processedAuditIds.has(id)) return false
    processedAuditIds.add(id)
    if (processedAuditIds.size > 4000) processedAuditIds.delete(processedAuditIds.values().next().value)
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
    touchRuntimeKey(key)
    return times.length
}

function shouldTrigger(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, `trigger:${eventType}`)
    const last = triggerCooldowns.get(key) || 0
    if (now() - last < Math.max(2500, windowMs / 2)) return false
    triggerCooldowns.set(key, now())
    touchRuntimeKey(key)
    return true
}

function userTag(user) {
    return user?.tag || user?.username || user?.name || "Unknown user"
}

async function sendSecurityAlert(guild, incident, config) {
    const channel = config.securityLogChannelId ? guild.channels.cache.get(config.securityLogChannelId) : null
    if (!channel?.isTextBased()) return false
    const executor = incident.executorId ? `<@${incident.executorId}>` : "Unknown"
    const target = incident.targetId ? `\`${incident.targetId}\`` : "Multiple targets"
    const embed = new EmbedBuilder()
        .setColor(incident.severity === "critical" ? 0xE53935 : incident.severity === "high" ? 0xFF7A00 : 0xF5B041)
        .setTitle(`Security • ${String(incident.type || "Incident").replace(/_/g, " ")}`)
        .addFields(
            { name: "Executor", value: executor, inline: true },
            { name: "Target", value: target, inline: true },
            { name: "Response", value: String(incident.actionTaken || "alert").slice(0, 1024), inline: true },
        )
        .setDescription(String(incident.details?.summary || "Suspicious server activity was detected.").slice(0, 4000))
        .setFooter({ text: "CURSED • Server Protection" })
        .setTimestamp()
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {})
    return true
}

async function executeSecurityResponse(guild, config, action, { member = null, reason, actor = null } = {}) {
    const startedAt = now()
    try {
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
    } finally {
        recordTiming("security.response", now() - startedAt)
    }
}

async function recordAndAlert(guild, config, input) {
    const incident = await createSecurityIncident({ guildId: guild.id, ...input }).catch(() => null)
        || { guildId: guild.id, ...input }
    const tasks = [sendSecurityAlert(guild, incident, config)]
    if (config.antiNuke.ownerAlerts !== false && input.severity === "critical") {
        tasks.push(notifyOwner(
            guild,
            `CURSED blocked ${String(input.type || "a security incident").replace(/_/g, " ").toLowerCase()} in **${guild.name}**. Response: ${input.actionTaken || "alert"}.`
        ))
    }
    await Promise.allSettled(tasks)
    return incident
}

async function maybeActivateIncidentMode(guild, config, reason, severity) {
    if (severity !== "critical" || !config.incidentMode?.enabled) return null
    return setIncidentMode(guild, true, config, {
        reason,
        actor: { id: guild.members.me?.id, tag: "CURSED Automatic Incident Mode" },
        durationMinutes: config.incidentMode.durationMinutes,
    }).catch(() => null)
}

async function processJoin(member) {
    const startedAt = now()
    try {
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

        const activeUntil = activeRaids.get(guild.id) || 0
        const thresholdReached = times.length >= raid.joinThreshold
        const raidAlreadyActive = activeUntil > now()
        if (thresholdReached) activeRaids.set(guild.id, now() + raid.activeRaidSeconds * 1000)

        const risk = evaluateJoinRisk(member, raid, {
            joinCount: times.length,
            thresholdReached,
            raidAlreadyActive,
            nowMs: now(),
        })
        if (!risk.shouldAction) return false

        const reasonText = risk.reasons.length ? risk.reasons.join(", ") : "join velocity"
        const summary = `Anti-raid matched ${times.length} joins in ${raid.windowSeconds}s. Risk ${risk.score}/${risk.threshold}: ${reasonText}.`
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
            details: {
                summary,
                joins: times.length,
                windowSeconds: raid.windowSeconds,
                accountAgeHours: risk.accountAgeHours,
                riskScore: risk.score,
                riskThreshold: risk.threshold,
                riskReasons: risk.reasons,
            },
        })
        if (thresholdReached) await maybeActivateIncidentMode(guild, config, summary, "critical")
        return true
    } finally {
        recordTiming("security.anti-raid.total", now() - startedAt)
    }
}

async function fetchMatchingAuditEntry(guild, auditTypes, targetId = null) {
    return resolveAuditEntry(guild, auditTypes, { targetId, maxAgeMs: 15_000, limit: 8 })
}

async function removeUnauthorizedAddedBot(member, reason) {
    if (!member?.user?.bot) return { ok: false, action: "none", error: "Added member is not a bot." }
    const guild = member.guild
    const errors = []

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const current = guild.members.cache.get(member.id) || await guild.members.fetch(member.id).catch(() => null)
        if (!current) return { ok: true, action: "already removed", attempts: attempt - 1, errors }

        if (current.bannable && guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
            try {
                await guild.members.ban(current.id, { reason: String(reason).slice(0, 512), deleteMessageSeconds: 86400 })
                return { ok: true, action: "bot banned", attempts: attempt, errors }
            } catch (error) {
                errors.push(`ban attempt ${attempt}: ${error.message}`)
            }
        }

        if (current.kickable && guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
            try {
                await current.kick(String(reason).slice(0, 512))
                return { ok: true, action: "bot kicked", attempts: attempt, errors }
            } catch (error) {
                errors.push(`kick attempt ${attempt}: ${error.message}`)
            }
        }

        if (attempt < 3) await sleep(attempt * 250)
    }
    return { ok: false, action: "bot removal failed", attempts: 3, errors }
}

async function processUnauthorizedBotAdd(member) {
    const startedAt = now()
    const guild = member?.guild
    if (!guild || !member.user?.bot || member.id === guild.members.me?.id) return false
    const processingKey = `${guild.id}:${member.id}`
    if (processingAddedBots.has(processingKey)) return false
    processingAddedBots.add(processingKey)

    try {
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.antiNuke.enabled) return false
        const entry = await fetchMatchingAuditEntry(guild, AuditLogEvent.BotAdd, member.id)
        if (!entry || !rememberAuditId(entry.id)) return false

        const inviterId = String(entry.executorId || entry.executor?.id || "")
        if (!inviterId || inviterId === guild.members.me?.id) return false
        const inviterMember = guild.members.cache.get(inviterId) || await guild.members.fetch(inviterId).catch(() => null)

        if (config.botApprovals?.enabled) {
            const approval = await consumeBotApproval(guild.id, member.id, inviterId)
            if (approval) {
                await createSecurityIncident({
                    guildId: guild.id,
                    type: "TRUSTED_BOT_APPROVAL_USED",
                    severity: "low",
                    executorId: inviterId,
                    executorTag: userTag(entry.executor),
                    targetId: member.id,
                    targetTag: userTag(member.user),
                    actionTaken: "approved",
                    details: { summary: `${userTag(member.user)} used a valid bot approval.`, approvalId: approval.id },
                }).catch(() => {})
                return true
            }
        }

        if (isTrustedForScope({ guildId: guild.id, member: inviterMember, userId: inviterId, isBot: entry.executor?.bot, scope: "addBots" })) return false

        const antiNuke = config.antiNuke
        const windowMs = antiNuke.windowSeconds * 1000
        const count = addActionCount(guild.id, inviterId, "botAdds", windowMs)
        const summary = `Unauthorized bot addition: ${userTag(entry.executor)} added ${userTag(member.user)} (${member.id}).`

        // Remove the unapproved bot first. Logging is intentionally after the defensive action.
        const botRemoval = await removeUnauthorizedAddedBot(member, `CURSED anti-nuke: ${summary}`)
        await recordAndAlert(guild, config, {
            type: "ANTI_NUKE_ADDED_BOT_REMOVAL",
            severity: "critical",
            executorId: inviterId,
            executorTag: userTag(entry.executor),
            targetId: member.id,
            targetTag: userTag(member.user),
            actionTaken: botRemoval.action,
            auditLogEntryId: entry.id,
            details: { summary, botRemoval },
        })

        const threshold = antiNuke.thresholds.botAdds
        if (count < threshold || !shouldTrigger(guild.id, inviterId, "botAdds", windowMs)) return botRemoval.ok

        const inviterResponse = inviterMember
            ? await executeSecurityResponse(guild, config, antiNuke.action, {
                member: inviterMember,
                reason: `Anti-nuke inviter response: ${summary}`,
                actor: { id: guild.members.me?.id, tag: "CURSED Anti-Nuke" },
            })
            : "alert (inviter no longer in server)"

        await Promise.allSettled([
            recordAndAlert(guild, config, {
                type: "ANTI_NUKE_BOTADDS",
                severity: "critical",
                executorId: inviterId,
                executorTag: userTag(entry.executor),
                targetId: member.id,
                targetTag: userTag(member.user),
                actionTaken: inviterResponse,
                details: { summary, count, threshold, windowSeconds: antiNuke.windowSeconds, botRemoval },
            }),
            maybeActivateIncidentMode(guild, config, summary, "critical"),
        ])
        return botRemoval.ok
    } finally {
        recordTiming("security.bot-add.total", now() - startedAt)
        const timer = setTimeout(() => processingAddedBots.delete(processingKey), 30_000)
        timer.unref?.()
    }
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

function staffLimitDefinition(eventType, config) {
    const staff = config.staffLimits
    if (!staff?.enabled) return null
    if (eventType === "bans") return { key: "bans", threshold: staff.thresholds.bans }
    if (eventType === "kicks") return { key: "kicks", threshold: staff.thresholds.kicks }
    if (["channelDeletes", "channelCreates", "channelUpdates"].includes(eventType)) return { key: "channelChanges", threshold: staff.thresholds.channelChanges }
    if (["roleDeletes", "roleCreates", "roleUpdates", "dangerousRoleChanges"].includes(eventType)) return { key: "roleChanges", threshold: staff.thresholds.roleChanges }
    if (eventType === "webhookChanges") return { key: "webhookChanges", threshold: staff.thresholds.webhookChanges }
    return null
}

async function processAuditEvent(guild, eventType, auditTypes, target = null, extra = {}) {
    const startedAt = now()
    try {
        const definition = EVENT_DEFINITIONS[eventType]
        if (!guild || !definition || eventType === "botAdds") return false
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.antiNuke.enabled) return false

        const entry = await fetchMatchingAuditEntry(guild, auditTypes, target?.id || null)
        if (!entry || !rememberAuditId(entry.id)) return false
        const executorId = String(entry.executorId || entry.executor?.id || "")
        if (!executorId || executorId === guild.ownerId || executorId === guild.members.me?.id) return false

        const executorMember = guild.members.cache.get(executorId) || await guild.members.fetch(executorId).catch(() => null)
        if (isTrustedForScope({ guildId: guild.id, member: executorMember, userId: executorId, isBot: entry.executor?.bot, scope: definition.scope })) return false

        const antiNuke = config.antiNuke
        const threshold = antiNuke.thresholds[definition.thresholdKey]
        const windowMs = antiNuke.windowSeconds * 1000
        const count = addActionCount(guild.id, executorId, eventType, windowMs)

        let staff = null
        if (!entry.executor?.bot && !isTrustedForScope({ guildId: guild.id, member: executorMember, userId: executorId, isBot: false, scope: "staffLimits" })) {
            const staffDefinition = staffLimitDefinition(eventType, config)
            if (staffDefinition) {
                const staffWindowMs = config.staffLimits.windowSeconds * 1000
                const staffCount = addActionCount(guild.id, executorId, `staff:${staffDefinition.key}`, staffWindowMs)
                staff = { ...staffDefinition, count: staffCount, windowSeconds: config.staffLimits.windowSeconds }
            }
        }

        const staffTriggered = Boolean(staff && staff.count >= staff.threshold)
        const antiNukeTriggered = count >= threshold
        const summary = `${definition.label}: ${count} action(s) by ${userTag(entry.executor)} in ${antiNuke.windowSeconds}s (limit ${threshold}).${staff ? ` Staff limit ${staff.count}/${staff.threshold}.` : ""}`
        const triggerWindowMs = staffTriggered ? config.staffLimits.windowSeconds * 1000 : windowMs
        const triggered = (antiNukeTriggered || staffTriggered)
            && shouldTrigger(guild.id, executorId, staffTriggered ? `staff:${eventType}` : eventType, triggerWindowMs)

        // On a triggered destructive event, stop the executor before spending time on recovery/logging.
        let response = null
        if (triggered) {
            const responseAction = staffTriggered ? config.staffLimits.action : antiNuke.action
            response = await executeSecurityResponse(guild, config, responseAction, {
                member: executorMember,
                reason: `${staffTriggered ? "Staff safety limit" : "Anti-nuke"}: ${summary}`,
                actor: { id: guild.members.me?.id, tag: staffTriggered ? "CURSED Staff Safety" : "CURSED Anti-Nuke" },
            })
        }

        const recovery = await recoveryForEvent(guild, config, eventType, target, summary)
        if (!triggered) return Boolean(recovery?.ok)

        const incidentType = staffTriggered ? `STAFF_LIMIT_${eventType.toUpperCase()}` : `ANTI_NUKE_${eventType.toUpperCase()}`
        const severity = staffTriggered ? "critical" : definition.severity
        await Promise.allSettled([
            recordAndAlert(guild, config, {
                type: incidentType,
                severity,
                executorId,
                executorTag: userTag(entry.executor),
                targetId: target?.id || String(entry.targetId || entry.target?.id || "") || null,
                targetTag: target?.name || target?.tag || entry.target?.name || userTag(entry.target) || null,
                actionTaken: response || "alert",
                auditLogEntryId: entry.id,
                details: { summary, count, threshold, windowSeconds: antiNuke.windowSeconds, staff, recovery, ...extra },
            }),
            maybeActivateIncidentMode(guild, config, summary, severity),
        ])
        return true
    } finally {
        recordTiming(`security.event.${eventType}`, now() - startedAt)
    }
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
    return (...args) => Promise.resolve(handler(...args)).catch(error => {
        console.error(`[Security:${label}]`, error.message)
    })
}

function attachSecurityProtection(client) {
    if (attached || !client) return
    attached = true

    client.on(Events.GuildMemberAdd, safeListener("member-add", async member => {
        await processJoin(member)
        if (member.user?.bot) await processUnauthorizedBotAdd(member)
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
    processUnauthorizedBotAdd,
    removeUnauthorizedAddedBot,
    dangerousPermissionsAdded,
    staffLimitDefinition,
    fetchMatchingAuditEntry,
    cleanupRuntimeState,
}
