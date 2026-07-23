const { getServerConfig } = require("./serverConfig")

const TRUSTED_SCOPES = Object.freeze([
    "automod",
    "antiRaid",
    "massModeration",
    "manageChannels",
    "manageRoles",
    "addBots",
    "manageWebhooks",
    "manualModeration",
    "tamperProtection",
    "staffLimits",
])

const TRUSTED_SUBJECT_TYPES = Object.freeze(["user", "role", "bot", "channel"])
const SECURITY_ACTIONS = Object.freeze(["alert", "quarantine", "lockdown", "neutralize"])

// Server protection is intentionally opt-in. Missing configuration must never
// grant CURSED permission to modify channels, roles, members, or server state.
const DEFAULT_SECURITY_PHASE3_CONFIG = Object.freeze({
    enabled: false,
    securityLogChannelId: null,
    antiRaid: Object.freeze({
        enabled: false,
        joinThreshold: 6,
        windowSeconds: 15,
        minAccountAgeHours: 72,
        action: "alert",
        activeRaidSeconds: 300,
        requireAvatar: false,
        suspiciousNameCheck: false,
        riskScoreThreshold: 2,
    }),
    antiNuke: Object.freeze({
        enabled: false,
        action: "alert",
        windowSeconds: 10,
        restoreDeletedChannels: false,
        restoreDeletedRoles: false,
        removeDangerousRoles: false,
        banMaliciousBots: false,
        autoLockdown: false,
        ownerAlerts: true,
        neutralizeTimeoutMinutes: 10080,
        thresholds: Object.freeze({
            bans: 3,
            kicks: 3,
            channelDeletes: 1,
            channelCreates: 3,
            channelUpdates: 3,
            roleDeletes: 1,
            roleCreates: 3,
            roleUpdates: 2,
            webhookChanges: 1,
            dangerousRoleChanges: 1,
            botAdds: 1,
            guildUpdates: 2,
        }),
    }),
    messageShield: Object.freeze({
        enabled: false,
        windowSeconds: 8,
        repeatedMessageThreshold: 3,
        rapidMessageThreshold: 5,
        botInviteThreshold: 2,
        inviteThreshold: 3,
        linkThreshold: 6,
        maxMentions: 5,
    }),
    quarantine: Object.freeze({
        enabled: false,
        roleId: null,
        channelId: null,
        removeManageableRoles: false,
    }),
    lockdown: Object.freeze({
        enabled: false,
        channelIds: [],
        raiseVerificationLevel: false,
    }),
    trusted: Object.freeze({
        enabled: false,
        entries: [],
    }),
    backup: Object.freeze({
        enabled: false,
        intervalHours: 24,
        retentionCount: 7,
        restoreServerSettings: false,
    }),
    tamperProtection: Object.freeze({
        enabled: false,
        ownerOnlyDisable: true,
        protectBotRole: false,
        protectQuarantineRole: false,
        autoIncidentMode: false,
    }),
    botApprovals: Object.freeze({
        enabled: false,
        defaultExpiryMinutes: 15,
        oneTime: true,
    }),
    incidentMode: Object.freeze({
        enabled: false,
        durationMinutes: 30,
        autoLockdown: false,
        strictMessageShield: false,
        blockUnapprovedBots: false,
    }),
    staffLimits: Object.freeze({
        enabled: false,
        windowSeconds: 60,
        action: "alert",
        thresholds: Object.freeze({
            bans: 5,
            kicks: 5,
            channelChanges: 8,
            roleChanges: 8,
            webhookChanges: 3,
        }),
    }),
    reports: Object.freeze({
        enabled: false,
        maxTimelineEvents: 100,
        includeAuditDetails: false,
    }),
})

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function uniqueStrings(value, limit = 100) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, limit)
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeAction(value, fallback = "alert") {
    return SECURITY_ACTIONS.includes(value) ? value : fallback
}

