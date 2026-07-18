const { getServerConfig } = require("./serverConfig")

const COMMAND_KEYS = Object.freeze([
    "purge",
    "lock",
    "unlock",
    "slowmode",
    "nickname",
    "tempban",
    "softban",
    "note",
    "history",
])

const DEFAULT_PHASE2_CONFIG = Object.freeze({
    advancedModerationEnabled: true,
    maxPurgeAmount: 100,
    tempBansEnabled: true,
    softbansEnabled: true,
    moderatorNotesEnabled: true,
    dangerousCommandsAdminOnly: false,
    commandToggles: Object.freeze(Object.fromEntries(COMMAND_KEYS.map(key => [key, true]))),
    logging: Object.freeze({
        messageDeleteEnabled: false,
        messageEditEnabled: false,
        memberUpdateEnabled: false,
        storeDeletedMessageContent: false,
        messageLogChannelId: null,
        memberLogChannelId: null,
    }),
    whitelist: Object.freeze({
        enabled: false,
        userIds: [],
        roleIds: [],
        channelIds: [],
        botIds: [],
        exemptFromAutomod: true,
        protectFromManualModeration: true,
    }),
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

function normalizeCommandToggles(value) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    return Object.fromEntries(COMMAND_KEYS.map(key => [key, input[key] !== false]))
}

function normalizeLogging(value) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    return {
        messageDeleteEnabled: input.messageDeleteEnabled === true,
        messageEditEnabled: input.messageEditEnabled === true,
        memberUpdateEnabled: input.memberUpdateEnabled === true,
        storeDeletedMessageContent: input.storeDeletedMessageContent === true,
        messageLogChannelId: input.messageLogChannelId ? String(input.messageLogChannelId) : null,
        memberLogChannelId: input.memberLogChannelId ? String(input.memberLogChannelId) : null,
    }
}

function normalizeWhitelist(value) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    return {
        enabled: input.enabled === true,
        userIds: uniqueStrings(input.userIds, 100),
        roleIds: uniqueStrings(input.roleIds, 50),
        channelIds: uniqueStrings(input.channelIds, 100),
        botIds: uniqueStrings(input.botIds, 100),
        exemptFromAutomod: input.exemptFromAutomod !== false,
        protectFromManualModeration: input.protectFromManualModeration !== false,
    }
}

function normalizePhase2Config(config = {}) {
    const source = config.moderationPhase2 && typeof config.moderationPhase2 === "object"
        ? config.moderationPhase2
        : config
    return {
        advancedModerationEnabled: source.advancedModerationEnabled !== false,
        maxPurgeAmount: clampInteger(source.maxPurgeAmount, DEFAULT_PHASE2_CONFIG.maxPurgeAmount, 1, 100),
        tempBansEnabled: source.tempBansEnabled !== false,
        softbansEnabled: source.softbansEnabled !== false,
        moderatorNotesEnabled: source.moderatorNotesEnabled !== false,
        dangerousCommandsAdminOnly: source.dangerousCommandsAdminOnly === true,
        commandToggles: normalizeCommandToggles(source.commandToggles),
        logging: normalizeLogging(source.logging),
        whitelist: normalizeWhitelist(source.whitelist),
    }
}

function getPhase2Config(guildId) {
    return normalizePhase2Config(getServerConfig(guildId).config)
}

function memberRoleIds(member) {
    if (!member?.roles?.cache) return []
    return [...member.roles.cache.keys()]
}

function getWhitelistMatch({ guildId, member = null, userId = null, channelId = null, isBot = null }) {
    const config = getPhase2Config(guildId)
    const whitelist = config.whitelist
    if (!whitelist.enabled) return null

    const resolvedUserId = String(userId || member?.id || "")
    const resolvedIsBot = typeof isBot === "boolean" ? isBot : Boolean(member?.user?.bot)

    if (resolvedUserId && whitelist.userIds.includes(resolvedUserId)) {
        return { type: "user", id: resolvedUserId }
    }
    if (resolvedIsBot && resolvedUserId && whitelist.botIds.includes(resolvedUserId)) {
        return { type: "bot", id: resolvedUserId }
    }
    const roleId = memberRoleIds(member).find(id => whitelist.roleIds.includes(id))
    if (roleId) return { type: "role", id: roleId }
    if (channelId && whitelist.channelIds.includes(String(channelId))) {
        return { type: "channel", id: String(channelId) }
    }
    return null
}

function isCommandEnabled(config, commandName) {
    const normalized = normalizePhase2Config({ moderationPhase2: config })
    return normalized.advancedModerationEnabled !== false
        && normalized.commandToggles[String(commandName || "").toLowerCase()] !== false
}

module.exports = {
    COMMAND_KEYS,
    DEFAULT_PHASE2_CONFIG,
    normalizePhase2Config,
    getPhase2Config,
    getWhitelistMatch,
    isCommandEnabled,
}
