const mongoose = require("mongoose")
const {
    Events,
    PermissionFlagsBits,
} = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { createSecurityIncident } = require("./securityIncidents")
const { notifyOwner } = require("./securityResponse")
const {
    getIncidentModeState,
    listBotApprovals,
    setIncidentMode,
} = require("./securityRecoverySuite")
const { removeUnauthorizedAddedBot } = require("./securityProtection")

const REQUIRED_PROTECTION_PERMISSIONS = Object.freeze([
    ["View Audit Log", PermissionFlagsBits.ViewAuditLog],
    ["Manage Roles", PermissionFlagsBits.ManageRoles],
    ["Manage Channels", PermissionFlagsBits.ManageChannels],
    ["Manage Webhooks", PermissionFlagsBits.ManageWebhooks],
    ["Moderate Members", PermissionFlagsBits.ModerateMembers],
    ["Kick Members", PermissionFlagsBits.KickMembers],
    ["Ban Members", PermissionFlagsBits.BanMembers],
])

const permissionFingerprints = new Map()
const alertCooldowns = new Map()
let attached = false
let schedulerStarted = false

function now() {
    return Date.now()
}

function permissionSnapshot(guild) {
    const me = guild?.members?.me
    const permissions = REQUIRED_PROTECTION_PERMISSIONS.map(([name, permission]) => ({
        name,
        ready: me?.permissions?.has(permission) === true,
    }))
    return {
        ready: Boolean(me) && permissions.every(item => item.ready),
        missing: permissions.filter(item => !item.ready).map(item => item.name),
        permissions,
        botHighestRolePosition: me?.roles?.highest?.position || 0,
    }
}

function permissionFingerprint(snapshot) {
    return [...(snapshot?.missing || [])].sort().join("|") || "healthy"
}

function shouldAlert(key, cooldownMs = 5 * 60_000) {
    const last = alertCooldowns.get(key) || 0
    if (now() - last < cooldownMs) return false
    alertCooldowns.set(key, now())
    if (alertCooldowns.size > 2000) {
        const cutoff = now() - 24 * 60 * 60_000
        for (const [entryKey, timestamp] of alertCooldowns) {
            if (timestamp < cutoff) alertCooldowns.delete(entryKey)
        }
    }
    return true
}

function dangerousRolesAtOrAboveBot(guild) {
    const me = guild?.members?.me
    if (!me) return []
    const botRoleId = me.roles.highest?.id
    const botPosition = me.roles.highest?.position || 0
    return [...guild.roles.cache.values()].filter(role => (
        role.id !== guild.id
        && role.id !== botRoleId
        && role.position >= botPosition
        && (
            role.permissions.has(PermissionFlagsBits.Administrator)
            || role.permissions.has(PermissionFlagsBits.ManageRoles)
            || role.permissions.has(PermissionFlagsBits.ManageChannels)
            || role.permissions.has(PermissionFlagsBits.BanMembers)
        )
    ))
}

async function safeIncident(guild, input) {
    try {
        return await createSecurityIncident({ guildId: guild.id, ...input })
    } catch (err) {
        console.error(`[SecurityRuntime] Incident persistence failed: ${err.message}`)
        return null
    }
}

async function safeOwnerAlert(guild, message) {
    try {
        return await notifyOwner(guild, message)
    } catch (err) {
        console.error(`[SecurityRuntime] Owner alert failed: ${err.message}`)
        return false
    }
}

async function activateIncidentMode(guild, config, reason) {
    if (!config?.incidentMode?.enabled && !config?.tamperProtection?.autoIncidentMode) return null
    return setIncidentMode(guild, true, config, {
        reason,
        actor: { id: guild.members.me?.id, tag: "CURSED Security Watchdog" },
        durationMinutes: config.incidentMode?.durationMinutes,
    }).catch(err => {
        console.error(`[SecurityRuntime] Incident mode activation failed: ${err.message}`)
        return null
    })
}

