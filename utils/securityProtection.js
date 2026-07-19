const {
    AuditLogEvent,
    EmbedBuilder,
    Events,
    PermissionFlagsBits,
} = require("discord.js")
const logger = require("./logger")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { getFortressConfig } = require("./fortressConfig")
const { createSecurityIncident } = require("./securityIncidents")
const { quarantineMember } = require("./quarantineState")
const { enableEmergencyLockdown, disableEmergencyLockdown } = require("./lockdownState")
const { listGuildSnapshots, restoreGuildSnapshot } = require("./securitySnapshots")
const {
    consumeInternalAction,
    hasDangerousPermissions,
    neutralizeExecutor,
    recreateDeletedChannel,
    recreateDeletedRole,
    revertChannelUpdate,
    revertRoleUpdate,
    removeCreatedChannel,
    removeCreatedRole,
    unbanVictim,
    removeUnauthorizedBot,
    removeUnauthorizedWebhook,
    removeDangerousRoleGrant,
} = require("./securityRecovery")

const log = logger.child("Fortress")
const joinWindows = new Map()
const activeRaids = new Map()
const actionWindows = new Map()
const executorHeat = new Map()
const triggerCooldowns = new Map()
const processedAuditIds = new Map()
const panicReleaseTimers = new Map()
let attached = false
let prunePoller = null

const EVENT_DEFINITIONS = Object.freeze({
    bans: { thresholdKey: "bans", scope: "massModeration", severity: "critical", label: "Member ban", heat: 5, instant: false },
    kicks: { thresholdKey: "kicks", scope: "massModeration", severity: "critical", label: "Member kick", heat: 4, instant: false },
    prunes: { thresholdKey: "kicks", scope: "massModeration", severity: "critical", label: "Member prune", heat: 12, instant: true },
    channelDeletes: { thresholdKey: "channelDeletes", scope: "manageChannels", severity: "critical", label: "Channel deletion", heat: 8, instant: true },
    channelCreates: { thresholdKey: "channelDeletes", scope: "manageChannels", severity: "high", label: "Channel creation", heat: 4, instant: false },
    channelUpdates: { thresholdKey: "dangerousRoleChanges", scope: "manageChannels", severity: "high", label: "Channel modification", heat: 5, instant: false },
    roleDeletes: { thresholdKey: "roleDeletes", scope: "manageRoles", severity: "critical", label: "Role deletion", heat: 8, instant: true },
    roleCreates: { thresholdKey: "roleDeletes", scope: "manageRoles", severity: "high", label: "Role creation", heat: 4, instant: false },
    roleUpdates: { thresholdKey: "dangerousRoleChanges", scope: "manageRoles", severity: "critical", label: "Dangerous role modification", heat: 8, instant: true },
    memberRoleUpdates: { thresholdKey: "dangerousRoleChanges", scope: "manageRoles", severity: "critical", label: "Dangerous member role grant", heat: 9, instant: true },
    webhookChanges: { thresholdKey: "webhookChanges", scope: "manageWebhooks", severity: "critical", label: "Webhook change", heat: 7, instant: true },
    botAdds: { thresholdKey: "botAdds", scope: "addBots", severity: "critical", label: "Bot addition", heat: 9, instant: true },
    guildUpdates: { thresholdKey: "dangerousRoleChanges", scope: "manageChannels", severity: "high", label: "Server settings change", heat: 6, instant: false },
    inviteCreates: { thresholdKey: "webhookChanges", scope: "manageChannels", severity: "high", label: "Invite creation", heat: 4, instant: false },
    inviteDeletes: { thresholdKey: "webhookChanges", scope: "manageChannels", severity: "medium", label: "Invite deletion", heat: 3, instant: false },
})

function now() { return Date.now() }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function userTag(user) { return user?.tag || user?.username || user?.displayName || "Unknown user" }

function rememberAuditId(guildId, id) {
    if (!id) return false
    const key = `${guildId}:${id}`
    const expiresAt = processedAuditIds.get(key) || 0
    if (expiresAt > now()) return false
    processedAuditIds.set(key, now() + 10 * 60_000)
    if (processedAuditIds.size > 5000) {
        for (const [entryKey, expiry] of processedAuditIds) {
            if (expiry <= now()) processedAuditIds.delete(entryKey)
            if (processedAuditIds.size <= 4000) break
        }
    }
    return true
}

