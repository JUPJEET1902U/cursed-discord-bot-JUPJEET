const {
    AuditLogEvent,
    Events,
} = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { createSecurityIncident } = require("./securityIncidents")
const { quarantineMember } = require("./quarantineState")
const { notifyOwner } = require("./securityResponse")
const { getIncidentModeState, setIncidentMode } = require("./securityRecoverySuite")

const joinWindows = new Map()
let attached = false

function suspiciousUsername(username) {
    const value = String(username || "").toLowerCase()
    return /(discord[\s_-]*nitro|free[\s_-]*nitro|steam[\s_-]*gift|airdrop|crypto|support[\s_-]*team|moderator[\s_-]*team|admin[\s_-]*team)/i.test(value)
        || /[a-z0-9]{18,}/i.test(value)
}

function assessJoinRisk(member, config, incidentMode) {
    const raid = config.antiRaid
    const accountAgeHours = Math.floor((Date.now() - member.user.createdTimestamp) / 3_600_000)
    let score = 0
    const signals = []
    if (accountAgeHours < raid.minAccountAgeHours) { score += 2; signals.push(`account age ${accountAgeHours}h`) }
    if (raid.requireAvatar && !member.user.avatar) { score += 1; signals.push("no custom avatar") }
    if (raid.suspiciousNameCheck && suspiciousUsername(member.user.username)) { score += 2; signals.push("suspicious username") }
    if (incidentMode.active) { score += 2; signals.push("incident mode active") }
    return { score, signals, accountAgeHours }
}

async function processAdvancedJoin(member) {
    if (!member?.guild || member.user?.bot) return false
    const guild = member.guild
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.antiRaid.enabled) return false
    if (isTrustedForScope({ guildId: guild.id, member, userId: member.id, isBot: false, scope: "antiRaid" })) return false

    const mode = await getIncidentModeState(guild.id)
    const windowMs = config.antiRaid.windowSeconds * 1000
    const times = (joinWindows.get(guild.id) || []).filter(timestamp => timestamp > Date.now() - windowMs)
    times.push(Date.now())
    joinWindows.set(guild.id, times)

    const thresholdReached = times.length >= config.antiRaid.joinThreshold
    const risk = assessJoinRisk(member, config, mode)

    // Young or unusual accounts are not quarantined during normal traffic.
    // Join Gate only becomes active during a real burst or an explicit incident.
    if (!thresholdReached && !mode.active) return false
    if (!thresholdReached && risk.score < config.antiRaid.riskScoreThreshold) return false

    const result = await quarantineMember(guild, member, config, {
        reason: `Advanced anti-raid verification: ${risk.signals.join(", ") || `${times.length} joins`}`,
        moderator: { id: guild.members.me?.id, tag: "CURSED Join Gate" },
    }).catch(err => ({ ok: false, error: err.message }))

    await createSecurityIncident({
        guildId: guild.id,
        type: "ADVANCED_ANTI_RAID",
        severity: thresholdReached || mode.active ? "critical" : "high",
        executorId: null,
        executorTag: "CURSED Join Gate",
        targetId: member.id,
        targetTag: member.user.tag || member.user.username,
        actionTaken: result.ok ? "quarantine" : "alert",
        details: {
            summary: `Join Gate risk score ${risk.score}; ${times.length} joins in ${config.antiRaid.windowSeconds}s.`,
            ...risk,
            joins: times.length,
            thresholdReached,
            incidentMode: mode.active,
            response: result,
        },
    })
    return result.ok
}

async function latestAuditExecutor(guild, type, targetId) {
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 6 })
        const entry = [...logs.entries.values()]
            .filter(item => Date.now() - item.createdTimestamp < 20_000)
            .find(item => !targetId || String(item.targetId || item.target?.id || "") === String(targetId))
        return entry?.executor || null
    } catch {
        return null
    }
}

async function recordTamper(guild, config, type, summary, executor = null) {
    if (executor?.id === guild.ownerId || executor?.id === guild.members.me?.id) return false
    if (executor?.id && isTrustedForScope({ guildId: guild.id, userId: executor.id, isBot: executor.bot, scope: "tamperProtection" })) return false

    await createSecurityIncident({
        guildId: guild.id,
        type,
        severity: "critical",
        executorId: executor?.id || null,
        executorTag: executor?.tag || executor?.username || "Unknown executor",
        targetId: guild.members.me?.id || guild.id,
        targetTag: "CURSED protection state",
        actionTaken: "owner alerted",
        details: { summary },
    })
    await notifyOwner(guild, {
        content: `🚨 **CURSED security tamper warning**\n${summary}\nReview the Server Protection dashboard and Discord Audit Log immediately.`,
        allowedMentions: { parse: [] },
    })
    if (config.tamperProtection.autoIncidentMode) {
        await setIncidentMode(guild, true, config, {
            reason: summary,
            actor: { id: guild.members.me?.id, tag: "CURSED Tamper Protection" },
        }).catch(() => {})
    }
    return true
}

function attachSecurityRecoveryListeners(client) {
    if (attached || !client) return
    attached = true

    client.on(Events.GuildMemberAdd, member => {
        processAdvancedJoin(member).catch(err => console.error("Advanced anti-raid error:", err.message))
    })

    client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
        const guild = newRole.guild
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled) return
        const me = guild.members.me
        const botRoleProtected = config.tamperProtection.protectBotRole && newRole.id === me?.roles.highest.id
        const quarantineProtected = config.tamperProtection.protectQuarantineRole && newRole.id === config.quarantine.roleId
        if (!botRoleProtected && !quarantineProtected) return
        const changed = oldRole.permissions.bitfield !== newRole.permissions.bitfield
            || oldRole.position !== newRole.position
            || oldRole.name !== newRole.name
        if (!changed) return
        const executor = await latestAuditExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id)
        await recordTamper(guild, config, "SECURITY_ROLE_TAMPER", `Protected role **${newRole.name}** was modified.`, executor)
    })

    client.on(Events.GuildRoleDelete, async role => {
        const guild = role.guild
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled || !config.tamperProtection.protectQuarantineRole || role.id !== config.quarantine.roleId) return
        const executor = await latestAuditExecutor(guild, AuditLogEvent.RoleDelete, role.id)
        await recordTamper(guild, config, "QUARANTINE_ROLE_DELETED", `The configured quarantine role **${role.name}** was deleted.`, executor)
    })

    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const guild = newMember.guild
        if (newMember.id !== guild.members.me?.id) return
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled || !config.tamperProtection.protectBotRole) return
        const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))
        if (!removed.size) return
        const executor = await latestAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id)
        await recordTamper(guild, config, "CURSED_ROLE_REMOVED", `CURSED lost ${removed.size} role(s). Protection permissions may have been reduced.`, executor)
    })
}

module.exports = {
    attachSecurityRecoveryListeners,
    processAdvancedJoin,
    assessJoinRisk,
    suspiciousUsername,
}