async function reportPermissionDegradation(guild, config, snapshot, previousFingerprint) {
    const missingText = snapshot.missing.join(", ")
    const summary = `CURSED protection permissions are degraded. Missing: ${missingText}.`
    const isRegression = previousFingerprint === "healthy"
    const mode = isRegression ? await activateIncidentMode(guild, config, summary) : null

    await safeIncident(guild, {
        type: "SECURITY_PERMISSION_DEGRADED",
        severity: "critical",
        executorId: null,
        executorTag: "Permission watchdog",
        targetId: guild.members.me?.id || null,
        targetTag: "CURSED",
        actionTaken: mode?.ok ? "owner alerted + incident mode" : "owner alerted",
        details: {
            summary,
            missingPermissions: snapshot.missing,
            regression: isRegression,
        },
    })
    await safeOwnerAlert(
        guild,
        `🚨 CURSED protection permissions changed in **${guild.name}**. Missing: **${missingText}**. Anti-nuke coverage may be reduced until the permissions/role hierarchy are restored.`
    )
}

async function runGuildSecurityWatchdog(guild) {
    if (!guild?.members?.me) return { ok: false, reason: "bot member unavailable" }
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled) {
        permissionFingerprints.delete(guild.id)
        return { ok: true, skipped: "protection disabled" }
    }

    const snapshot = permissionSnapshot(guild)
    const fingerprint = permissionFingerprint(snapshot)
    const previous = permissionFingerprints.get(guild.id)
    permissionFingerprints.set(guild.id, fingerprint)

    if (!snapshot.ready && (fingerprint !== previous || shouldAlert(`${guild.id}:permissions:${fingerprint}`, 10 * 60_000))) {
        await reportPermissionDegradation(guild, config, snapshot, previous)
    }

    const dangerousRoles = dangerousRolesAtOrAboveBot(guild)
    if (dangerousRoles.length && shouldAlert(`${guild.id}:hierarchy`, 30 * 60_000)) {
        const summary = `${dangerousRoles.length} dangerous role(s) are equal to or above CURSED's highest role.`
        await safeIncident(guild, {
            type: "SECURITY_ROLE_HIERARCHY_RISK",
            severity: "high",
            executorId: null,
            executorTag: "Permission watchdog",
            targetId: guild.members.me.id,
            targetTag: "CURSED",
            actionTaken: "owner alerted",
            details: {
                summary,
                roles: dangerousRoles.slice(0, 25).map(role => ({ id: role.id, name: role.name, position: role.position })),
            },
        })
        await safeOwnerAlert(guild, `⚠️ ${summary} Those roles can limit CURSED's ability to neutralize an attacker.`)
    }

    const persistentSecurityNeedsMongo = config.backup?.enabled
        || config.botApprovals?.enabled
        || config.incidentMode?.enabled
    if (persistentSecurityNeedsMongo && mongoose.connection.readyState !== 1 && shouldAlert(`${guild.id}:mongo`, 15 * 60_000)) {
        const summary = "MongoDB is unavailable while persistent security features are enabled."
        await safeIncident(guild, {
            type: "SECURITY_DATABASE_UNAVAILABLE",
            severity: "high",
            executorId: null,
            executorTag: "Security watchdog",
            targetId: guild.id,
            targetTag: guild.name,
            actionTaken: "owner alerted",
            details: { summary, mongoReadyState: mongoose.connection.readyState },
        })
        await safeOwnerAlert(guild, `⚠️ ${summary} Existing in-memory protection continues where possible, but approvals, incident state, and snapshots may be unavailable.`)
    }

    return { ok: true, snapshot, dangerousRoleCount: dangerousRoles.length }
}

function recentOrActiveApproval(approvals, botId, currentTime = now()) {
    return (Array.isArray(approvals) ? approvals : []).some(approval => {
        if (String(approval.botId) !== String(botId)) return false
        if (approval.active === true) return true
        if (!approval.usedAt) return false
        const usedAt = new Date(approval.usedAt).getTime()
        return Number.isFinite(usedAt) && currentTime - usedAt <= 60_000
    })
}

