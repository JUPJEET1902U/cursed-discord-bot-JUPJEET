const {
    AuditLogEvent,
    Events,
    PermissionFlagsBits,
} = require("discord.js")
const { LOG_COLORS, buildLogEmbed, userAvatar } = require("./logPresentation")
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
const {
    consumeBotApproval,
    getIncidentModeState,
    listBotApprovals,
    setIncidentMode,
} = require("./securityRecoverySuite")
const {
    runSecurityStateMutation,
    appendExecutorSecurityAction,
    loadExecutorSecurityWindow,
    loadGuildSecurityWindow,
    appendRaidJoin,
    setRaidActiveUntil,
    loadRaidWindow,
} = require("./securityWindowStore")

const joinWindows = new Map()
const raidHydratedAt = new Map()
const raidHydrationFlights = new Map()
const activeRaids = new Map()
const processedJoinEvents = new Map()
const raidBurstCooldowns = new Map()
const executorActionWindows = new Map()
const executorHydratedAt = new Map()
const executorHydrationFlights = new Map()
const guildActionWindows = new Map()
const guildHydratedAt = new Map()
const guildHydrationFlights = new Map()
const triggerCooldowns = new Map()
const auditClaims = new Map()
const processingAddedBots = new Set()
let attached = false

const AUDIT_LOOKUP_DELAYS_MS = Object.freeze([0, 150, 300, 600, 1000])
const AUDIT_PAST_TOLERANCE_MS = 8000
const AUDIT_FUTURE_TOLERANCE_MS = 2000
const AUDIT_CLAIM_TTL_MS = 2 * 60_000
const JOIN_EVENT_TTL_MS = 2 * 60_000
const MIXED_ACTION_SCORE_THRESHOLD = 6
const SLOW_BURN_SCORE_THRESHOLD = 12
const COORDINATED_ACTION_SCORE_THRESHOLD = 10
const MAX_SLOW_BURN_WINDOW_MS = 5 * 60_000
const MAX_COORDINATED_WINDOW_MS = 60_000
const HYDRATION_FAILED = Symbol("hydration-failed")
const HYDRATION_FAILURE_RETRY_MS = 5000

const EVENT_DEFINITIONS = Object.freeze({
    bans: { thresholdKey: "bans", scope: "massModeration", severity: "critical", label: "Mass bans", weight: 1.5 },
    kicks: { thresholdKey: "kicks", scope: "massModeration", severity: "critical", label: "Mass kicks", weight: 1.5 },
    channelDeletes: { thresholdKey: "channelDeletes", scope: "manageChannels", severity: "critical", label: "Channel deletion", weight: 3 },
    channelCreates: { thresholdKey: "channelCreates", scope: "manageChannels", severity: "high", label: "Mass channel creation", weight: 1 },
    channelUpdates: { thresholdKey: "channelUpdates", scope: "manageChannels", severity: "high", label: "Mass channel edits", weight: 1 },
    roleDeletes: { thresholdKey: "roleDeletes", scope: "manageRoles", severity: "critical", label: "Role deletion", weight: 3 },
    roleCreates: { thresholdKey: "roleCreates", scope: "manageRoles", severity: "high", label: "Mass role creation", weight: 1 },
    roleUpdates: { thresholdKey: "roleUpdates", scope: "manageRoles", severity: "high", label: "Mass role edits", weight: 1 },
    webhookChanges: { thresholdKey: "webhookChanges", scope: "manageWebhooks", severity: "critical", label: "Webhook abuse", weight: 3 },
    dangerousRoleChanges: { thresholdKey: "dangerousRoleChanges", scope: "manageRoles", severity: "critical", label: "Dangerous role/hierarchy changes", weight: 3 },
    botAdds: { thresholdKey: "botAdds", scope: "addBots", severity: "critical", label: "Unauthorized bot addition", weight: 4 },
    guildUpdates: { thresholdKey: "guildUpdates", scope: "manageRoles", severity: "high", label: "Mass server setting changes", weight: 2 },
})