function pruneTimes(times, windowMs) {
    const cutoff = now() - windowMs
    return times.filter(timestamp => timestamp >= cutoff)
}

function counterKey(guildId, executorId, eventType) { return `${guildId}:${executorId}:${eventType}` }

function addActionCount(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, eventType)
    const times = pruneTimes(actionWindows.get(key) || [], windowMs)
    times.push(now())
    actionWindows.set(key, times)
    return times.length
}

function addExecutorHeat(guildId, executorId, points, fortress) {
    const key = `${guildId}:${executorId}`
    const current = executorHeat.get(key) || { points: 0, updatedAt: now(), events: [] }
    const elapsed = now() - current.updatedAt
    const decayMs = Math.max(10, fortress.heat.decaySeconds) * 1000
    const decay = Math.floor(elapsed / decayMs)
    current.points = Math.max(0, current.points - decay) + Math.max(0, points)
    current.updatedAt = now()
    current.events = current.events.filter(item => now() - item.at <= fortress.heat.windowSeconds * 1000)
    current.events.push({ at: now(), points })
    executorHeat.set(key, current)
    return current
}

function shouldTrigger(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, `trigger:${eventType}`)
    const last = triggerCooldowns.get(key) || 0
    if (now() - last < Math.min(windowMs, 10_000)) return false
    triggerCooldowns.set(key, now())
    return true
}

async function sendSecurityAlert(guild, incident, config, fortress) {
    const channelId = config.securityLogChannelId
    const channel = channelId ? guild.channels.cache.get(channelId) : null
    const executor = incident.executorId ? `<@${incident.executorId}>` : "Unknown"
    const target = incident.targetId ? `\`${incident.targetId}\`` : "Multiple targets"
    const containment = incident.details?.containment?.action || incident.actionTaken || "alert"
    const rollback = incident.details?.rollback?.ok === true
        ? "Succeeded"
        : incident.details?.rollback?.attempted
            ? `Failed: ${incident.details.rollback.error || "unknown error"}`
            : "Not attempted"
    const embed = new EmbedBuilder()
        .setColor(incident.severity === "critical" ? 0xE53935 : incident.severity === "high" ? 0xFF7A00 : 0xF5B041)
        .setTitle(`🛡️ ${String(incident.type || "Security incident").replace(/_/g, " ")}`)
        .addFields(
            { name: "Executor", value: executor, inline: true },
            { name: "Target", value: target, inline: true },
            { name: "Containment", value: String(containment).slice(0, 1024), inline: true },
            { name: "Rollback", value: rollback.slice(0, 1024), inline: false },
        )
        .setDescription(String(incident.details?.summary || "CURSED detected suspicious server activity.").slice(0, 4000))
        .setFooter({ text: "CURSED Fortress • Verify the Audit Log immediately" })
        .setTimestamp()

    if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {})
    }
    if (fortress.notifyOwner && incident.severity === "critical") {
        const owner = await guild.fetchOwner().catch(() => null)
        if (owner) {
            await owner.send({
                content: `🚨 **CURSED Fortress alert in ${guild.name}**`,
                embeds: [embed],
                allowedMentions: { parse: [] },
            }).catch(() => {})
        }
    }
    return Boolean(channel?.isTextBased())
}

async function recordAndAlert(guild, config, fortress, input) {
    const incident = await createSecurityIncident({ guildId: guild.id, ...input }) || { guildId: guild.id, ...input }
    await sendSecurityAlert(guild, incident, config, fortress)
    return incident
}

async function fetchAuditCandidates(guild, types) {
    const candidates = []
    for (const type of types) {
        try {
            const logs = await guild.fetchAuditLogs({ type, limit: 10 })
            for (const entry of logs.entries.values()) candidates.push(entry)
        } catch (err) {
            log.debug(`Audit fetch failed for ${guild.id}/${type}: ${err.message}`)
        }
    }
    return candidates
}

