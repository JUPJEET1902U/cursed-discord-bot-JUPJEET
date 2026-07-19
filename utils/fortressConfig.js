const { getServerConfig } = require("./serverConfig")

const FORTRESS_MODES = Object.freeze(["balanced", "strict", "custom"])
const CONTAINMENT_ACTIONS = Object.freeze([
    "strip_roles",
    "quarantine",
    "timeout",
    "kick",
    "ban",
    "lockdown",
])
const JOIN_GATE_ACTIONS = Object.freeze(["alert", "quarantine", "timeout", "kick", "ban"])
const AUTOMOD_ACTIONS = Object.freeze(["delete", "warn", "timeout", "kick", "ban"])

const DEFAULT_FORTRESS_CONFIG = Object.freeze({
    enabled: true,
    mode: "balanced",
    notifyOwner: true,
    auditRetryCount: 3,
    auditRetryDelayMs: 450,
    heat: Object.freeze({
        enabled: true,
        threshold: 10,
        windowSeconds: 45,
        decaySeconds: 90,
        panicThreshold: 18,
    }),
    response: Object.freeze({
        neutralizeFirst: true,
        order: Object.freeze(["strip_roles", "quarantine", "timeout", "lockdown"]),
        timeoutMinutes: 10080,
        continueAfterContainment: false,
    }),
    rollback: Object.freeze({
        enabled: true,
        recreateDeletedChannels: true,
        recreateDeletedRoles: true,
        revertChannelUpdates: true,
        revertRoleUpdates: true,
        removeUnauthorizedChannels: true,
        removeUnauthorizedRoles: true,
        removeUnauthorizedBots: true,
        removeUnauthorizedWebhooks: true,
        unbanVictims: true,
        restoreRoleAssignments: true,
    }),
    panic: Object.freeze({
        enabled: true,
        lockdownOnTrigger: true,
        autoReleaseMinutes: 0,
        triggerOnCritical: true,
    }),
    backups: Object.freeze({
        enabled: true,
        intervalMinutes: 180,
        maxSnapshots: 10,
        autoRestoreOnPanic: false,
    }),
    joinGate: Object.freeze({
        enabled: false,
        action: "quarantine",
        minimumScore: 5,
        onlyDuringRaid: true,
        noAvatar: true,
        noAvatarScore: 2,
        accountAgeHours: 24,
        newAccountScore: 4,
        advertisingName: true,
        advertisingNameScore: 5,
        usernamePatterns: [],
        usernamePatternScore: 4,
        unverifiedBots: true,
        unauthorizedBots: true,
    }),
    automod: Object.freeze({
        enabled: false,
        dryRun: false,
        deleteViolations: true,
        decaySeconds: 45,
        duplicateWindowSeconds: 20,
        filters: Object.freeze({
            rapidSpam: true,
            duplicateSpam: true,
            mentionSpam: true,
            capsSpam: true,
            emojiSpam: true,
            newlineSpam: true,
            zalgo: true,
            attachmentSpam: true,
            links: true,
            invites: true,
        }),
        limits: Object.freeze({
            messages: 6,
            messageWindowSeconds: 6,
            duplicates: 3,
            mentions: 6,
            capsPercent: 75,
            emojis: 12,
            newlines: 12,
            attachments: 5,
        }),
        heat: Object.freeze({
            rapidSpam: 5,
            duplicateSpam: 6,
            mentionSpam: 8,
            capsSpam: 3,
            emojiSpam: 3,
            newlineSpam: 3,
            zalgo: 7,
            attachmentSpam: 5,
            link: 5,
            invite: 8,
        }),
        actions: Object.freeze([
            Object.freeze({ heat: 5, action: "delete", durationMinutes: null }),
            Object.freeze({ heat: 8, action: "warn", durationMinutes: null }),
            Object.freeze({ heat: 12, action: "timeout", durationMinutes: 10 }),
            Object.freeze({ heat: 20, action: "kick", durationMinutes: null }),
            Object.freeze({ heat: 30, action: "ban", durationMinutes: null }),
        ]),
    }),
})

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function uniqueStrings(value, limit = 100) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, limit)
}

function normalizeResponse(value) {
    const input = isRecord(value) ? value : {}
    const requested = uniqueStrings(input.order, CONTAINMENT_ACTIONS.length)
        .filter(action => CONTAINMENT_ACTIONS.includes(action))
    return {
        neutralizeFirst: input.neutralizeFirst !== false,
        order: requested.length ? requested : [...DEFAULT_FORTRESS_CONFIG.response.order],
        timeoutMinutes: clampInteger(input.timeoutMinutes, 10080, 1, 40320),
        continueAfterContainment: input.continueAfterContainment === true,
    }
}

function normalizeRollback(value) {
    const input = isRecord(value) ? value : {}
    const defaults = DEFAULT_FORTRESS_CONFIG.rollback
    return Object.fromEntries(Object.keys(defaults).map(key => [key, input[key] !== false]))
}

function normalizePanic(value) {
    const input = isRecord(value) ? value : {}
    return {
        enabled: input.enabled !== false,
        lockdownOnTrigger: input.lockdownOnTrigger !== false,
        autoReleaseMinutes: clampInteger(input.autoReleaseMinutes, 0, 0, 1440),
        triggerOnCritical: input.triggerOnCritical !== false,
    }
}

function normalizeBackups(value) {
    const input = isRecord(value) ? value : {}
    return {
        enabled: input.enabled !== false,
        intervalMinutes: clampInteger(input.intervalMinutes, 180, 30, 1440),
        maxSnapshots: clampInteger(input.maxSnapshots, 10, 2, 25),
        autoRestoreOnPanic: input.autoRestoreOnPanic === true,
    }
}

