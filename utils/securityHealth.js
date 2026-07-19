const mongoose = require("mongoose")
const { PermissionFlagsBits } = require("discord.js")
const { getSecurityPhase3Config } = require("./securityPhase3Config")
const { getFortressConfig } = require("./fortressConfig")

const REQUIRED_PERMISSIONS = Object.freeze([
    ["ViewAuditLog", PermissionFlagsBits.ViewAuditLog, "View Audit Log"],
    ["ManageRoles", PermissionFlagsBits.ManageRoles, "Manage Roles"],
    ["ManageChannels", PermissionFlagsBits.ManageChannels, "Manage Channels"],
    ["ModerateMembers", PermissionFlagsBits.ModerateMembers, "Moderate Members"],
    ["KickMembers", PermissionFlagsBits.KickMembers, "Kick Members"],
    ["BanMembers", PermissionFlagsBits.BanMembers, "Ban Members"],
    ["ManageWebhooks", PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"],
    ["ManageGuild", PermissionFlagsBits.ManageGuild, "Manage Server"],
])

function issue(code, severity, title, detail, fix) {
    return { code, severity, title, detail, fix }
}

function readinessScore(issues) {
    const penalty = issues.reduce((sum, item) => {
        if (item.severity === "critical") return sum + 30
        if (item.severity === "high") return sum + 18
        if (item.severity === "medium") return sum + 10
        return sum + 4
    }, 0)
    return Math.max(0, Math.min(100, 100 - penalty))
}

async function evaluateSecurityHealth(guild) {
    if (!guild) return { available: false, score: 0, status: "unavailable", issues: [] }
    const security = getSecurityPhase3Config(guild.id)
    const fortress = getFortressConfig(guild.id)
    const me = guild.members.me
    const issues = []
    const permissions = {}

    if (!me) {
        issues.push(issue("BOT_MEMBER_MISSING", "critical", "CURSED member unavailable", "Discord did not provide the bot member object.", "Restart the bot and confirm it is still in the server."))
    } else {
        for (const [key, permission, label] of REQUIRED_PERMISSIONS) {
            const present = me.permissions.has(permission)
            permissions[key] = present
            if (!present) {
                const critical = ["ViewAuditLog", "ManageRoles", "ManageChannels"].includes(key)
                issues.push(issue(
                    `MISSING_${key.toUpperCase()}`,
                    critical ? "critical" : "high",
                    `Missing ${label}`,
                    `CURSED cannot fully detect, contain, or recover from attacks without ${label}.`,
                    `Grant ${label} to CURSED through a dedicated role.`
                ))
            }
        }

        const dangerousRolesAbove = guild.roles.cache
            .filter(role => !role.managed && role.id !== guild.id && role.position >= me.roles.highest.position)
            .filter(role => role.permissions.has(PermissionFlagsBits.Administrator)
                || role.permissions.has(PermissionFlagsBits.ManageGuild)
                || role.permissions.has(PermissionFlagsBits.ManageRoles)
                || role.permissions.has(PermissionFlagsBits.ManageChannels))
            .map(role => ({ id: role.id, name: role.name, position: role.position }))
        if (dangerousRolesAbove.length) {
            issues.push(issue(
                "DANGEROUS_ROLES_ABOVE_BOT",
                "critical",
                "Dangerous roles are above CURSED",
                `${dangerousRolesAbove.length} role(s) with destructive permissions cannot be neutralized by CURSED.`,
                "Move CURSED's protection role above every staff and bot role that it must be able to contain."
            ))
        }
    }

    if (!security.enabled) {
        issues.push(issue("PROTECTION_DISABLED", "critical", "Server Protection is disabled", "Detection listeners remain attached, but destructive actions are not processed for this server.", "Enable Server Protection in the dashboard."))
    }
    if (!security.antiNuke.enabled) {
        issues.push(issue("ANTI_NUKE_DISABLED", "critical", "Anti-nuke is disabled", "Destructive audit-log events will not trigger containment or rollback.", "Enable Anti-nuke."))
    }
    if (!fortress.enabled) {
        issues.push(issue("FORTRESS_DISABLED", "high", "Fortress layer is disabled", "Cross-action heat, recovery, panic mode, snapshots, and advanced containment are inactive.", "Enable Fortress mode."))
    }
    if (!security.securityLogChannelId || !guild.channels.cache.get(security.securityLogChannelId)?.isTextBased?.()) {
        issues.push(issue("SECURITY_LOG_MISSING", "high", "Security log channel is not configured", "Critical incidents may only be stored in MongoDB and owner DMs.", "Choose a private security log channel."))
    }

    const quarantineRole = security.quarantine.roleId ? guild.roles.cache.get(security.quarantine.roleId) : null
    if (security.quarantine.enabled) {
        if (!quarantineRole || quarantineRole.managed) {
            issues.push(issue("QUARANTINE_ROLE_INVALID", "critical", "Quarantine role is invalid", "Automatic quarantine cannot be applied.", "Create and select a dedicated quarantine role."))
        } else if (!quarantineRole.editable) {
            issues.push(issue("QUARANTINE_ROLE_UNMANAGEABLE", "critical", "Quarantine role is above CURSED", "CURSED cannot assign the quarantine role.", "Move the quarantine role below CURSED's highest role."))
        }
    }

    if (!security.lockdown.enabled) {
        issues.push(issue("LOCKDOWN_DISABLED", "high", "Emergency lockdown is disabled", "Panic mode cannot seal public channels.", "Enable Emergency Lockdown."))
    }
    if (security.lockdown.enabled) {
        const configured = security.lockdown.channelIds || []
        const available = [...guild.channels.cache.values()].filter(channel => channel.isTextBased?.() && !channel.isThread?.()).length
        if (configured.length === 0 && available === 0) {
            issues.push(issue("NO_LOCKDOWN_CHANNELS", "high", "No channels can be locked", "No manageable public text channels were found.", "Give CURSED Manage Channels and configure lockdown channels."))
        }
    }

    if (mongoose.connection.readyState !== 1) {
        issues.push(issue("MONGO_UNAVAILABLE", "critical", "MongoDB is unavailable", "Quarantine state, lockdown restoration, incidents, cases and snapshots cannot be persisted safely.", "Restore the MONGO_URI connection before relying on automated protection."))
    }

    if (security.antiNuke.action === "alert" && fortress.response.neutralizeFirst !== true) {
        issues.push(issue("ALERT_ONLY_RESPONSE", "high", "Protection is alert-only", "CURSED can report a nuke without stopping the executor.", "Use Fortress neutralization and configure containment fallbacks."))
    }
    if (!fortress.rollback.enabled) {
        issues.push(issue("ROLLBACK_DISABLED", "high", "Automatic rollback is disabled", "Deleted or modified server structure will not be restored automatically.", "Enable rollback after testing snapshots in a private server."))
    }
    if (!fortress.backups.enabled) {
        issues.push(issue("BACKUPS_DISABLED", "medium", "Structural snapshots are disabled", "Recovery is limited to event-time objects and cannot use historical server structure.", "Enable periodic structural snapshots."))
    }

    const score = readinessScore(issues)
    return {
        available: true,
        score,
        status: score >= 90 ? "ready" : score >= 70 ? "warning" : score >= 40 ? "unsafe" : "critical",
        issues,
        permissions,
        botHighestRolePosition: me?.roles?.highest?.position || 0,
        config: {
            protectionEnabled: security.enabled,
            antiNukeEnabled: security.antiNuke.enabled,
            antiRaidEnabled: security.antiRaid.enabled,
            fortressEnabled: fortress.enabled,
            rollbackEnabled: fortress.rollback.enabled,
            backupsEnabled: fortress.backups.enabled,
            automodHeatEnabled: fortress.automod.enabled,
        },
    }
}

module.exports = {
    REQUIRED_PERMISSIONS,
    evaluateSecurityHealth,
    readinessScore,
}