async function fetchMatchingAuditEntry(guild, auditTypes, targetId = null, fortress = null) {
    const types = Array.isArray(auditTypes) ? auditTypes : [auditTypes]
    const retries = fortress?.auditRetryCount || 3
    const retryDelay = fortress?.auditRetryDelayMs || 450
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const candidates = await fetchAuditCandidates(guild, types)
        const match = candidates
            .filter(entry => now() - entry.createdTimestamp < 30_000)
            .filter(entry => !targetId || String(entry.targetId || entry.target?.id || "") === String(targetId))
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] || null
        if (match) return match
        if (attempt < retries - 1) await delay(retryDelay * (attempt + 1))
    }
    return null
}

function dangerousPermissionsAdded(oldRole, newRole) {
    const dangerous = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.ModerateMembers,
    ]
    return dangerous.some(permission => !oldRole.permissions.has(permission) && newRole.permissions.has(permission))
}

function dangerousRoleGrant(oldMember, newMember) {
    return newMember.roles.cache.some(role => !oldMember.roles.cache.has(role.id) && hasDangerousPermissions(role))
}

function significantChannelUpdate(oldChannel, newChannel) {
    if (oldChannel.name !== newChannel.name || oldChannel.parentId !== newChannel.parentId) return true
    const oldEveryone = oldChannel.permissionOverwrites?.cache?.get(oldChannel.guild.id)
    const newEveryone = newChannel.permissionOverwrites?.cache?.get(newChannel.guild.id)
    return String(oldEveryone?.allow?.bitfield || 0n) !== String(newEveryone?.allow?.bitfield || 0n)
        || String(oldEveryone?.deny?.bitfield || 0n) !== String(newEveryone?.deny?.bitfield || 0n)
}

function significantGuildUpdate(oldGuild, newGuild) {
    return oldGuild.verificationLevel !== newGuild.verificationLevel
        || oldGuild.explicitContentFilter !== newGuild.explicitContentFilter
        || oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications
        || oldGuild.name !== newGuild.name
}

async function rollbackGuildUpdate(oldGuild, newGuild, reason) {
    await newGuild.edit({
        name: oldGuild.name,
        verificationLevel: oldGuild.verificationLevel,
        explicitContentFilter: oldGuild.explicitContentFilter,
        defaultMessageNotifications: oldGuild.defaultMessageNotifications,
    }, reason)
    return { ok: true }
}

async function attemptRollback(guild, eventType, target, entry, extra, fortress, reason) {
    if (!fortress.rollback.enabled) return { attempted: false, ok: false, error: "Rollback disabled." }
    try {
        let result = null
        if (eventType === "bans" && fortress.rollback.unbanVictims) result = await unbanVictim(guild, target, reason)
        else if (eventType === "channelDeletes" && fortress.rollback.recreateDeletedChannels) result = await recreateDeletedChannel(target, reason)
        else if (eventType === "channelCreates" && fortress.rollback.removeUnauthorizedChannels) result = await removeCreatedChannel(target, reason)
        else if (eventType === "channelUpdates" && fortress.rollback.revertChannelUpdates) result = await revertChannelUpdate(extra.oldTarget, target, reason)
        else if (eventType === "roleDeletes" && fortress.rollback.recreateDeletedRoles) result = await recreateDeletedRole(target, reason)
        else if (eventType === "roleCreates" && fortress.rollback.removeUnauthorizedRoles) result = await removeCreatedRole(target, reason)
        else if (eventType === "roleUpdates" && fortress.rollback.revertRoleUpdates) result = await revertRoleUpdate(extra.oldTarget, target, reason)
        else if (eventType === "memberRoleUpdates" && fortress.rollback.restoreRoleAssignments) result = await removeDangerousRoleGrant(extra.oldTarget, target, reason)
        else if (eventType === "botAdds" && fortress.rollback.removeUnauthorizedBots) result = await removeUnauthorizedBot(target, reason)
        else if (eventType === "webhookChanges" && fortress.rollback.removeUnauthorizedWebhooks && (entry.action === AuditLogEvent.WebhookCreate || entry.actionType === AuditLogEvent.WebhookCreate)) {
            result = await removeUnauthorizedWebhook(guild, entry.targetId || entry.target?.id, reason)
        } else if (eventType === "guildUpdates" && fortress.rollback.revertChannelUpdates) result = await rollbackGuildUpdate(extra.oldTarget, target, reason)
        else if (eventType === "inviteCreates" && target?.deletable !== false && typeof target?.delete === "function") {
            await target.delete(reason)
            result = { ok: true }
        }
        if (!result) return { attempted: false, ok: false, error: "No safe rollback is available for this event." }
        return { attempted: true, ...result }
    } catch (err) {
        return { attempted: true, ok: false, error: err.message }
    }
}

