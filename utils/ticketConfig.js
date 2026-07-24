const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./serverConfig")

const UNLIMITED_OPEN_TICKETS = Number.MAX_SAFE_INTEGER

const DEFAULT_TICKET_CONFIG = Object.freeze({
    enabled: false,
    defaultCategoryId: null,
    archiveCategoryId: null,
    logChannelId: null,
    transcriptChannelId: null,
    supportRoleIds: [],
    adminRoleIds: [],
    maxOpenPerUser: UNLIMITED_OPEN_TICKETS,
    cooldownMinutes: 2,
    autoCloseHours: 0,
    deleteAfterCloseMinutes: 0,
    allowCreatorClose: true,
    requireCloseReason: true,
    transcriptOnClose: true,
    dmOnClose: true,
    feedbackEnabled: true,
    firstResponseSlaMinutes: 0,
    namingTemplate: "ticket-{number}",
    defaultPriority: "normal",
    blacklistUserIds: [],
})

const PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"])

function uniqueIds(value, limit = 50) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item || "").trim()).filter(id => /^\d{17,20}$/.test(id)))].slice(0, limit)
}

function integer(value, fallback, min, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function channelId(value) {
    const text = value == null ? "" : String(value)
    return /^\d{17,20}$/.test(text) ? text : null
}

function normalizeTicketConfig(raw = {}) {
    const source = raw?.tickets && typeof raw.tickets === "object" ? raw.tickets : raw
    const priority = String(source.defaultPriority || DEFAULT_TICKET_CONFIG.defaultPriority).toLowerCase()
    const naming = String(source.namingTemplate || DEFAULT_TICKET_CONFIG.namingTemplate).trim().slice(0, 50)
    return {
        enabled: source.enabled === true,
        defaultCategoryId: channelId(source.defaultCategoryId),
        archiveCategoryId: channelId(source.archiveCategoryId),
        logChannelId: channelId(source.logChannelId),
        transcriptChannelId: channelId(source.transcriptChannelId),
        supportRoleIds: uniqueIds(source.supportRoleIds, 25),
        adminRoleIds: uniqueIds(source.adminRoleIds, 25),
        // Ticket creation itself is unlimited on both plans. Premium differences
        // are applied to dashboard panels, categories, questions, and history.
        maxOpenPerUser: UNLIMITED_OPEN_TICKETS,
        cooldownMinutes: integer(source.cooldownMinutes, DEFAULT_TICKET_CONFIG.cooldownMinutes, 0, 1440),
        autoCloseHours: integer(source.autoCloseHours, DEFAULT_TICKET_CONFIG.autoCloseHours, 0, 2160),
        deleteAfterCloseMinutes: integer(source.deleteAfterCloseMinutes, DEFAULT_TICKET_CONFIG.deleteAfterCloseMinutes, 0, 10080),
        allowCreatorClose: source.allowCreatorClose !== false,
        requireCloseReason: source.requireCloseReason !== false,
        transcriptOnClose: source.transcriptOnClose !== false,
        dmOnClose: source.dmOnClose !== false,
        feedbackEnabled: source.feedbackEnabled !== false,
        firstResponseSlaMinutes: integer(source.firstResponseSlaMinutes, DEFAULT_TICKET_CONFIG.firstResponseSlaMinutes, 0, 10080),
        namingTemplate: naming && naming.includes("{number}") ? naming : DEFAULT_TICKET_CONFIG.namingTemplate,
        defaultPriority: PRIORITIES.includes(priority) ? priority : DEFAULT_TICKET_CONFIG.defaultPriority,
        blacklistUserIds: uniqueIds(source.blacklistUserIds, 500),
    }
}

function getTicketConfig(guildId) {
    return normalizeTicketConfig(getServerConfig(guildId).config)
}

function hasTicketRole(member, config) {
    if (!member?.roles?.cache) return false
    const allowed = [...config.supportRoleIds, ...config.adminRoleIds]
    return allowed.some(roleId => member.roles.cache.has(roleId))
}

function isTicketStaff(member, config = getTicketConfig(member?.guild?.id)) {
    if (!member) return false
    return Boolean(
        member.id === member.guild?.ownerId
        || member.permissions?.has(PermissionFlagsBits.Administrator)
        || member.permissions?.has(PermissionFlagsBits.ManageGuild)
        || member.permissions?.has(PermissionFlagsBits.ManageChannels)
        || hasTicketRole(member, config)
    )
}

function canManageTicketSettings(member, config = getTicketConfig(member?.guild?.id)) {
    if (!member) return false
    return Boolean(
        member.id === member.guild?.ownerId
        || member.permissions?.has(PermissionFlagsBits.Administrator)
        || member.permissions?.has(PermissionFlagsBits.ManageGuild)
        || config.adminRoleIds.some(roleId => member.roles?.cache?.has(roleId))
    )
}

module.exports = {
    UNLIMITED_OPEN_TICKETS,
    DEFAULT_TICKET_CONFIG,
    PRIORITIES,
    normalizeTicketConfig,
    getTicketConfig,
    isTicketStaff,
    canManageTicketSettings,
}