function normalizeThresholds(value) {
    const input = isRecord(value) ? value : {}
    const defaults = DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.thresholds
    return {
        bans: clampInteger(input.bans, defaults.bans, 1, 50),
        kicks: clampInteger(input.kicks, defaults.kicks, 1, 50),
        channelDeletes: clampInteger(input.channelDeletes, defaults.channelDeletes, 1, 25),
        channelCreates: clampInteger(input.channelCreates, defaults.channelCreates, 1, 50),
        channelUpdates: clampInteger(input.channelUpdates, defaults.channelUpdates, 1, 50),
        roleDeletes: clampInteger(input.roleDeletes, defaults.roleDeletes, 1, 25),
        roleCreates: clampInteger(input.roleCreates, defaults.roleCreates, 1, 50),
        roleUpdates: clampInteger(input.roleUpdates, defaults.roleUpdates, 1, 50),
        webhookChanges: clampInteger(input.webhookChanges, defaults.webhookChanges, 1, 25),
        dangerousRoleChanges: clampInteger(input.dangerousRoleChanges, defaults.dangerousRoleChanges, 1, 25),
        botAdds: clampInteger(input.botAdds, defaults.botAdds, 1, 25),
        guildUpdates: clampInteger(input.guildUpdates, defaults.guildUpdates, 1, 25),
    }
}

function normalizeMessageShield(value) {
    const input = isRecord(value) ? value : {}
    const defaults = DEFAULT_SECURITY_PHASE3_CONFIG.messageShield
    return {
        enabled: input.enabled === true,
        windowSeconds: clampInteger(input.windowSeconds, defaults.windowSeconds, 3, 60),
        repeatedMessageThreshold: clampInteger(input.repeatedMessageThreshold, defaults.repeatedMessageThreshold, 2, 15),
        rapidMessageThreshold: clampInteger(input.rapidMessageThreshold, defaults.rapidMessageThreshold, 3, 30),
        botInviteThreshold: clampInteger(input.botInviteThreshold, defaults.botInviteThreshold, 1, 10),
        inviteThreshold: clampInteger(input.inviteThreshold, defaults.inviteThreshold, 1, 20),
        linkThreshold: clampInteger(input.linkThreshold, defaults.linkThreshold, 1, 30),
        maxMentions: clampInteger(input.maxMentions, defaults.maxMentions, 2, 50),
    }
}

function normalizeTrustedEntries(value) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const entries = []
    for (const item of value) {
        if (!isRecord(item)) continue
        const subjectType = String(item.subjectType || "")
        const subjectId = String(item.subjectId || "").trim()
        if (!TRUSTED_SUBJECT_TYPES.includes(subjectType) || !/^\d{17,20}$/.test(subjectId)) continue
        const key = `${subjectType}:${subjectId}`
        if (seen.has(key)) continue
        seen.add(key)
        entries.push({
            subjectType,
            subjectId,
            scopes: uniqueStrings(item.scopes, TRUSTED_SCOPES.length).filter(scope => TRUSTED_SCOPES.includes(scope)),
        })
        if (entries.length >= 200) break
    }
    return entries
}