async function triggerPanic(guild, security, fortress, reason, actor) {
    if (!fortress.panic.enabled || !fortress.panic.lockdownOnTrigger || !security.lockdown.enabled) {
        return { ok: false, error: "Panic lockdown is disabled." }
    }
    const result = await enableEmergencyLockdown(guild, security, { reason, actor })
    if (result.ok && fortress.backups.autoRestoreOnPanic) {
        try {
            const [latest] = await listGuildSnapshots(guild.id, 1)
            if (latest) {
                result.snapshotRestore = await restoreGuildSnapshot(guild, latest.snapshotId, {
                    reason: `Automatic panic recovery: ${reason}`,
                    actor,
                })
            }
        } catch (err) {
            result.snapshotRestore = { ok: false, error: err.message }
        }
    }
    if (result.ok && fortress.panic.autoReleaseMinutes > 0) {
        const existing = panicReleaseTimers.get(guild.id)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
            disableEmergencyLockdown(guild, {
                reason: "Automatic Fortress panic release",
                actor: { id: guild.members.me?.id, tag: "CURSED Fortress" },
            }).catch(err => log.error(`Automatic panic release failed: ${err.message}`))
            panicReleaseTimers.delete(guild.id)
        }, fortress.panic.autoReleaseMinutes * 60_000)
        timer.unref?.()
        panicReleaseTimers.set(guild.id, timer)
    }
    return result
}

