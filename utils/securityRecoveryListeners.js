const {
    AuditLogEvent,
    Events,
} = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { createSecurityIncident } = require("./securityIncidents")
const { quarantineMember } = require("./quarantineState")
const { notifyOwner, neutralizeExecutor } = require("./securityResponse")
const { getIncidentModeState, setIncidentMode } = require("./securityRecoverySuite")
const { fetchMatchingAuditEntry } = require("./securityProtection")

const joinWindows = new Map()
const roleRecoveryExpectations = new Map()
const ROLE_RECOVERY_EXPECTATION_TTL_MS = 10_000
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
    const entry = await fetchMatchingAuditEntry(guild, type, targetId).catch(() => null)
    return entry?.executor || null
}

function roleStateFingerprint(role, positionOverride = null) {
    if (!role) return ""
    const position = positionOverride === null ? Number(role.position || 0) : Number(positionOverride || 0)
    return JSON.stringify({
        name: String(role.name || ""),
        color: Number(role.color || 0),
        hoist: Boolean(role.hoist),
        permissions: String(role.permissions?.bitfield ?? "0"),
        mentionable: Boolean(role.mentionable),
        unicodeEmoji: role.unicodeEmoji || null,
        position,
    })
}

function rememberRoleRecoveryExpectation(role, positionOverride = null) {
    if (!role?.guild?.id || !role.id) return
    const key = `${role.guild.id}:${role.id}`
    const expectations = roleRecoveryExpectations.get(key) || []
    expectations.push({
        fingerprint: roleStateFingerprint(role, positionOverride),
        expiresAt: Date.now() + ROLE_RECOVERY_EXPECTATION_TTL_MS,
    })
    roleRecoveryExpectations.set(key, expectations.slice(-4))
}

function consumeExpectedRoleRecovery(role) {
    if (!role?.guild?.id || !role.id) return false
    const key = `${role.guild.id}:${role.id}`
    const currentTime = Date.now()
    const expectations = (roleRecoveryExpectations.get(key) || []).filter(item => item.expiresAt > currentTime)
    const fingerprint = roleStateFingerprint(role)
    const index = expectations.findIndex(item => item.fingerprint === fingerprint)
    if (index === -1) {
        if (expectations.length) roleRecoveryExpectations.set(key, expectations)
        else roleRecoveryExpectations.delete(key)
        return false
    }
    expectations.splice(index, 1)
    if (expectations.length) roleRecoveryExpectations.set(key, expectations)
    else roleRecoveryExpectations.delete(key)
    return true
}

async function isTamperExecutorExempt(guild, executor) {
    if (!executor?.id) return false
    if (executor.id === guild.ownerId || executor.id === guild.members.me?.id) return true
    const executorMember = guild.members.cache.get(executor.id)
        || await guild.members.fetch(executor.id).catch(() => null)
    return isTrustedForScope({
        guildId: guild.id,
        member: executorMember,
        userId: executor.id,
        isBot: executor.bot,
        scope: "tamperProtection",
    })
}

async function restoreProtectedRole(oldRole, newRole) {
    if (!oldRole || !newRole || newRole.managed || !newRole.editable) return { ok: false, restored: false }
    const errors = []
    try {
        // Role.edit does not change position. Record the exact intermediate state
        // so the resulting gateway event is recognized as CURSED's own rollback.
        rememberRoleRecoveryExpectation(oldRole, newRole.position)
        await newRole.edit({
            name: oldRole.name,
            color: oldRole.color,
            hoist: oldRole.hoist,
            permissions: oldRole.permissions.bitfield,
            mentionable: oldRole.mentionable,
            unicodeEmoji: oldRole.unicodeEmoji || undefined,
        }, "CURSED tamper protection: restore protected role")
    } catch (err) {
        errors.push(err.message)
    }
    if (oldRole.position !== newRole.position) {
        try {
            const highestSafePosition = Math.max(1, newRole.guild.members.me.roles.highest.position - 1)
            const restoredPosition = Math.min(oldRole.position, highestSafePosition)
            rememberRoleRecoveryExpectation(oldRole, restoredPosition)
            await newRole.setPosition(restoredPosition, "CURSED tamper protection: restore role position")
        } catch (err) {
            errors.push(err.message)
        }
    }
    return { ok: errors.length === 0, restored: errors.length === 0, errors }
}