function normalizeSecurityPhase3Config(config = {}) {
    const hasNestedConfig = isRecord(config.securityPhase3)
    const source = hasNestedConfig ? config.securityPhase3 : config
    const suiteSource = hasNestedConfig && isRecord(config.securityRecoverySuite)
        ? config.securityRecoverySuite
        : source
    const moderationPhase2 = isRecord(config.moderationPhase2) ? config.moderationPhase2 : null
    const moderationAllowsProtection = !moderationPhase2 || moderationPhase2.advancedModerationEnabled !== false
    const antiRaid = isRecord(source.antiRaid) ? source.antiRaid : {}
    const antiRaidAdvanced = isRecord(suiteSource.antiRaidAdvanced)
        ? suiteSource.antiRaidAdvanced
        : isRecord(suiteSource.antiRaid) ? suiteSource.antiRaid : antiRaid
    const antiNuke = isRecord(source.antiNuke) ? source.antiNuke : {}
    const quarantine = isRecord(source.quarantine) ? source.quarantine : {}
    const lockdown = isRecord(source.lockdown) ? source.lockdown : {}
    const trusted = isRecord(source.trusted) ? source.trusted : {}
    const backup = isRecord(suiteSource.backup) ? suiteSource.backup : {}
    const tamperProtection = isRecord(suiteSource.tamperProtection) ? suiteSource.tamperProtection : {}
    const botApprovals = isRecord(suiteSource.botApprovals) ? suiteSource.botApprovals : {}
    const incidentMode = isRecord(suiteSource.incidentMode) ? suiteSource.incidentMode : {}
    const staffLimits = isRecord(suiteSource.staffLimits) ? suiteSource.staffLimits : {}
    const staffThresholds = isRecord(staffLimits.thresholds) ? staffLimits.thresholds : {}
    const reports = isRecord(suiteSource.reports) ? suiteSource.reports : {}

    return {
        enabled: source.enabled === true && moderationAllowsProtection,
        securityLogChannelId: source.securityLogChannelId ? String(source.securityLogChannelId) : null,
        antiRaid: {
            enabled: antiRaid.enabled === true,
            joinThreshold: clampInteger(antiRaid.joinThreshold, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.joinThreshold, 3, 100),
            windowSeconds: clampInteger(antiRaid.windowSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.windowSeconds, 5, 300),
            minAccountAgeHours: clampInteger(antiRaid.minAccountAgeHours, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.minAccountAgeHours, 0, 24 * 365),
            action: normalizeAction(antiRaid.action, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.action),
            activeRaidSeconds: clampInteger(antiRaid.activeRaidSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.activeRaidSeconds, 30, 1800),
            requireAvatar: antiRaidAdvanced.requireAvatar === true,
            suspiciousNameCheck: antiRaidAdvanced.suspiciousNameCheck === true,
            riskScoreThreshold: clampInteger(antiRaidAdvanced.riskScoreThreshold, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.riskScoreThreshold, 1, 10),
        },
        antiNuke: {
            enabled: antiNuke.enabled === true,
            action: normalizeAction(antiNuke.action, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.action),
            windowSeconds: clampInteger(antiNuke.windowSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.windowSeconds, 5, 300),
            restoreDeletedChannels: antiNuke.restoreDeletedChannels === true,
            restoreDeletedRoles: antiNuke.restoreDeletedRoles === true,
            removeDangerousRoles: antiNuke.removeDangerousRoles === true,
            banMaliciousBots: antiNuke.banMaliciousBots === true,
            autoLockdown: antiNuke.autoLockdown === true,
            ownerAlerts: antiNuke.ownerAlerts !== false,
            neutralizeTimeoutMinutes: clampInteger(antiNuke.neutralizeTimeoutMinutes, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.neutralizeTimeoutMinutes, 1, 40320),
            thresholds: normalizeThresholds(antiNuke.thresholds),
        },
        messageShield: normalizeMessageShield(source.messageShield),
        quarantine: {
            enabled: quarantine.enabled === true,
            roleId: quarantine.roleId ? String(quarantine.roleId) : null,
            channelId: quarantine.channelId ? String(quarantine.channelId) : null,
            removeManageableRoles: quarantine.removeManageableRoles === true,
        },
        lockdown: {
            enabled: lockdown.enabled === true,
            channelIds: uniqueStrings(lockdown.channelIds, 200),
            raiseVerificationLevel: lockdown.raiseVerificationLevel === true,
        },
        trusted: {
            enabled: trusted.enabled === true,
            entries: normalizeTrustedEntries(trusted.entries),
        },
        backup: {
            enabled: backup.enabled === true,
            intervalHours: clampInteger(backup.intervalHours, DEFAULT_SECURITY_PHASE3_CONFIG.backup.intervalHours, 1, 168),
            retentionCount: clampInteger(backup.retentionCount, DEFAULT_SECURITY_PHASE3_CONFIG.backup.retentionCount, 1, 30),
            restoreServerSettings: backup.restoreServerSettings === true,
        },
        tamperProtection: {
            enabled: tamperProtection.enabled === true,
            ownerOnlyDisable: tamperProtection.ownerOnlyDisable !== false,
            protectBotRole: tamperProtection.protectBotRole === true,
            protectQuarantineRole: tamperProtection.protectQuarantineRole === true,
            autoIncidentMode: tamperProtection.autoIncidentMode === true,
        },
        botApprovals: {
            enabled: botApprovals.enabled === true,
            defaultExpiryMinutes: clampInteger(botApprovals.defaultExpiryMinutes, DEFAULT_SECURITY_PHASE3_CONFIG.botApprovals.defaultExpiryMinutes, 1, 1440),
            oneTime: botApprovals.oneTime !== false,
        },
        incidentMode: {
            enabled: incidentMode.enabled === true,
            durationMinutes: clampInteger(incidentMode.durationMinutes, DEFAULT_SECURITY_PHASE3_CONFIG.incidentMode.durationMinutes, 5, 1440),
            autoLockdown: incidentMode.autoLockdown === true,
            strictMessageShield: incidentMode.strictMessageShield === true,
            blockUnapprovedBots: incidentMode.blockUnapprovedBots === true,
        },
        staffLimits: {
            enabled: staffLimits.enabled === true,
            windowSeconds: clampInteger(staffLimits.windowSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.windowSeconds, 10, 300),
            action: normalizeAction(staffLimits.action, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.action),
            thresholds: {
                bans: clampInteger(staffThresholds.bans, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.thresholds.bans, 1, 50),
                kicks: clampInteger(staffThresholds.kicks, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.thresholds.kicks, 1, 50),
                channelChanges: clampInteger(staffThresholds.channelChanges, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.thresholds.channelChanges, 1, 100),
                roleChanges: clampInteger(staffThresholds.roleChanges, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.thresholds.roleChanges, 1, 100),
                webhookChanges: clampInteger(staffThresholds.webhookChanges, DEFAULT_SECURITY_PHASE3_CONFIG.staffLimits.thresholds.webhookChanges, 1, 50),
            },
        },
        reports: {
            enabled: reports.enabled === true,
            maxTimelineEvents: clampInteger(reports.maxTimelineEvents, DEFAULT_SECURITY_PHASE3_CONFIG.reports.maxTimelineEvents, 10, 200),
            includeAuditDetails: reports.includeAuditDetails === true,
        },
    }
}