async function processAuditEvent(guild, eventType, auditTypes, target = null, extra = {}) {
    const definition = EVENT_DEFINITIONS[eventType]
    if (!guild || !definition) return false
    if (consumeInternalAction(guild.id, eventType, target?.id || null)) return false
    const security = getSecurityPhase3Config(guild.id)
    const fortress = getFortressConfig(guild.id)
    if (!security.enabled || !security.antiNuke.enabled) return false
    const entry = await fetchMatchingAuditEntry(guild, auditTypes, target?.id || extra.auditTargetId || null, fortress)
    if (!entry || !rememberAuditId(guild.id, entry.id)) return false
    const executorId = String(entry.executorId || entry.executor?.id || "")
    if (!executorId || executorId === guild.members.me?.id) return false
    const executorMember = guild.members.cache.get(executorId)
        || await guild.members.fetch(executorId).catch(() => null)

    if (executorId === guild.ownerId) {
        const summary = `${definition.label} was performed by the server owner. CURSED cannot neutralize the owner account.`
        await recordAndAlert(guild, security, fortress, {
            type: `OWNER_${eventType.toUpperCase()}`,
            severity: "critical",
            executorId,
            executorTag: userTag(entry.executor),
            targetId: target?.id || String(entry.targetId || entry.target?.id || "") || null,
            targetTag: target?.name || target?.tag || userTag(entry.target) || null,
            actionTaken: "owner-alert",
            auditLogEntryId: entry.id,
            details: { summary, rollback: { attempted: false }, containment: { action: "owner-alert" } },
        })
        return true
    }

    if (isTrustedForScope({
        guildId: guild.id,
        member: executorMember,
        userId: executorId,
        isBot: entry.executor?.bot,
        channelId: target?.id || extra.channelId || null,
        scope: definition.scope,
    })) return false

    const antiNuke = security.antiNuke
    const threshold = antiNuke.thresholds[definition.thresholdKey] || 1
    const windowMs = antiNuke.windowSeconds * 1000
    const count = addActionCount(guild.id, executorId, eventType, windowMs)
    const heat = fortress.heat.enabled
        ? addExecutorHeat(guild.id, executorId, definition.heat, fortress)
        : { points: 0, events: [] }
    const instant = fortress.enabled && (fortress.mode === "strict" || definition.instant)
    const thresholdReached = count >= threshold
    const heatReached = fortress.enabled && fortress.heat.enabled && heat.points >= fortress.heat.threshold
    const trigger = (instant || thresholdReached || heatReached) && shouldTrigger(guild.id, executorId, eventType, windowMs)
    const summary = `${definition.label}: ${count} action(s) by ${userTag(entry.executor)} within ${antiNuke.windowSeconds}s. Event heat ${definition.heat}; executor heat ${heat.points}.`
    const reason = `CURSED Fortress: ${summary}`
    const actor = { id: guild.members.me?.id, tag: "CURSED Fortress" }
    let containment = { ok: false, action: "alert", errors: [] }

    if (trigger && fortress.enabled && fortress.response.neutralizeFirst) {
        containment = await neutralizeExecutor(guild, executorMember, security, fortress, { reason, actor })
    } else if (trigger && !fortress.enabled) {
        if (antiNuke.action === "quarantine" && executorMember) {
            const result = await quarantineMember(guild, executorMember, security, { reason, moderator: actor })
            containment = { ok: result.ok, action: result.ok ? "quarantine" : "alert", errors: result.ok ? [] : [result.error] }
        } else if (antiNuke.action === "lockdown") {
            const result = await enableEmergencyLockdown(guild, security, { reason, actor })
            containment = { ok: result.ok, action: result.ok ? "lockdown" : "alert", errors: result.ok ? [] : [result.error] }
        }
    }

    const rollback = fortress.enabled
        ? await attemptRollback(guild, eventType, target, entry, extra, fortress, reason)
        : { attempted: false, ok: false, error: "Fortress rollback disabled." }

    if (trigger && fortress.enabled && !fortress.response.neutralizeFirst) {
        containment = await neutralizeExecutor(guild, executorMember, security, fortress, { reason, actor })
    }

    const panicRequired = fortress.enabled
        && fortress.panic.enabled
        && (heat.points >= fortress.heat.panicThreshold || (fortress.panic.triggerOnCritical && definition.severity === "critical" && trigger))
    let panic = null
    if (panicRequired) panic = await triggerPanic(guild, security, fortress, reason, actor)

    await recordAndAlert(guild, security, fortress, {
        type: `FORTRESS_${eventType.toUpperCase()}`,
        severity: definition.severity,
        executorId,
        executorTag: userTag(entry.executor),
        targetId: target?.id || String(entry.targetId || entry.target?.id || "") || null,
        targetTag: target?.name || target?.tag || entry.target?.name || userTag(entry.target) || null,
        actionTaken: [containment.action, rollback.ok ? "rollback" : null, panic?.ok ? "panic" : null].filter(Boolean).join("+") || "alert",
        auditLogEntryId: entry.id,
        details: {
            summary,
            count,
            threshold,
            windowSeconds: antiNuke.windowSeconds,
            executorHeat: heat.points,
            eventHeat: definition.heat,
            trigger,
            instant,
            containment,
            rollback,
            panic,
            ...extra.details,
        },
    })
    return true
}

function calculateJoinRisk(member, joinGate) {
    const reasons = []
    let score = 0
    const accountAgeHours = Math.floor((now() - member.user.createdTimestamp) / 3_600_000)
    if (joinGate.noAvatar && !member.user.avatar) {
        score += joinGate.noAvatarScore
        reasons.push("no custom avatar")
    }
    if (accountAgeHours < joinGate.accountAgeHours) {
        score += joinGate.newAccountScore
        reasons.push(`account age ${accountAgeHours}h`)
    }
    const name = `${member.user.username || ""} ${member.user.globalName || ""}`
    if (joinGate.advertisingName && /(?:discord\.gg|\.gg\/|free\s*nitro|dm\s*me|join\s*my|promo)/i.test(name)) {
        score += joinGate.advertisingNameScore
        reasons.push("advertising username")
    }
    for (const raw of joinGate.usernamePatterns || []) {
        try {
            if (new RegExp(raw, "i").test(name)) {
                score += joinGate.usernamePatternScore
                reasons.push(`matched username pattern: ${raw}`)
                break
            }
        } catch { /* invalid patterns are ignored by runtime */ }
    }
    return { score, reasons, accountAgeHours }
}