function now() {
    return Date.now()
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function slowBurnWindowMs(config) {
    const antiWindowMs = Math.max(1000, Number(config?.antiNuke?.windowSeconds || 10) * 1000)
    return Math.min(MAX_SLOW_BURN_WINDOW_MS, Math.max(2 * 60_000, antiWindowMs * 12))
}

function coordinatedWindowMs(config) {
    const antiWindowMs = Math.max(1000, Number(config?.antiNuke?.windowSeconds || 10) * 1000)
    return Math.min(MAX_COORDINATED_WINDOW_MS, Math.max(30_000, antiWindowMs * 3))
}

function pruneTimedMap(map, ttlMs, currentTime = now(), maxSize = 5000) {
    if (map.size <= maxSize) return
    const cutoff = currentTime - ttlMs
    for (const [key, timestamp] of map) {
        const at = typeof timestamp === "object" && timestamp !== null ? Number(timestamp.at) || 0 : Number(timestamp) || 0
        if (at < cutoff) map.delete(key)
    }
    while (map.size > maxSize) map.delete(map.keys().next().value)
}

function auditClaimKey(entryId, eventType) {
    return `${String(eventType || "unknown")}:${String(entryId || "")}`
}

function claimAuditEntry(entry, eventType) {
    const id = String(entry?.id || "")
    if (!id) return false
    const key = auditClaimKey(id, eventType)
    const currentTime = now()
    const claimedAt = auditClaims.get(key) || 0
    if (currentTime - claimedAt < AUDIT_CLAIM_TTL_MS) return false
    auditClaims.set(key, currentTime)
    pruneTimedMap(auditClaims, AUDIT_CLAIM_TTL_MS, currentTime, 10000)
    return true
}

function counterKey(guildId, executorId, eventType) {
    return `${guildId}:${executorId}:${eventType}`
}

function shouldTrigger(guildId, executorId, eventType, windowMs) {
    const key = counterKey(guildId, executorId, `trigger:${eventType}`)
    const last = triggerCooldowns.get(key) || 0
    if (now() - last < Math.max(2500, windowMs / 2)) return false
    triggerCooldowns.set(key, now())
    pruneTimedMap(triggerCooldowns, Math.max(60_000, windowMs * 4), now(), 4000)
    return true
}

function userTag(user) {
    return user?.tag || user?.username || user?.name || "Unknown user"
}

function actionIdentity(event) {
    return `${String(event.auditId || "no-audit")}:${String(event.eventType || "unknown")}`
}

function mergeActionHistory(existing, incoming, windowMs, currentTime = now()) {
    const cutoff = currentTime - Math.max(1, windowMs)
    const merged = new Map()
    for (const event of [...(existing || []), ...(incoming || [])]) {
        const at = Number(event.at) || currentTime
        if (at < cutoff || at > currentTime + 5000) continue
        const normalized = {
            at,
            eventType: String(event.eventType || "unknown"),
            auditId: event.auditId ? String(event.auditId) : null,
            weight: Number(event.weight) || 1,
        }
        const key = actionIdentity(normalized)
        const previous = merged.get(key)
        if (!previous || previous.at <= normalized.at) merged.set(key, normalized)
    }
    return [...merged.values()].sort((a, b) => a.at - b.at).slice(-200)
}

function mergeGuildActionHistory(existing, incoming, windowMs, currentTime = now()) {
    const cutoff = currentTime - Math.max(1, windowMs)
    const merged = new Map()
    for (const event of [...(existing || []), ...(incoming || [])]) {
        const at = Number(event.at) || currentTime
        if (at < cutoff || at > currentTime + 5000) continue
        const normalized = {
            at,
            executorId: String(event.executorId || "unknown"),
            eventType: String(event.eventType || "unknown"),
            auditId: event.auditId ? String(event.auditId) : null,
            weight: Number(event.weight) || 1,
        }
        const key = `${normalized.executorId}:${actionIdentity(normalized)}`
        const previous = merged.get(key)
        if (!previous || previous.at <= normalized.at) merged.set(key, normalized)
    }
    return [...merged.values()].sort((a, b) => a.at - b.at).slice(-500)
}

async function hydrateExecutorHistory(guildId, executorId, retentionMs) {
    const key = `${guildId}:${executorId}`
    const currentTime = now()
    const lastHydrated = executorHydratedAt.get(key) || 0
    if (executorActionWindows.has(key) && currentTime - lastHydrated < 60_000) {
        const pruned = mergeActionHistory(executorActionWindows.get(key), [], retentionMs, currentTime)
        executorActionWindows.set(key, pruned)
        return pruned
    }
    if (executorHydrationFlights.has(key)) return executorHydrationFlights.get(key)

    const flight = (async () => {
        const local = executorActionWindows.get(key) || []
        const persisted = await loadExecutorSecurityWindow(guildId, executorId, retentionMs).catch(() => HYDRATION_FAILED)
        const persistedHistory = persisted === HYDRATION_FAILED ? [] : (persisted || [])
        const merged = mergeActionHistory(local, persistedHistory, retentionMs, currentTime)
        executorActionWindows.set(key, merged)
        executorHydratedAt.set(
            key,
            persisted === HYDRATION_FAILED
                ? currentTime - (60_000 - HYDRATION_FAILURE_RETRY_MS)
                : currentTime
        )
        return merged
    })().finally(() => executorHydrationFlights.delete(key))
    executorHydrationFlights.set(key, flight)
    return flight
}

async function addExecutorAction(guildId, executorId, eventType, auditId, config) {
    const antiWindowMs = config.antiNuke.windowSeconds * 1000
    const staffWindowMs = config.staffLimits?.enabled ? config.staffLimits.windowSeconds * 1000 : 0
    const retentionMs = Math.max(60_000, antiWindowMs, staffWindowMs, slowBurnWindowMs(config))
    const key = `${guildId}:${executorId}`
    return runSecurityStateMutation(`executor:${key}`, async () => {
        const history = await hydrateExecutorHistory(guildId, executorId, retentionMs)
        const event = {
            at: now(),
            eventType,
            auditId: auditId ? String(auditId) : null,
            weight: EVENT_DEFINITIONS[eventType]?.weight || 1,
        }
        const merged = mergeActionHistory(history, [event], retentionMs)
        executorActionWindows.set(key, merged)
        appendExecutorSecurityAction(guildId, executorId, event, retentionMs).catch(() => {})
        return merged
    })
}

async function hydrateGuildHistory(guildId, windowMs) {
    const currentTime = now()
    const lastHydrated = guildHydratedAt.get(guildId) || 0
    if (guildActionWindows.has(guildId) && currentTime - lastHydrated < 60_000) {
        const pruned = mergeGuildActionHistory(guildActionWindows.get(guildId), [], windowMs, currentTime)
        guildActionWindows.set(guildId, pruned)
        return pruned
    }
    if (guildHydrationFlights.has(guildId)) return guildHydrationFlights.get(guildId)

    const flight = (async () => {
        const local = guildActionWindows.get(guildId) || []
        const persisted = await loadGuildSecurityWindow(guildId, windowMs).catch(() => HYDRATION_FAILED)
        const persistedHistory = persisted === HYDRATION_FAILED ? [] : (persisted || [])
        const merged = mergeGuildActionHistory(local, persistedHistory, windowMs, currentTime)
        guildActionWindows.set(guildId, merged)
        guildHydratedAt.set(
            guildId,
            persisted === HYDRATION_FAILED
                ? currentTime - (60_000 - HYDRATION_FAILURE_RETRY_MS)
                : currentTime
        )
        return merged
    })().finally(() => guildHydrationFlights.delete(guildId))
    guildHydrationFlights.set(guildId, flight)
    return flight
}

async function addGuildAction(guildId, executorId, eventType, auditId, config) {
    const windowMs = coordinatedWindowMs(config)
    return runSecurityStateMutation(`guild-actions:${guildId}`, async () => {
        const history = await hydrateGuildHistory(guildId, windowMs)
        const event = {
            at: now(),
            executorId: String(executorId),
            eventType,
            auditId: auditId ? String(auditId) : null,
            weight: EVENT_DEFINITIONS[eventType]?.weight || 1,
        }
        const merged = mergeGuildActionHistory(history, [event], windowMs)
        guildActionWindows.set(guildId, merged)
        return merged
    })
}

function countEventActions(history, eventType, windowMs, currentTime = now()) {
    const cutoff = currentTime - windowMs
    return (history || []).filter(event => event.eventType === eventType && event.at >= cutoff).length
}

function staffEventTypes(key) {
    if (key === "bans") return new Set(["bans"])
    if (key === "kicks") return new Set(["kicks"])
    if (key === "channelChanges") return new Set(["channelDeletes", "channelCreates", "channelUpdates"])
    if (key === "roleChanges") return new Set(["roleDeletes", "roleCreates", "roleUpdates", "dangerousRoleChanges"])
    if (key === "webhookChanges") return new Set(["webhookChanges"])
    return new Set()
}

function countStaffActions(history, key, windowMs, currentTime = now()) {
    const types = staffEventTypes(key)
    const cutoff = currentTime - windowMs
    const uniqueAuditActions = new Set()
    for (const event of history || []) {
        if (event.at < cutoff || !types.has(event.eventType)) continue
        uniqueAuditActions.add(event.auditId || `${event.eventType}:${event.at}`)
    }
    return uniqueAuditActions.size
}

function actionRisk(history, windowMs, currentTime = now()) {
    const cutoff = currentTime - windowMs
    const byAuditAction = new Map()
    const eventTypes = new Set()
    for (const event of history || []) {
        if (event.at < cutoff) continue
        const key = event.auditId || `${event.eventType}:${event.at}`
        const current = byAuditAction.get(key) || { weight: 0, types: new Set() }
        current.weight = Math.max(current.weight, Number(event.weight) || 1)
        current.types.add(event.eventType)
        byAuditAction.set(key, current)
        eventTypes.add(event.eventType)
    }
    const score = [...byAuditAction.values()].reduce((sum, action) => sum + action.weight, 0)
    return { score, actions: byAuditAction.size, eventTypes: [...eventTypes] }
}

function compositeActionRisk(history, windowMs, currentTime = now()) {
    const risk = actionRisk(history, windowMs, currentTime)
    return {
        ...risk,
        triggered: risk.score >= MIXED_ACTION_SCORE_THRESHOLD && risk.actions >= 2 && risk.eventTypes.length >= 2,
    }
}

function slowBurnActionRisk(history, windowMs, currentTime = now()) {
    const risk = actionRisk(history, windowMs, currentTime)
    return {
        ...risk,
        triggered: risk.score >= SLOW_BURN_SCORE_THRESHOLD
            && risk.actions >= 4
            && (risk.eventTypes.length >= 3 || risk.score >= 15),
    }
}

function coordinatedDestructiveRisk(history, windowMs, currentTime = now()) {
    const cutoff = currentTime - windowMs
    const byAuditAction = new Map()
    const executors = new Set()
    const eventTypes = new Set()
    for (const event of history || []) {
        if (event.at < cutoff) continue
        const key = event.auditId || `${event.executorId}:${event.eventType}:${event.at}`
        const current = byAuditAction.get(key) || { weight: 0, executors: new Set(), types: new Set() }
        current.weight = Math.max(current.weight, Number(event.weight) || 1)
        current.executors.add(String(event.executorId || "unknown"))
        current.types.add(event.eventType)
        byAuditAction.set(key, current)
        executors.add(String(event.executorId || "unknown"))
        eventTypes.add(event.eventType)
    }
    const score = [...byAuditAction.values()].reduce((sum, action) => sum + action.weight, 0)
    const result = {
        score,
        actions: byAuditAction.size,
        executors: [...executors],
        eventTypes: [...eventTypes],
        windowMs,
    }
    return {
        ...result,
        triggered: result.executors.length >= 2
            && result.actions >= 4
            && result.score >= COORDINATED_ACTION_SCORE_THRESHOLD
            && (result.eventTypes.length >= 3 || result.score >= 12),
    }
}

async function sendSecurityAlert(guild, incident, config) {
    const channelId = config.securityLogChannelId
    const channel = channelId ? guild.channels.cache.get(channelId) : null
    if (!channel?.isTextBased()) return false

    const severity = String(incident.severity || "medium").toLowerCase()
    const color = severity === "critical"
        ? LOG_COLORS.critical
        : severity === "high"
            ? LOG_COLORS.securityHigh
            : LOG_COLORS.securityMedium
    const executor = incident.executorId ? `<@${incident.executorId}>` : "Automated detection"
    const target = incident.targetId
        ? incident.targetTag
            ? `**${String(incident.targetTag).slice(0, 180)}**\n\`${incident.targetId}\``
            : `\`${incident.targetId}\``
        : "Multiple targets"
    const executorUser = incident.executorId
        ? guild.members.cache.get(incident.executorId)?.user || guild.client?.users?.cache?.get(incident.executorId) || null
        : null

    const embed = buildLogEmbed({
        guild,
        category: "Security",
        event: String(incident.type || "Security incident").replace(/_/g, " "),
        icon: severity === "critical" ? "🚨" : "🛡️",
        color,
        description: String(incident.details?.summary || "CURSED detected suspicious server activity.").slice(0, 4000),
        fields: [
            { name: "SEVERITY", value: severity.toUpperCase(), inline: true },
            { name: "EXECUTOR", value: executor, inline: true },
            { name: "RESPONSE", value: String(incident.actionTaken || "alert").slice(0, 1024), inline: true },
            { name: "TARGET", value: target, inline: false },
        ],
        thumbnail: userAvatar(executorUser),
        footerMeta: [
            incident.executorId ? `Executor ID: ${incident.executorId}` : null,
            incident.targetId ? `Target ID: ${incident.targetId}` : null,
        ].filter(Boolean).join(" • "),
    })

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

async function maybeActivateIncidentMode(guild, config, reason, severity) {
    if (severity !== "critical" || !config.incidentMode?.enabled) return null
    return setIncidentMode(guild, true, config, {
        reason,
        actor: { id: guild.members.me?.id, tag: "CURSED Automatic Incident Mode" },
        durationMinutes: config.incidentMode.durationMinutes,
    }).catch(() => null)
}

async function maybeHandleCoordinatedDestruction(guild, config, risk) {
    if (!risk?.triggered) return null
    if (!shouldTrigger(guild.id, "multi-executor", "coordinated", risk.windowMs)) return null
    const summary = `Coordinated destructive activity detected: ${risk.actions} audit action(s), risk score ${risk.score}, ${risk.executors.length} distinct executor(s), and ${risk.eventTypes.length} action type(s) within ${Math.round(risk.windowMs / 1000)} seconds.`
    let actionTaken = "alert"
    if (config.antiNuke?.autoLockdown === true && config.lockdown?.enabled) {
        actionTaken = await executeSecurityResponse(guild, config, "lockdown", {
            reason: `Coordinated anti-nuke containment: ${summary}`,
            actor: { id: guild.members.me?.id, tag: "CURSED Coordinated Anti-Nuke" },
        })
    }
    await recordAndAlert(guild, config, {
        type: "ANTI_NUKE_COORDINATED_ACTIVITY",
        severity: "critical",
        executorId: null,
        executorTag: "Multiple untrusted executors",
        targetId: guild.id,
        targetTag: guild.name,
        actionTaken,
        details: { summary, ...risk },
    })
    await maybeActivateIncidentMode(guild, config, summary, "critical")
    return actionTaken
}

function suspiciousRaidUsername(username) {
    const value = String(username || "").toLowerCase()
    return /(discord[\s_-]*nitro|free[\s_-]*nitro|steam[\s_-]*gift|airdrop|crypto|support[\s_-]*team|moderator[\s_-]*team|admin[\s_-]*team)/i.test(value)
        || /[a-z0-9]{18,}/i.test(value)
}

function assessRaidJoinRisk(member, raid, incidentMode = { active: false }) {
    const accountAgeHours = Math.floor((now() - Number(member?.user?.createdTimestamp || now())) / 3_600_000)
    const isBot = member?.user?.bot === true
    const isYoung = accountAgeHours < raid.minAccountAgeHours
    let score = 0
    const signals = []
    if (isBot) { score += 3; signals.push("bot account") }
    if (isYoung) { score += 2; signals.push(`account age ${accountAgeHours}h`) }
    if (raid.requireAvatar && !member?.user?.avatar) { score += 1; signals.push("no custom avatar") }
    if (raid.suspiciousNameCheck && suspiciousRaidUsername(member?.user?.username)) { score += 2; signals.push("suspicious username") }
    if (incidentMode?.active) { score += 2; signals.push("incident mode active") }
    return { score, signals, accountAgeHours, isBot, isYoung }
}

function raidWindowMetrics(records, raid) {
    const total = records.length
    const bots = records.filter(record => record.isBot).length
    const young = records.filter(record => record.isYoung).length
    const risky = records.filter(record => Number(record.riskScore) >= raid.riskScoreThreshold).length
    return {
        total,
        bots,
        young,
        risky,
        botRatio: total ? bots / total : 0,
        youngRatio: total ? young / total : 0,
        riskyRatio: total ? risky / total : 0,
    }
}

function raidDecision(records, raid, risk, { incidentModeActive = false, activeUntil = 0, currentTime = now() } = {}) {
    const metrics = raidWindowMetrics(records, raid)
    const effectiveThreshold = incidentModeActive
        ? Math.max(3, Math.ceil(raid.joinThreshold * 0.7))
        : raid.joinThreshold
    const thresholdReached = metrics.total >= effectiveThreshold
    const highConfidenceBurst = thresholdReached && (
        metrics.botRatio >= 0.5
        || metrics.youngRatio >= 0.5
        || metrics.riskyRatio >= 0.5
    )
    const raidActive = highConfidenceBurst || incidentModeActive || Number(activeUntil) > currentTime
    const shouldAct = risk.isBot
        ? raidActive
        : raidActive && (
            risk.score >= raid.riskScoreThreshold
            || (highConfidenceBurst && risk.isYoung)
        )
    return { ...metrics, effectiveThreshold, thresholdReached, highConfidenceBurst, raidActive, shouldAct }
}

function joinEventKey(member) {
    return `${member.guild.id}:${member.id}:${Number(member.joinedTimestamp || 0)}`
}

function rememberJoinEvent(member) {
    const key = joinEventKey(member)
    const currentTime = now()
    const previous = processedJoinEvents.get(key) || 0
    if (currentTime - previous < JOIN_EVENT_TTL_MS) return false
    processedJoinEvents.set(key, currentTime)
    pruneTimedMap(processedJoinEvents, JOIN_EVENT_TTL_MS, currentTime, 10000)
    return true
}

function mergeRaidRecords(existing, incoming, windowMs, currentTime = now()) {
    const cutoff = currentTime - windowMs
    const merged = new Map()
    for (const record of [...(existing || []), ...(incoming || [])]) {
        const at = Number(record.at) || currentTime
        if (at < cutoff || at > currentTime + 5000) continue
        const normalized = {
            at,
            userId: String(record.userId || "unknown"),
            joinedTimestamp: Number(record.joinedTimestamp) || 0,
            isBot: record.isBot === true,
            isYoung: record.isYoung === true,
            riskScore: Number(record.riskScore) || 0,
        }
        const key = `${normalized.userId}:${normalized.joinedTimestamp || normalized.at}`
        const previous = merged.get(key)
        if (!previous || previous.at <= normalized.at) merged.set(key, normalized)
    }
    return [...merged.values()].sort((a, b) => a.at - b.at).slice(-250)
}

async function hydrateRaidWindow(guildId, windowMs) {
    const currentTime = now()
    const lastHydrated = raidHydratedAt.get(guildId) || 0
    if (joinWindows.has(guildId) && currentTime - lastHydrated < 60_000) {
        const pruned = mergeRaidRecords(joinWindows.get(guildId), [], windowMs, currentTime)
        joinWindows.set(guildId, pruned)
        return pruned
    }
    if (raidHydrationFlights.has(guildId)) return raidHydrationFlights.get(guildId)

    const flight = (async () => {
        const persisted = await loadRaidWindow(guildId, windowMs).catch(() => HYDRATION_FAILED)
        const persistedEvents = persisted === HYDRATION_FAILED ? [] : (persisted?.events || [])
        const merged = mergeRaidRecords(joinWindows.get(guildId) || [], persistedEvents, windowMs, currentTime)
        joinWindows.set(guildId, merged)
        if (persisted !== HYDRATION_FAILED && persisted?.activeUntil > currentTime) activeRaids.set(guildId, persisted.activeUntil)
        raidHydratedAt.set(
            guildId,
            persisted === HYDRATION_FAILED
                ? currentTime - (60_000 - HYDRATION_FAILURE_RETRY_MS)
                : currentTime
        )
        return merged
    })().finally(() => raidHydrationFlights.delete(guildId))
    raidHydrationFlights.set(guildId, flight)
    return flight
}

async function hasActiveBotApproval(guildId, botId) {
    const approvals = await listBotApprovals(guildId, 50).catch(() => [])
    return approvals.some(approval => String(approval.botId) === String(botId) && approval.active === true)
}

function shouldAnnounceRaidBurst(guildId) {
    const currentTime = now()
    const last = raidBurstCooldowns.get(guildId) || 0
    if (currentTime - last < 30_000) return false
    raidBurstCooldowns.set(guildId, currentTime)
    pruneTimedMap(raidBurstCooldowns, 10 * 60_000, currentTime, 2000)
    return true
}

async function processJoin(member) {
    const guild = member?.guild
    if (!guild || !member.user) return false
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.antiRaid.enabled) return false
    if (!rememberJoinEvent(member)) return false
    if (isTrustedForScope({ guildId: guild.id, member, userId: member.id, isBot: member.user.bot, scope: "antiRaid" })) return false
    if (member.user.bot && config.botApprovals?.enabled && await hasActiveBotApproval(guild.id, member.id)) return false

    const raid = config.antiRaid
    const mode = await getIncidentModeState(guild.id).catch(() => ({ active: false }))
    const windowMs = raid.windowSeconds * 1000
    const risk = assessRaidJoinRisk(member, raid, mode)
    const record = {
        at: now(),
        userId: member.id,
        joinedTimestamp: Number(member.joinedTimestamp || now()),
        isBot: risk.isBot,
        isYoung: risk.isYoung,
        riskScore: risk.score,
    }

    const state = await runSecurityStateMutation(`raid:${guild.id}`, async () => {
        let records = await hydrateRaidWindow(guild.id, windowMs)
        records = mergeRaidRecords(records, [record], windowMs)
        joinWindows.set(guild.id, records)

        let activeUntil = activeRaids.get(guild.id) || 0
        if (activeUntil <= now()) {
            activeUntil = 0
            activeRaids.delete(guild.id)
        }
        let decision = raidDecision(records, raid, risk, { incidentModeActive: mode.active, activeUntil })
        if (decision.highConfidenceBurst) {
            activeUntil = Math.max(activeUntil, now() + raid.activeRaidSeconds * 1000)
            activeRaids.set(guild.id, activeUntil)
            decision = raidDecision(records, raid, risk, { incidentModeActive: mode.active, activeUntil })
            setRaidActiveUntil(guild.id, activeUntil, Math.max(windowMs, raid.activeRaidSeconds * 1000)).catch(() => {})
        }
        appendRaidJoin(guild.id, record, Math.max(windowMs, raid.activeRaidSeconds * 1000), activeUntil || null).catch(() => {})
        return { decision, activeUntil }
    })
    const { decision, activeUntil } = state

    const summary = `Anti-raid observed ${decision.total} joins in ${raid.windowSeconds}s: ${decision.young} young account(s), ${decision.bots} bot(s), ${decision.risky} high-risk join(s). Current account risk ${risk.score}/${raid.riskScoreThreshold}.`

    if (decision.highConfidenceBurst && shouldAnnounceRaidBurst(guild.id)) {
        await recordAndAlert(guild, config, {
            type: "ANTI_RAID_BURST",
            severity: "critical",
            executorId: null,
            executorTag: "Automated raid detection",
            targetId: guild.id,
            targetTag: guild.name,
            actionTaken: "raid window activated",
            details: { summary, ...decision, activeUntil },
        })
        await maybeActivateIncidentMode(guild, config, summary, "critical")
    }

    if (!decision.shouldAct) return decision.highConfidenceBurst

    let response
    if (member.user.bot) {
        const removal = await removeUnauthorizedAddedBot(member, `CURSED anti-raid bot flood: ${summary}`)
        response = removal.action || (removal.ok ? "bot removed" : "alert")
    } else {
        response = await executeSecurityResponse(guild, config, raid.action, {
            member,
            reason: `Anti-raid: ${summary}`,
            actor: { id: guild.members.me?.id, tag: "CURSED Anti-Raid" },
        })
    }

    await recordAndAlert(guild, config, {
        type: member.user.bot ? "ANTI_RAID_BOT" : "ANTI_RAID",
        severity: decision.highConfidenceBurst || mode.active ? "critical" : "high",
        executorId: null,
        executorTag: "Automated raid detection",
        targetId: member.id,
        targetTag: userTag(member.user),
        actionTaken: response,
        details: { summary, ...decision, ...risk, activeUntil },
    })
    return true
}

async function fetchAuditCandidatesOnce(guild, auditTypes, targetId = null, options = {}) {
    const types = (Array.isArray(auditTypes) ? auditTypes : [auditTypes]).filter(type => type !== undefined && type !== null)
    const candidatesById = new Map()
    for (const type of types) {
        try {
            const logs = await guild.fetchAuditLogs({ type, limit: 8 })
            for (const entry of logs.entries.values()) {
                const id = String(entry.id || `${type}:${entry.createdTimestamp}`)
                candidatesById.set(id, entry)
            }
        } catch { /* missing View Audit Log or unsupported audit event */ }
    }

    const observedAt = Number(options.observedAt) || now()
    const maxPastMs = Math.max(1000, Number(options.maxPastMs) || AUDIT_PAST_TOLERANCE_MS)
    const maxFutureMs = Math.max(0, Number(options.maxFutureMs) || AUDIT_FUTURE_TOLERANCE_MS)
    const lowerBound = observedAt - maxPastMs
    const upperBound = observedAt + maxFutureMs

    return [...candidatesById.values()]
        .filter(entry => Number(entry.createdTimestamp) >= lowerBound && Number(entry.createdTimestamp) <= upperBound)
        .filter(entry => !targetId || String(entry.targetId || entry.target?.id || "") === String(targetId))
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
}

async function fetchMatchingAuditEntry(guild, auditTypes, targetId = null, retryDelays = AUDIT_LOOKUP_DELAYS_MS, options = {}) {
    const delays = Array.isArray(retryDelays) && retryDelays.length ? retryDelays : AUDIT_LOOKUP_DELAYS_MS
    const observedAt = Number(options.observedAt) || now()
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
        const delay = Math.max(0, Number(delays[attempt]) || 0)
        if (delay > 0) await sleep(delay)
        const candidates = await fetchAuditCandidatesOnce(guild, auditTypes, targetId, { ...options, observedAt })
        if (candidates.length) return candidates[0]
    }
    return null
}

