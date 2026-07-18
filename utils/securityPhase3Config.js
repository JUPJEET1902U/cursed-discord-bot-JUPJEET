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
const SECURITY_ACTIONS = Object.freeze(["alert", "quarantine", "lockdown"])

const DEFAULT_SECURITY_PHASE3_CONFIG = Object.freeze({
    enabled: false,
    securityLogChannelId: null,
    antiRaid: Object.freeze({
        enabled: false,
        joinThreshold: 8,
        windowSeconds: 20,
        minAccountAgeHours: 24,
        action: "alert",
        activeRaidSeconds: 120,
    }),
    antiNuke: Object.freeze({
        enabled: false,
        action: "alert",
        windowSeconds: 15,
        thresholds: Object.freeze({
            bans: 5,
            kicks: 5,
            channelDeletes: 3,
            roleDeletes: 3,
            webhookChanges: 4,
            dangerousRoleChanges: 2,
            botAdds: 2,
        }),
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
        roleDeletes: clampInteger(input.roleDeletes, defaults.roleDeletes, 1, 25),
        webhookChanges: clampInteger(input.webhookChanges, defaults.webhookChanges, 1, 25),
        dangerousRoleChanges: clampInteger(input.dangerousRoleChanges, defaults.dangerousRoleChanges, 1, 25),
        botAdds: clampInteger(input.botAdds, defaults.botAdds, 1, 25),
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
    const source = isRecord(config.securityPhase3) ? config.securityPhase3 : config
    const antiRaid = isRecord(source.antiRaid) ? source.antiRaid : {}
    const antiNuke = isRecord(source.antiNuke) ? source.antiNuke : {}
    const quarantine = isRecord(source.quarantine) ? source.quarantine : {}
    const lockdown = isRecord(source.lockdown) ? source.lockdown : {}
    const trusted = isRecord(source.trusted) ? source.trusted : {}

    return {
        enabled: source.enabled === true,
        securityLogChannelId: source.securityLogChannelId ? String(source.securityLogChannelId) : null,
        antiRaid: {
            enabled: antiRaid.enabled === true,
            joinThreshold: clampInteger(antiRaid.joinThreshold, 8, 3, 100),
            windowSeconds: clampInteger(antiRaid.windowSeconds, 20, 5, 300),
            minAccountAgeHours: clampInteger(antiRaid.minAccountAgeHours, 24, 0, 24 * 365),
            action: normalizeAction(antiRaid.action),
            activeRaidSeconds: clampInteger(antiRaid.activeRaidSeconds, 120, 30, 1800),
        },
        antiNuke: {
            enabled: antiNuke.enabled === true,
            action: normalizeAction(antiNuke.action),
            windowSeconds: clampInteger(antiNuke.windowSeconds, 15, 5, 300),
            thresholds: normalizeThresholds(antiNuke.thresholds),
        },
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