function getSecurityPhase3Config(guildId) {
    return normalizeSecurityPhase3Config(getServerConfig(guildId).config)
}

function entryMatches(entry, { member, userId, isBot, channelId }) {
    const resolvedId = String(userId || member?.id || "")
    if (entry.subjectType === "user") return entry.subjectId === resolvedId
    if (entry.subjectType === "bot") return Boolean(isBot ?? member?.user?.bot) && entry.subjectId === resolvedId
    if (entry.subjectType === "channel") return entry.subjectId === String(channelId || "")
    if (entry.subjectType === "role") return member?.roles?.cache?.has(entry.subjectId) === true
    return false
}

function getTrustedMatch({ guildId, member = null, userId = null, isBot = null, channelId = null, scope }) {
    const config = getSecurityPhase3Config(guildId)
    if (!config.trusted.enabled) return null
    if (String(userId || member?.id || "") === String(member?.guild?.ownerId || "")) {
        return { subjectType: "owner", subjectId: String(userId || member?.id), scopes: TRUSTED_SCOPES }
    }
    return config.trusted.entries.find(entry => (
        entry.scopes.includes(scope)
        && entryMatches(entry, { member, userId, isBot, channelId })
    )) || null
}

function isTrustedForScope(input) {
    return Boolean(getTrustedMatch(input))
}

module.exports = {
    TRUSTED_SCOPES,
    TRUSTED_SUBJECT_TYPES,
    SECURITY_ACTIONS,
    DEFAULT_SECURITY_PHASE3_CONFIG,
    normalizeSecurityPhase3Config,
    getSecurityPhase3Config,
    getTrustedMatch,
    isTrustedForScope,
}