async function executeJoinGateAction(member, security, fortress, risk) {
    const action = fortress.joinGate.action
    const reason = `CURSED Join Gate: risk ${risk.score}/${fortress.joinGate.minimumScore}; ${risk.reasons.join(", ") || "raid threshold"}`
    if (action === "alert") return { ok: true, action: "alert" }
    if (action === "quarantine") {
        const result = await quarantineMember(member.guild, member, security, {
            reason,
            moderator: { id: member.guild.members.me?.id, tag: "CURSED Join Gate" },
        })
        return { ok: result.ok, action: result.ok ? "quarantine" : "alert", error: result.error }
    }
    if (action === "timeout") {
        if (!member.moderatable) return { ok: false, action: "alert", error: "Member is not moderatable." }
        await member.timeout(fortress.response.timeoutMinutes * 60_000, reason.slice(0, 512))
        return { ok: true, action: "timeout" }
    }
    if (action === "kick") {
        if (!member.kickable) return { ok: false, action: "alert", error: "Member is not kickable." }
        await member.kick(reason.slice(0, 512))
        return { ok: true, action: "kick" }
    }
    if (action === "ban") {
        if (!member.bannable) return { ok: false, action: "alert", error: "Member is not bannable." }
        await member.ban({ reason: reason.slice(0, 512), deleteMessageSeconds: 0 })
        return { ok: true, action: "ban" }
    }
    return { ok: false, action: "alert", error: "Unsupported Join Gate action." }
}

async function processJoin(member) {
    const guild = member?.guild
    if (!guild || member.user?.bot) return false
    const security = getSecurityPhase3Config(guild.id)
    const fortress = getFortressConfig(guild.id)
    if (!security.enabled || (!security.antiRaid.enabled && !fortress.joinGate.enabled)) return false
    if (isTrustedForScope({ guildId: guild.id, member, userId: member.id, isBot: false, scope: "antiRaid" })) return false

    const raid = security.antiRaid
    const windowMs = raid.windowSeconds * 1000
    const times = pruneTimes(joinWindows.get(guild.id) || [], windowMs)
    times.push(now())
    joinWindows.set(guild.id, times)
    const thresholdReached = security.antiRaid.enabled && times.length >= raid.joinThreshold
    if (thresholdReached) activeRaids.set(guild.id, now() + raid.activeRaidSeconds * 1000)
    const raidActive = thresholdReached || (activeRaids.get(guild.id) || 0) > now()
    const risk = calculateJoinRisk(member, fortress.joinGate)
    const joinGateTriggered = fortress.enabled
        && fortress.joinGate.enabled
        && (!fortress.joinGate.onlyDuringRaid || raidActive)
        && risk.score >= fortress.joinGate.minimumScore

    let response = { ok: true, action: "alert" }
    if (joinGateTriggered) {
        response = await executeJoinGateAction(member, security, fortress, risk)
    } else if (thresholdReached && security.antiRaid.enabled) {
        if (raid.action === "quarantine") {
            const result = await quarantineMember(guild, member, security, {
                reason: `Anti-raid: ${times.length} joins in ${raid.windowSeconds}s`,
                moderator: { id: guild.members.me?.id, tag: "CURSED Anti-Raid" },
            })
            response = { ok: result.ok, action: result.ok ? "quarantine" : "alert", error: result.error }
        } else if (raid.action === "lockdown") {
            const result = await enableEmergencyLockdown(guild, security, {
                reason: `Anti-raid: ${times.length} joins in ${raid.windowSeconds}s`,
                actor: { id: guild.members.me?.id, tag: "CURSED Anti-Raid" },
            })
            response = { ok: result.ok, action: result.ok ? "lockdown" : "alert", error: result.error }
        }
    } else return false

    const summary = `Detected ${times.length} joins within ${raid.windowSeconds}s. ${member.user.tag} risk ${risk.score}: ${risk.reasons.join(", ") || "join wave"}.`
    await recordAndAlert(guild, security, fortress, {
        type: joinGateTriggered ? "FORTRESS_JOIN_GATE" : "ANTI_RAID",
        severity: thresholdReached ? "critical" : "high",
        executorId: null,
        executorTag: "Automated join detection",
        targetId: member.id,
        targetTag: userTag(member.user),
        actionTaken: response.action,
        details: { summary, joins: times.length, risk, raidActive, response },
    })
    return true
}

function safeListener(label, handler) {
    return (...args) => Promise.resolve(handler(...args)).catch(err => {
        log.error(`${label} failed safely: ${err.message}`)
    })
}

