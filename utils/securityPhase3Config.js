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
])

const TRUSTED_SUBJECT_TYPES = Object.freeze(["user", "role", "bot", "channel"])
const SECURITY_ACTIONS = Object.freeze(["alert", "quarantine", "lockdown", "neutralize"])

const DEFAULT_SECURITY_PHASE3_CONFIG = Object.freeze({
    enabled: true,
    securityLogChannelId: null,
    antiRaid: Object.freeze({
        enabled: false,
        joinThreshold: 6,
        windowSeconds: 15,
        minAccountAgeHours: 72,
        action: "quarantine",
        activeRaidSeconds: 300,
    }),
    antiNuke: Object.freeze({
        enabled: true,
        action: "neutralize",
        windowSeconds: 10,
        restoreDeletedChannels: true,
        restoreDeletedRoles: true,
        removeDangerousRoles: true,
        banMaliciousBots: true,
        autoLockdown: true,
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
        enabled: true,
        windowSeconds: 8,
        repeatedMessageThreshold: 3,
        rapidMessageThreshold: 5,
        botInviteThreshold: 2,
        inviteThreshold: 3,
        linkThreshold: 6,
        maxMentions: 5,
    }),
    quarantine: Object.freeze({
        enabled: true,
        roleId: null,
        channelId: null,
        removeManageableRoles: true,
    }),
    lockdown: Object.freeze({
        enabled: true,
        channelIds: [],
        raiseVerificationLevel: true,
    }),
    trusted: Object.freeze({
        enabled: true,
        entries: [],
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
        enabled: input.enabled !== false,
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
    const antiRaid = isRecord(source.antiRaid) ? source.antiRaid : {}
    const antiNuke = isRecord(source.antiNuke) ? source.antiNuke : {}
    const quarantine = isRecord(source.quarantine) ? source.quarantine : {}
    const lockdown = isRecord(source.lockdown) ? source.lockdown : {}
    const trusted = isRecord(source.trusted) ? source.trusted : {}

    return {
        enabled: source.enabled !== false,
        securityLogChannelId: source.securityLogChannelId ? String(source.securityLogChannelId) : null,
        antiRaid: {
            enabled: antiRaid.enabled === true,
            joinThreshold: clampInteger(antiRaid.joinThreshold, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.joinThreshold, 3, 100),
            windowSeconds: clampInteger(antiRaid.windowSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.windowSeconds, 5, 300),
            minAccountAgeHours: clampInteger(antiRaid.minAccountAgeHours, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.minAccountAgeHours, 0, 24 * 365),
            action: normalizeAction(antiRaid.action, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.action),
            activeRaidSeconds: clampInteger(antiRaid.activeRaidSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiRaid.activeRaidSeconds, 30, 1800),
        },
        antiNuke: {
            enabled: antiNuke.enabled !== false,
            action: normalizeAction(antiNuke.action, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.action),
            windowSeconds: clampInteger(antiNuke.windowSeconds, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.windowSeconds, 5, 300),
            restoreDeletedChannels: antiNuke.restoreDeletedChannels !== false,
            restoreDeletedRoles: antiNuke.restoreDeletedRoles !== false,
            removeDangerousRoles: antiNuke.removeDangerousRoles !== false,
            banMaliciousBots: antiNuke.banMaliciousBots !== false,
            autoLockdown: antiNuke.autoLockdown !== false,
            ownerAlerts: antiNuke.ownerAlerts !== false,
            neutralizeTimeoutMinutes: clampInteger(antiNuke.neutralizeTimeoutMinutes, DEFAULT_SECURITY_PHASE3_CONFIG.antiNuke.neutralizeTimeoutMinutes, 1, 40320),
            thresholds: normalizeThresholds(antiNuke.thresholds),
        },
        messageShield: normalizeMessageShield(source.messageShield),
        quarantine: {
            enabled: quarantine.enabled !== false,
            roleId: quarantine.roleId ? String(quarantine.roleId) : null,
            channelId: quarantine.channelId ? String(quarantine.channelId) : null,
            removeManageableRoles: quarantine.removeManageableRoles !== false,
        },
        lockdown: {
            enabled: lockdown.enabled !== false,
            channelIds: uniqueStrings(lockdown.channelIds, 200),
            raiseVerificationLevel: lockdown.raiseVerificationLevel !== false,
        },
        trusted: {
            enabled: trusted.enabled !== false,
            entries: normalizeTrustedEntries(trusted.entries),
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