function normalizeJoinGate(value) {
    const input = isRecord(value) ? value : {}
    return {
        enabled: input.enabled === true,
        action: JOIN_GATE_ACTIONS.includes(input.action) ? input.action : "quarantine",
        minimumScore: clampInteger(input.minimumScore, 5, 1, 25),
        onlyDuringRaid: input.onlyDuringRaid !== false,
        noAvatar: input.noAvatar !== false,
        noAvatarScore: clampInteger(input.noAvatarScore, 2, 0, 10),
        accountAgeHours: clampInteger(input.accountAgeHours, 24, 0, 24 * 365),
        newAccountScore: clampInteger(input.newAccountScore, 4, 0, 10),
        advertisingName: input.advertisingName !== false,
        advertisingNameScore: clampInteger(input.advertisingNameScore, 5, 0, 10),
        usernamePatterns: uniqueStrings(input.usernamePatterns, 50).map(item => item.slice(0, 80)),
        usernamePatternScore: clampInteger(input.usernamePatternScore, 4, 0, 10),
        unverifiedBots: input.unverifiedBots !== false,
        unauthorizedBots: input.unauthorizedBots !== false,
    }
}

function normalizeAutomodActions(value) {
    const input = Array.isArray(value) ? value : DEFAULT_FORTRESS_CONFIG.automod.actions
    const byHeat = new Map()
    for (const item of input) {
        if (!isRecord(item)) continue
        const heat = clampInteger(item.heat, 0, 1, 100)
        const action = AUTOMOD_ACTIONS.includes(item.action) ? item.action : null
        if (!heat || !action) continue
        byHeat.set(heat, {
            heat,
            action,
            durationMinutes: action === "timeout"
                ? clampInteger(item.durationMinutes, 10, 1, 40320)
                : null,
        })
    }
    const normalized = [...byHeat.values()].sort((a, b) => a.heat - b.heat).slice(0, 10)
    return normalized.length ? normalized : DEFAULT_FORTRESS_CONFIG.automod.actions.map(item => ({ ...item }))
}

function normalizeAutomod(value) {
    const input = isRecord(value) ? value : {}
    const filters = isRecord(input.filters) ? input.filters : {}
    const limits = isRecord(input.limits) ? input.limits : {}
    const heat = isRecord(input.heat) ? input.heat : {}
    const defaultFilters = DEFAULT_FORTRESS_CONFIG.automod.filters
    const defaultLimits = DEFAULT_FORTRESS_CONFIG.automod.limits
    const defaultHeat = DEFAULT_FORTRESS_CONFIG.automod.heat
    return {
        enabled: input.enabled === true,
        dryRun: input.dryRun === true,
        deleteViolations: input.deleteViolations !== false,
        decaySeconds: clampInteger(input.decaySeconds, 45, 10, 600),
        duplicateWindowSeconds: clampInteger(input.duplicateWindowSeconds, 20, 5, 300),
        filters: Object.fromEntries(Object.keys(defaultFilters).map(key => [key, filters[key] !== false])),
        limits: {
            messages: clampInteger(limits.messages, defaultLimits.messages, 3, 30),
            messageWindowSeconds: clampInteger(limits.messageWindowSeconds, defaultLimits.messageWindowSeconds, 2, 60),
            duplicates: clampInteger(limits.duplicates, defaultLimits.duplicates, 2, 10),
            mentions: clampInteger(limits.mentions, defaultLimits.mentions, 2, 50),
            capsPercent: clampInteger(limits.capsPercent, defaultLimits.capsPercent, 50, 100),
            emojis: clampInteger(limits.emojis, defaultLimits.emojis, 3, 100),
            newlines: clampInteger(limits.newlines, defaultLimits.newlines, 3, 100),
            attachments: clampInteger(limits.attachments, defaultLimits.attachments, 2, 10),
        },
        heat: Object.fromEntries(Object.keys(defaultHeat).map(key => [
            key,
            clampInteger(heat[key], defaultHeat[key], 0, 25),
        ])),
        actions: normalizeAutomodActions(input.actions),
    }
}

function normalizeFortressConfig(value = {}) {
    const source = isRecord(value.securityFortress) ? value.securityFortress : value
    const heat = isRecord(source.heat) ? source.heat : {}
    return {
        enabled: source.enabled !== false,
        mode: FORTRESS_MODES.includes(source.mode) ? source.mode : "balanced",
        notifyOwner: source.notifyOwner !== false,
        auditRetryCount: clampInteger(source.auditRetryCount, 3, 1, 6),
        auditRetryDelayMs: clampInteger(source.auditRetryDelayMs, 450, 100, 2000),
        heat: {
            enabled: heat.enabled !== false,
            threshold: clampInteger(heat.threshold, 10, 3, 100),
            windowSeconds: clampInteger(heat.windowSeconds, 45, 5, 300),
            decaySeconds: clampInteger(heat.decaySeconds, 90, 10, 900),
            panicThreshold: clampInteger(heat.panicThreshold, 18, 5, 150),
        },
        response: normalizeResponse(source.response),
        rollback: normalizeRollback(source.rollback),
        panic: normalizePanic(source.panic),
        backups: normalizeBackups(source.backups),
        joinGate: normalizeJoinGate(source.joinGate),
        automod: normalizeAutomod(source.automod),
    }
}

function getFortressConfig(guildId) {
    return normalizeFortressConfig(getServerConfig(guildId).config)
}

module.exports = {
    FORTRESS_MODES,
    CONTAINMENT_ACTIONS,
    JOIN_GATE_ACTIONS,
    AUTOMOD_ACTIONS,
    DEFAULT_FORTRESS_CONFIG,
    normalizeFortressConfig,
    getFortressConfig,
}