function attachSecurityProtection(client) {
    if (attached || !client) return
    attached = true

    client.on(Events.GuildMemberAdd, safeListener("member-add", async member => {
        if (member.user?.bot) await processAuditEvent(member.guild, "botAdds", AuditLogEvent.BotAdd, member)
        else await processJoin(member)
    }))
    client.on(Events.GuildBanAdd, safeListener("ban-add", ban => processAuditEvent(ban.guild, "bans", AuditLogEvent.MemberBanAdd, ban.user)))
    client.on(Events.GuildMemberRemove, safeListener("member-remove", member => processAuditEvent(member.guild, "kicks", AuditLogEvent.MemberKick, member.user)))
    client.on(Events.ChannelDelete, safeListener("channel-delete", channel => processAuditEvent(channel.guild, "channelDeletes", AuditLogEvent.ChannelDelete, channel)))
    client.on(Events.ChannelCreate, safeListener("channel-create", channel => processAuditEvent(channel.guild, "channelCreates", AuditLogEvent.ChannelCreate, channel)))
    client.on(Events.ChannelUpdate, safeListener("channel-update", async (oldChannel, newChannel) => {
        if (!significantChannelUpdate(oldChannel, newChannel)) return
        await processAuditEvent(newChannel.guild, "channelUpdates", AuditLogEvent.ChannelUpdate, newChannel, { oldTarget: oldChannel })
    }))
    client.on(Events.GuildRoleDelete, safeListener("role-delete", role => processAuditEvent(role.guild, "roleDeletes", AuditLogEvent.RoleDelete, role)))
    client.on(Events.GuildRoleCreate, safeListener("role-create", role => processAuditEvent(role.guild, "roleCreates", AuditLogEvent.RoleCreate, role)))
    client.on(Events.GuildRoleUpdate, safeListener("role-update", async (oldRole, newRole) => {
        const security = getSecurityPhase3Config(newRole.guild.id)
        const quarantineTamper = security.quarantine.roleId === newRole.id
        const permissionChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield
        const dangerousPermissionChange = dangerousPermissionsAdded(oldRole, newRole)
            || (permissionChanged && hasDangerousPermissions(oldRole))
        if (!quarantineTamper && !dangerousPermissionChange) return
        await processAuditEvent(newRole.guild, "roleUpdates", AuditLogEvent.RoleUpdate, newRole, { oldTarget: oldRole })
    }))
    client.on(Events.GuildMemberUpdate, safeListener("member-update", async (oldMember, newMember) => {
        if (!dangerousRoleGrant(oldMember, newMember)) return
        await processAuditEvent(newMember.guild, "memberRoleUpdates", AuditLogEvent.MemberRoleUpdate, newMember, { oldTarget: oldMember })
    }))
    client.on(Events.WebhooksUpdate, safeListener("webhook-update", channel => processAuditEvent(
        channel.guild,
        "webhookChanges",
        [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookDelete, AuditLogEvent.WebhookUpdate],
        null,
        { channelId: channel.id }
    )))
    client.on(Events.GuildUpdate, safeListener("guild-update", async (oldGuild, newGuild) => {
        if (!significantGuildUpdate(oldGuild, newGuild)) return
        await processAuditEvent(newGuild, "guildUpdates", AuditLogEvent.GuildUpdate, newGuild, { oldTarget: oldGuild, auditTargetId: newGuild.id })
    }))
    client.on(Events.InviteCreate, safeListener("invite-create", invite => processAuditEvent(invite.guild, "inviteCreates", AuditLogEvent.InviteCreate, invite)))
    client.on(Events.InviteDelete, safeListener("invite-delete", invite => processAuditEvent(invite.guild, "inviteDeletes", AuditLogEvent.InviteDelete, invite)))

    prunePoller = setInterval(async () => {
        if (!client.isReady?.()) return
        for (const guild of client.guilds.cache.values()) {
            await processAuditEvent(guild, "prunes", AuditLogEvent.MemberPrune, null).catch(() => {})
        }
    }, 20_000)
    prunePoller.unref?.()
    log.info("Fortress protection listeners attached")
}

module.exports = {
    EVENT_DEFINITIONS,
    attachSecurityProtection,
    processJoin,
    processAuditEvent,
    fetchMatchingAuditEntry,
    dangerousPermissionsAdded,
    calculateJoinRisk,
    addExecutorHeat,
}