async function claimMatchingAuditEntry(guild, eventType, auditTypes, targetId = null, retryDelays = AUDIT_LOOKUP_DELAYS_MS, options = {}) {
    const delays = Array.isArray(retryDelays) && retryDelays.length ? retryDelays : AUDIT_LOOKUP_DELAYS_MS
    const observedAt = Number(options.observedAt) || now()
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
        const delay = Math.max(0, Number(delays[attempt]) || 0)
        if (delay > 0) await sleep(delay)
        const candidates = await fetchAuditCandidatesOnce(guild, auditTypes, targetId, { ...options, observedAt })
        for (const entry of candidates) {
            if (claimAuditEntry(entry, eventType)) return entry
        }
    }
    return null
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
                await guild.members.ban(current.id, {
                    reason: String(reason).slice(0, 512),
                    deleteMessageSeconds: 86400,
                })
                return { ok: true, action: "bot banned", attempts: attempt, errors }
            } catch (err) {
                errors.push(`ban attempt ${attempt}: ${err.message}`)
            }
        }

        if (current.kickable && guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
            try {
                await current.kick(String(reason).slice(0, 512))
                return { ok: true, action: "bot kicked", attempts: attempt, errors }
            } catch (err) {
                errors.push(`kick attempt ${attempt}: ${err.message}`)
            }
        }

        if (attempt < 3) await sleep(attempt * 400)
    }

    return { ok: false, action: "bot removal failed", attempts: 3, errors }
}

