const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")

const DEFAULT_WARNING_THRESHOLDS = Object.freeze([
    { warnings: 3, action: "timeout", durationMinutes: 60 },
    { warnings: 5, action: "timeout", durationMinutes: 1440 },
    { warnings: 7, action: "kick", durationMinutes: null },
    { warnings: 10, action: "ban", durationMinutes: null },
])

const DEFAULT_MODERATION_CONFIG = Object.freeze({
    moderationCommandsEnabled: true,
    moderatorRoleIds: [],
    modLogChannelId: null,
    defaultTimeoutMinutes: 10,
    dmPunishedUsers: true,
    requireModerationReason: true,
    warningEscalationEnabled: false,
    warningThresholds: DEFAULT_WARNING_THRESHOLDS,
    antiSpam: false,
    antiLink: false,
    antiInvite: false,
    linkWhitelist: [],
})

function uniqueStrings(value, limit = 100) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, limit)
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeThresholds(value) {
    if (!Array.isArray(value)) return DEFAULT_WARNING_THRESHOLDS.map(item => ({ ...item }))

    const normalized = value
        .map(item => {
            if (!item || typeof item !== "object") return null
            const warnings = clampInteger(item.warnings, 0, 1, 100)
            const action = ["timeout", "kick", "ban"].includes(String(item.action))
                ? String(item.action)
                : null
            if (!warnings || !action) return null
            const durationMinutes = action === "timeout"
                ? clampInteger(item.durationMinutes, 60, 1, 40320)
                : null
            return { warnings, action, durationMinutes }
        })
        .filter(Boolean)
        .sort((a, b) => a.warnings - b.warnings)

    const byWarnings = new Map()
    for (const item of normalized) byWarnings.set(item.warnings, item)
    return [...byWarnings.values()].slice(0, 10)
}

function normalizeModerationConfig(config = {}) {
    return {
        moderationCommandsEnabled: config.moderationCommandsEnabled !== false,
        moderatorRoleIds: uniqueStrings(config.moderatorRoleIds, 25),
        modLogChannelId: config.modLogChannelId ? String(config.modLogChannelId) : null,
        defaultTimeoutMinutes: clampInteger(
            config.defaultTimeoutMinutes,
            DEFAULT_MODERATION_CONFIG.defaultTimeoutMinutes,
            1,
            40320
        ),
        dmPunishedUsers: config.dmPunishedUsers !== false,
        requireModerationReason: config.requireModerationReason !== false,
        warningEscalationEnabled: config.warningEscalationEnabled === true,
        warningThresholds: normalizeThresholds(config.warningThresholds),
        antiSpam: config.antiSpam === true,
        antiLink: config.antiLink === true,
        antiInvite: config.antiInvite === true,
        linkWhitelist: uniqueStrings(config.linkWhitelist, 100)
            .map(domain => domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
            .filter(Boolean),
    }
}

function getModerationConfig(guildId) {
    return normalizeModerationConfig(getServerConfig(guildId).config)
}

function hasConfiguredModeratorRole(member, config) {
    if (!member?.roles?.cache) return false
    return config.moderatorRoleIds.some(roleId => member.roles.cache.has(roleId))
}

function isModerator(member, config) {
    if (!member) return false
    const permissions = member.permissions
    const builtIn = permissions?.has(PermissionFlagsBits.Administrator)
        || permissions?.has(PermissionFlagsBits.ManageGuild)
        || permissions?.has(PermissionFlagsBits.ManageMessages)
        || permissions?.has(PermissionFlagsBits.ModerateMembers)
        || permissions?.has(PermissionFlagsBits.KickMembers)
        || permissions?.has(PermissionFlagsBits.BanMembers)
    return Boolean(builtIn || hasConfiguredModeratorRole(member, config))
}

module.exports = {
    DEFAULT_MODERATION_CONFIG,
    DEFAULT_WARNING_THRESHOLDS,
    normalizeModerationConfig,
    getModerationConfig,
    isModerator,
    hasConfiguredModeratorRole,
}