async function restoreRemovedBotRoles(oldMember, newMember) {
    const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))
    const restorable = [...removed.values()].filter(role => role.id !== newMember.guild.id && !role.managed && role.editable)
    if (!restorable.length) return { removedCount: removed.size, restoredRoleIds: [], errors: [] }

    const restoredRoleIds = []
    const errors = []
    for (const role of restorable) {
        try {
            await newMember.roles.add(role.id, "CURSED tamper protection: restore removed bot role")
            restoredRoleIds.push(role.id)
        } catch (err) {
            errors.push(`${role.id}: ${err.message}`)
        }
    }
    return { removedCount: removed.size, restoredRoleIds, errors }
}

async function recordTamper(guild, config, type, summary, executor = null, details = {}) {
    // Defense-in-depth: callers must check exemptions before mutating state, and
    // the recorder repeats the check so trusted actions can never be punished.
    if (await isTamperExecutorExempt(guild, executor)) return false
    const executorMember = executor?.id
        ? guild.members.cache.get(executor.id) || await guild.members.fetch(executor.id).catch(() => null)
        : null

    let neutralization = null
    if (executorMember && config.antiNuke?.enabled && config.antiNuke?.action === "neutralize") {
        neutralization = await neutralizeExecutor(guild, executorMember, config, {
            reason: `CURSED tamper protection: ${summary}`,
            actor: { id: guild.members.me?.id, tag: "CURSED Tamper Protection" },
        }).catch(err => ({ ok: false, error: err.message }))
    }

    const actionTaken = neutralization?.ok ? "neutralized + owner alerted" : "owner alerted"
    await createSecurityIncident({
        guildId: guild.id,
        type,
        severity: "critical",
        executorId: executor?.id || null,
        executorTag: executor?.tag || executor?.username || "Unknown executor",
        targetId: guild.members.me?.id || guild.id,
        targetTag: "CURSED protection state",
        actionTaken,
        details: { summary, neutralization, ...details },
    }).catch(() => null)
    await notifyOwner(
        guild,
        `🚨 CURSED security tamper warning in **${guild.name}**. ${summary} Response: ${actionTaken}. Review the Security dashboard and Discord Audit Log.`
    ).catch(() => false)
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

        // Ignore only the exact role state CURSED expected from its own rollback.
        // Unrelated attacker changes during the same time window are still handled.
        if (consumeExpectedRoleRecovery(newRole)) return

        const executor = await latestAuditExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id)
        if (await isTamperExecutorExempt(guild, executor)) return

        const rollback = quarantineProtected
            ? await restoreProtectedRole(oldRole, newRole)
            : { ok: false, restored: false }
        const suffix = rollback.restored ? " The role was restored automatically." : ""
        await recordTamper(
            guild,
            config,
            "SECURITY_ROLE_TAMPER",
            `Protected role **${newRole.name}** was modified.${suffix}`,
            executor,
            { rollback }
        )
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
        if (await isTamperExecutorExempt(guild, executor)) return

        const recovery = await restoreRemovedBotRoles(oldMember, newMember)
        const restoredText = recovery.restoredRoleIds.length
            ? ` Restored ${recovery.restoredRoleIds.length} manageable role(s).`
            : ""
        await recordTamper(
            guild,
            config,
            "CURSED_ROLE_REMOVED",
            `CURSED lost ${removed.size} role(s).${restoredText} Protection permissions may have been reduced.`,
            executor,
            { recovery }
        )
    })
}

module.exports = {
    attachSecurityRecoveryListeners,
    processAdvancedJoin,
    assessJoinRisk,
    suspiciousUsername,
    latestAuditExecutor,
    isTamperExecutorExempt,
    roleStateFingerprint,
    rememberRoleRecoveryExpectation,
    consumeExpectedRoleRecovery,
    restoreProtectedRole,
    restoreRemovedBotRoles,
}