async function processUnauthorizedBotAdd(member) {
    const guild = member?.guild
    if (!guild || !member.user?.bot || member.id === guild.members.me?.id) return false

    const processingKey = `${guild.id}:${member.id}`
    if (processingAddedBots.has(processingKey)) return false
    processingAddedBots.add(processingKey)

    try {
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.antiNuke.enabled) return false

        const observedAt = now()
        const entry = await claimMatchingAuditEntry(guild, "botAdds", AuditLogEvent.BotAdd, member.id, AUDIT_LOOKUP_DELAYS_MS, { observedAt })
        if (!entry) return false

        const inviterId = String(entry.executorId || entry.executor?.id || "")
        if (!inviterId || inviterId === guild.members.me?.id || inviterId === guild.ownerId) return false
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
                    details: { summary: `${userTag(member.user)} was allowed using a valid owner bot approval.`, approvalId: approval.id },
                })
                return true
            }
        }

        if (isTrustedForScope({
            guildId: guild.id,
            member: inviterMember,
            userId: inviterId,
            isBot: entry.executor?.bot,
            scope: "addBots",
        })) return false

        const antiNuke = config.antiNuke
        const windowMs = antiNuke.windowSeconds * 1000
        const slowWindowMs = slowBurnWindowMs(config)
        const guildWindowMs = coordinatedWindowMs(config)
        const history = await addExecutorAction(guild.id, inviterId, "botAdds", entry.id, config)
        const guildHistory = await addGuildAction(guild.id, inviterId, "botAdds", entry.id, config)
        const count = countEventActions(history, "botAdds", windowMs)
        const mixed = compositeActionRisk(history, windowMs)
        const slow = slowBurnActionRisk(history, slowWindowMs)
        const coordinated = coordinatedDestructiveRisk(guildHistory, guildWindowMs)
        const summary = `Unauthorized bot addition: ${userTag(entry.executor)} added ${userTag(member.user)} (${member.id}).`

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
            details: { summary, botRemoval, mixed, slow, coordinated },
        })
        await maybeHandleCoordinatedDestruction(guild, config, coordinated)

        const threshold = antiNuke.thresholds.botAdds
        const thresholdTriggered = count >= threshold
        const individualTriggered = thresholdTriggered || mixed.triggered || slow.triggered
        const triggerType = slow.triggered && !mixed.triggered && !thresholdTriggered
            ? "slow-burn"
            : mixed.triggered && !thresholdTriggered ? "mixed" : "botAdds"
        const triggerWindowMs = triggerType === "slow-burn" ? slowWindowMs : windowMs
        if (!individualTriggered || !shouldTrigger(guild.id, inviterId, triggerType, triggerWindowMs)) return botRemoval.ok

        const inviterResponse = inviterMember
            ? await executeSecurityResponse(guild, config, antiNuke.action, {
                member: inviterMember,
                reason: `Anti-nuke inviter response: ${summary}`,
                actor: { id: guild.members.me?.id, tag: "CURSED Anti-Nuke" },
            })
            : "alert (inviter no longer in server)"

        const incidentType = slow.triggered && !thresholdTriggered && !mixed.triggered
            ? "ANTI_NUKE_SLOW_BURN"
            : mixed.triggered && !thresholdTriggered ? "ANTI_NUKE_MIXED_ACTIVITY" : "ANTI_NUKE_BOTADDS"
        await recordAndAlert(guild, config, {
            type: incidentType,
            severity: "critical",
            executorId: inviterId,
            executorTag: userTag(entry.executor),
            targetId: member.id,
            targetTag: userTag(member.user),
            actionTaken: inviterResponse,
            auditLogEntryId: entry.id,
            details: {
                summary: `${summary} Added bot response: ${botRemoval.action}. Inviter response: ${inviterResponse}.`,
                count,
                threshold,
                windowSeconds: antiNuke.windowSeconds,
                mixed,
                slow,
                coordinated,
                botRemoval,
            },
        })
        await maybeActivateIncidentMode(guild, config, summary, "critical")
        return botRemoval.ok
    } finally {
        const timer = setTimeout(() => processingAddedBots.delete(processingKey), 30000)
        if (typeof timer.unref === "function") timer.unref()
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
    const definition = EVENT_DEFINITIONS[eventType]
    if (!guild || !definition || eventType === "botAdds") return false
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.antiNuke.enabled) return false

    const { auditEntry: providedEntry = null, observedAt = now(), ...incidentExtra } = extra || {}
    let entry = providedEntry
    if (entry) {
        if (!claimAuditEntry(entry, eventType)) return false
    } else {
        entry = await claimMatchingAuditEntry(guild, eventType, auditTypes, target?.id || null, AUDIT_LOOKUP_DELAYS_MS, { observedAt })
    }
    if (!entry) return false

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
    const slowWindowMs = slowBurnWindowMs(config)
    const guildWindowMs = coordinatedWindowMs(config)
    const history = await addExecutorAction(guild.id, executorId, eventType, entry.id, config)
    const guildHistory = await addGuildAction(guild.id, executorId, eventType, entry.id, config)
    const count = countEventActions(history, eventType, windowMs)
    const mixed = compositeActionRisk(history, windowMs)
    const slow = slowBurnActionRisk(history, slowWindowMs)
    const coordinated = coordinatedDestructiveRisk(guildHistory, guildWindowMs)

    let staff = null
    if (!entry.executor?.bot && !isTrustedForScope({
        guildId: guild.id,
        member: executorMember,
        userId: executorId,
        isBot: false,
        scope: "staffLimits",
    })) {
        const definitionForStaff = staffLimitDefinition(eventType, config)
        if (definitionForStaff) {
            const staffWindowMs = config.staffLimits.windowSeconds * 1000
            const staffCount = countStaffActions(history, definitionForStaff.key, staffWindowMs)
            staff = { ...definitionForStaff, count: staffCount, windowSeconds: config.staffLimits.windowSeconds }
        }
    }

    const staffTriggered = Boolean(staff && staff.count >= staff.threshold)
    const antiNukeTriggered = count >= threshold
    const mixedTriggered = mixed.triggered
    const slowTriggered = slow.triggered
    const summary = `${definition.label}: ${count} action(s) by ${userTag(entry.executor)} within ${antiNuke.windowSeconds} seconds (threshold ${threshold}).${staff ? ` Staff limit: ${staff.count}/${staff.threshold} ${staff.key} in ${staff.windowSeconds}s.` : ""}${mixedTriggered ? ` Mixed-action risk: ${mixed.score} across ${mixed.actions} audit action(s) and ${mixed.eventTypes.length} event type(s).` : ""}${slowTriggered ? ` Slow-burn risk: ${slow.score} across ${slow.actions} audit action(s) over ${Math.round(slowWindowMs / 1000)}s.` : ""}`

    const coordinatedPromise = maybeHandleCoordinatedDestruction(guild, config, coordinated)
    const recovery = await recoveryForEvent(guild, config, eventType, target, summary)
    await coordinatedPromise

    if (!antiNukeTriggered && !staffTriggered && !mixedTriggered && !slowTriggered) return Boolean(recovery?.ok || coordinated.triggered)

    const triggerType = staffTriggered
        ? `staff:${eventType}`
        : slowTriggered && !mixedTriggered && !antiNukeTriggered
            ? "slow-burn"
            : mixedTriggered && !antiNukeTriggered ? "mixed" : eventType
    const triggerWindowMs = staffTriggered
        ? config.staffLimits.windowSeconds * 1000
        : triggerType === "slow-burn" ? slowWindowMs : windowMs
    if (!shouldTrigger(guild.id, executorId, triggerType, triggerWindowMs)) return Boolean(recovery?.ok)

    const responseAction = staffTriggered ? config.staffLimits.action : antiNuke.action
    const response = await executeSecurityResponse(guild, config, responseAction, {
        member: executorMember,
        reason: `${staffTriggered ? "Staff safety limit" : "Anti-nuke"}: ${summary}`,
        actor: { id: guild.members.me?.id, tag: staffTriggered ? "CURSED Staff Safety" : "CURSED Anti-Nuke" },
    })
    const incidentType = staffTriggered
        ? `STAFF_LIMIT_${eventType.toUpperCase()}`
        : slowTriggered && !antiNukeTriggered && !mixedTriggered
            ? "ANTI_NUKE_SLOW_BURN"
            : mixedTriggered && !antiNukeTriggered
                ? "ANTI_NUKE_MIXED_ACTIVITY"
                : `ANTI_NUKE_${eventType.toUpperCase()}`
    const severity = staffTriggered || mixedTriggered || slowTriggered ? "critical" : definition.severity
    await recordAndAlert(guild, config, {
        type: incidentType,
        severity,
        executorId,
        executorTag: userTag(entry.executor),
        targetId: target?.id || String(entry.targetId || entry.target?.id || "") || null,
        targetTag: target?.name || target?.tag || entry.target?.name || userTag(entry.target) || null,
        actionTaken: response,
        auditLogEntryId: entry.id,
        details: { summary, count, threshold, windowSeconds: antiNuke.windowSeconds, staff, mixed, slow, coordinated, recovery, ...incidentExtra },
    })
    await maybeActivateIncidentMode(guild, config, summary, severity)
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