async function enforceIncidentBotGate(member) {
    if (!member?.guild || !member.user?.bot || member.id === member.guild.members.me?.id) return false
    const guild = member.guild
    const config = getSecurityPhase3Config(guild.id)
    if (!config.enabled || !config.incidentMode?.blockUnapprovedBots) return false

    const mode = await getIncidentModeState(guild.id).catch(() => ({ active: false }))
    if (!mode.active) return false

    const current = guild.members.cache.get(member.id) || await guild.members.fetch(member.id).catch(() => null)
    if (!current) return true
    if (isTrustedForScope({
        guildId: guild.id,
        member: current,
        userId: current.id,
        isBot: true,
        scope: "addBots",
    })) return false

    const approvals = await listBotApprovals(guild.id, 50).catch(() => [])
    if (recentOrActiveApproval(approvals, current.id)) return false

    const removal = await removeUnauthorizedAddedBot(current, "CURSED incident mode: unapproved bot blocked")
    const summary = `Incident mode blocked unapproved bot ${current.user?.tag || current.user?.username || current.id}.`
    await safeIncident(guild, {
        type: "INCIDENT_MODE_UNAPPROVED_BOT_BLOCKED",
        severity: "critical",
        executorId: null,
        executorTag: "Unknown/late audit attribution",
        targetId: current.id,
        targetTag: current.user?.tag || current.user?.username || current.id,
        actionTaken: removal.action || (removal.ok ? "removed" : "alert"),
        details: { summary, removal },
    })
    await safeOwnerAlert(guild, `🚨 ${summary} Response: ${removal.action || "unknown"}.`)
    return removal.ok === true
}

function runtimeSecurityWarnings(env = process.env) {
    const warnings = []
    if (env.NODE_ENV === "production" && !env.MONGO_URI) {
        warnings.push("MONGO_URI is missing in production; persistent security state cannot be guaranteed.")
    }
    if (env.NODE_ENV === "production" && !env.DASHBOARD_API_SECRET) {
        warnings.push("DASHBOARD_API_SECRET is missing; private dashboard API routes should remain unavailable.")
    }
    for (const key of ["KOFI_WEBHOOK_SECRET", "PATREON_WEBHOOK_SECRET", "BMC_WEBHOOK_SECRET"]) {
        if (!env[key]) warnings.push(`${key} is missing; that payment webhook will fail closed.`)
    }
    return warnings
}

function logRuntimeSecurityPosture() {
    const warnings = runtimeSecurityWarnings()
    if (!warnings.length) {
        console.log("[SecurityRuntime] Security environment checks passed")
        return
    }
    for (const warning of warnings) console.warn(`[SecurityRuntime] ${warning}`)
}

async function runAllGuildWatchdogs(client) {
    if (!client?.isReady()) return
    for (const guild of client.guilds.cache.values()) {
        await runGuildSecurityWatchdog(guild).catch(err => {
            console.error(`[SecurityRuntime] Watchdog failed for ${guild.id}: ${err.message}`)
        })
    }
}

function attachRuntimeListeners(client) {
    if (attached || !client) return
    attached = true

    client.on(Events.GuildMemberAdd, member => {
        if (!member.user?.bot) return
        const timer = setTimeout(() => {
            enforceIncidentBotGate(member).catch(err => console.error(`[SecurityRuntime] Incident bot gate failed: ${err.message}`))
        }, 3500)
        timer.unref?.()
    })

    client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
        if (newMember.id !== newMember.guild.members.me?.id) return
        runGuildSecurityWatchdog(newMember.guild).catch(() => {})
    })

    client.on(Events.GuildRoleUpdate, (_oldRole, newRole) => {
        const me = newRole.guild.members.me
        if (!me?.roles?.cache?.has(newRole.id)) return
        runGuildSecurityWatchdog(newRole.guild).catch(() => {})
    })

    client.on(Events.GuildRoleDelete, role => {
        runGuildSecurityWatchdog(role.guild).catch(() => {})
    })

    client.on(Events.GuildCreate, guild => {
        runGuildSecurityWatchdog(guild).catch(() => {})
    })
}

function startSecurityRuntimeHardening(client) {
    if (!client) return
    attachRuntimeListeners(client)
    logRuntimeSecurityPosture()
    if (schedulerStarted) return
    schedulerStarted = true

    const initial = setTimeout(() => runAllGuildWatchdogs(client).catch(() => {}), 10_000)
    initial.unref?.()
    const timer = setInterval(() => runAllGuildWatchdogs(client).catch(() => {}), 60_000)
    timer.unref?.()
}

module.exports = {
    REQUIRED_PROTECTION_PERMISSIONS,
    permissionSnapshot,
    permissionFingerprint,
    dangerousRolesAtOrAboveBot,
    recentOrActiveApproval,
    runtimeSecurityWarnings,
    runGuildSecurityWatchdog,
    enforceIncidentBotGate,
    startSecurityRuntimeHardening,
}
