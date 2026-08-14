const { getServerConfig } = require("./serverConfig")

const LOG_CATEGORY_KEYS = Object.freeze([
    "messageDelete",
    "messageEdit",
    "memberJoin",
    "memberLeave",
    "memberBan",
    "memberUnban",
    "memberTimeout",
    "memberNicknameChange",
    "roleCreate",
    "roleDelete",
    "roleUpdate",
    "channelCreate",
    "channelDelete",
    "channelUpdate",
    "voiceJoin",
    "voiceLeave",
    "voiceSwitch",
    "voiceState",
    "guildUpdate",
    "inviteCreate",
    "inviteDelete",
    "emojiUpdate",
    "moderationAction",
    "securityAlert",
    "ticketEvent",
])

const DEFAULT_COLORS = Object.freeze({
    messageDelete: "#EF4444",
    messageEdit: "#F59E0B",
    memberJoin: "#22C55E",
    memberLeave: "#EF4444",
    memberBan: "#DC2626",
    memberUnban: "#22C55E",
    memberTimeout: "#F59E0B",
    memberNicknameChange: "#38BDF8",
    roleCreate: "#22C55E",
    roleDelete: "#EF4444",
    roleUpdate: "#F59E0B",
    channelCreate: "#22C55E",
    channelDelete: "#EF4444",
    channelUpdate: "#38BDF8",
    voiceJoin: "#8B5CF6",
    voiceLeave: "#8B5CF6",
    voiceSwitch: "#8B5CF6",
    voiceState: "#8B5CF6",
    guildUpdate: "#A78BFA",
    inviteCreate: "#22C55E",
    inviteDelete: "#EF4444",
    emojiUpdate: "#F472B6",
    moderationAction: "#FB7185",
    securityAlert: "#F59E0B",
    ticketEvent: "#38BDF8",
})

const SNOWFLAKE = /^\d{17,20}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function categoryDefaults(key) {
    return {
        enabled: false,
        channelId: null,
        embed: true,
        color: DEFAULT_COLORS[key] || "#8B5CF6",
        ignoreBots: true,
        includeContent: false,
    }
}

function normalizeCategory(value, key) {
    const input = isRecord(value) ? value : {}
    const defaults = categoryDefaults(key)
    const channelId = input.channelId == null ? null : String(input.channelId)
    const color = String(input.color || defaults.color)
    return {
        enabled: input.enabled === true,
        channelId: channelId && SNOWFLAKE.test(channelId) ? channelId : null,
        embed: input.embed !== false,
        color: HEX_COLOR.test(color) ? color.toUpperCase() : defaults.color,
        ignoreBots: input.ignoreBots !== false,
        includeContent: key === "messageDelete" && input.includeContent === true,
    }
}

function hasExplicitLogsConfig(rawConfig = {}) {
    return isRecord(rawConfig.logs)
}

function legacyCategory(rawConfig, key) {
    const defaults = categoryDefaults(key)
    const phase2Logging = isRecord(rawConfig?.moderationPhase2?.logging)
        ? rawConfig.moderationPhase2.logging
        : {}
    const security = isRecord(rawConfig.securityPhase3) ? rawConfig.securityPhase3 : {}
    const tickets = isRecord(rawConfig.tickets) ? rawConfig.tickets : {}

    if (key === "messageDelete") {
        return normalizeCategory({
            ...defaults,
            enabled: phase2Logging.messageDeleteEnabled === true,
            channelId: phase2Logging.messageLogChannelId || null,
            includeContent: phase2Logging.storeDeletedMessageContent === true,
        }, key)
    }
    if (key === "messageEdit") {
        return normalizeCategory({
            ...defaults,
            enabled: phase2Logging.messageEditEnabled === true,
            channelId: phase2Logging.messageLogChannelId || null,
        }, key)
    }
    if (key === "memberNicknameChange") {
        return normalizeCategory({
            ...defaults,
            enabled: phase2Logging.memberUpdateEnabled === true,
            channelId: phase2Logging.memberLogChannelId || null,
        }, key)
    }
    if (key === "moderationAction") {
        return normalizeCategory({
            ...defaults,
            enabled: Boolean(rawConfig.modLogChannelId),
            channelId: rawConfig.modLogChannelId || null,
        }, key)
    }
    if (key === "securityAlert") {
        return normalizeCategory({
            ...defaults,
            enabled: Boolean(security.securityLogChannelId),
            channelId: security.securityLogChannelId || null,
        }, key)
    }
    if (key === "ticketEvent") {
        return normalizeCategory({
            ...defaults,
            enabled: Boolean(tickets.logChannelId),
            channelId: tickets.logChannelId || null,
        }, key)
    }
    return defaults
}

function normalizeLogsConfig(rawConfig = {}) {
    const explicit = hasExplicitLogsConfig(rawConfig)
    const source = explicit ? rawConfig.logs : {}
    return Object.fromEntries(LOG_CATEGORY_KEYS.map(key => [
        key,
        explicit ? normalizeCategory(source[key], key) : legacyCategory(rawConfig, key),
    ]))
}

function getLogsConfig(guildId) {
    return normalizeLogsConfig(getServerConfig(guildId).config)
}

function getLogCategory(guildId, key) {
    if (!LOG_CATEGORY_KEYS.includes(key)) return null
    return getLogsConfig(guildId)[key]
}

function guildHasExplicitLogsConfig(guildId) {
    return hasExplicitLogsConfig(getServerConfig(guildId).config)
}

function colorToInt(value, fallback = 0x8B5CF6) {
    const color = String(value || "")
    return HEX_COLOR.test(color) ? Number.parseInt(color.slice(1), 16) : fallback
}

module.exports = {
    LOG_CATEGORY_KEYS,
    DEFAULT_COLORS,
    SNOWFLAKE,
    HEX_COLOR,
    categoryDefaults,
    normalizeCategory,
    normalizeLogsConfig,
    getLogsConfig,
    getLogCategory,
    hasExplicitLogsConfig,
    guildHasExplicitLogsConfig,
    colorToInt,
}