function dangerousRoleChange(oldRole, newRole) {
    if (dangerousPermissionsAdded(oldRole, newRole)) return true
    const guild = newRole?.guild
    const me = guild?.members?.me
    if (!guild || !me || newRole.id === me.roles.highest?.id) return false
    const dangerous = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.BanMembers,
    ].some(permission => newRole.permissions.has(permission))
    if (!dangerous) return false
    const botPosition = me.roles.highest?.position || 0
    return oldRole.position < botPosition && newRole.position >= botPosition
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
        const observedAt = now()
        const entry = await fetchMatchingAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id, AUDIT_LOOKUP_DELAYS_MS, { observedAt })
        const details = {
            oldPermissions: oldRole.permissions.bitfield.toString(),
            newPermissions: newRole.permissions.bitfield.toString(),
            oldPosition: oldRole.position,
            newPosition: newRole.position,
            auditEntry: entry,
            observedAt,
        }
        if (dangerousRoleChange(oldRole, newRole)) {
            await processAuditEvent(newRole.guild, "dangerousRoleChanges", AuditLogEvent.RoleUpdate, newRole, details)
        }
        await processAuditEvent(newRole.guild, "roleUpdates", AuditLogEvent.RoleUpdate, newRole, details)
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
    fetchMatchingAuditEntry,
    claimMatchingAuditEntry,
    claimAuditEntry,
    addExecutorAction,
    compositeActionRisk,
    slowBurnActionRisk,
    coordinatedDestructiveRisk,
    raidDecision,
    assessRaidJoinRisk,
    dangerousPermissionsAdded,
    dangerousRoleChange,
    staffLimitDefinition,
}
