const {
    AuditLogEvent,
    Events,
    PermissionFlagsBits,
} = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { createSecurityIncident } = require("./securityIncidents")
const { notifyOwner, neutralizeExecutor } = require("./securityResponse")
const { setIncidentMode } = require("./securityRecoverySuite")
const { fetchMatchingAuditEntry } = require("./securityProtection")

const roleRecoveryExpectations = new Map()
const ROLE_RECOVERY_EXPECTATION_TTL_MS = 10_000
const BOT_PROTECTION_PERMISSIONS = Object.freeze([
    PermissionFlagsBits.ViewAuditLog,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
])
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

// Backward-compatible export for tests/older callers. The live GuildMemberAdd
// pipeline is intentionally owned by securityProtection.processJoin so a member
// can never be evaluated or punished by two independent anti-raid windows.
async function processAdvancedJoin(member) {
    const { processJoin } = require("./securityProtection")
    return processJoin(member)
}

async function latestAuditExecutor(guild, type, targetId, observedAt = Date.now()) {
    const entry = await fetchMatchingAuditEntry(guild, type, targetId, undefined, { observedAt }).catch(() => null)
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

function isBotProtectionRole(member, role) {
    if (!member || !role || role.id === member.guild?.id || !member.roles?.cache?.has(role.id)) return false
    return BOT_PROTECTION_PERMISSIONS.some(permission => role.permissions?.has(permission))
}

async function restoreRemovedBotRoles(oldMember, newMember, rolesToRestore = null) {
    const removed = rolesToRestore || oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))
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

    // GuildMemberAdd is deliberately NOT registered here. securityProtection
    // owns the single anti-raid join pipeline and processAdvancedJoin delegates
    // to it for backward compatibility.

    client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
        const observedAt = Date.now()
        const guild = newRole.guild
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled) return
        const me = guild.members.me
        const botRoleProtected = config.tamperProtection.protectBotRole
            && (isBotProtectionRole(me, oldRole) || isBotProtectionRole(me, newRole))
        const quarantineProtected = config.tamperProtection.protectQuarantineRole && newRole.id === config.quarantine.roleId
        if (!botRoleProtected && !quarantineProtected) return
        if (roleStateFingerprint(oldRole) === roleStateFingerprint(newRole)) return

        // Ignore only the exact role state CURSED expected from its own rollback.
        // Unrelated attacker changes during the same time window are still handled.
        if (consumeExpectedRoleRecovery(newRole)) return

        const executor = await latestAuditExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id, observedAt)
        if (await isTamperExecutorExempt(guild, executor)) return

        const rollback = await restoreProtectedRole(oldRole, newRole)
        const suffix = rollback.restored ? " The role was restored automatically." : ""
        await recordTamper(
            guild,
            config,
            botRoleProtected ? "CURSED_ROLE_TAMPER" : "SECURITY_ROLE_TAMPER",
            `Protected role **${newRole.name}** was modified.${suffix}`,
            executor,
            { rollback }
        )
    })

    client.on(Events.GuildRoleDelete, async role => {
        const observedAt = Date.now()
        const guild = role.guild
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled || !config.tamperProtection.protectQuarantineRole || role.id !== config.quarantine.roleId) return
        const executor = await latestAuditExecutor(guild, AuditLogEvent.RoleDelete, role.id, observedAt)
        if (await isTamperExecutorExempt(guild, executor)) return
        await recordTamper(guild, config, "QUARANTINE_ROLE_DELETED", `The configured quarantine role **${role.name}** was deleted.`, executor)
    })

    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const observedAt = Date.now()
        const guild = newMember.guild
        if (newMember.id !== guild.members.me?.id) return
        const config = getSecurityPhase3Config(guild.id)
        if (!config.enabled || !config.tamperProtection.enabled || !config.tamperProtection.protectBotRole) return
        const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id))
        const protectedRemoved = removed.filter(role => isBotProtectionRole(oldMember, role))
        if (!protectedRemoved.size) return

        const executor = await latestAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id, observedAt)
        if (await isTamperExecutorExempt(guild, executor)) return

        const recovery = await restoreRemovedBotRoles(oldMember, newMember, protectedRemoved)
        const restoredText = recovery.restoredRoleIds.length
            ? ` Restored ${recovery.restoredRoleIds.length} critical protection role(s).`
            : ""
        await recordTamper(
            guild,
            config,
            "CURSED_ROLE_REMOVED",
            `CURSED lost ${protectedRemoved.size} critical protection role(s).${restoredText} Protection permissions may have been reduced.`,
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
    isBotProtectionRole,
}
