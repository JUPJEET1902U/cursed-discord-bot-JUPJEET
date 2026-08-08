/**
 * Structured moderation logging plus MongoDB case creation.
 *
 * Reboot rule: moderation actions must never fail because case persistence or a
 * log channel is unavailable. Case creation and Discord logging are isolated
 * side effects after the moderation action itself succeeds.
 */

const { buildEmbed, COLORS } = require("./responseBuilder")
const { createCase } = require("./moderationCases")

const ACTION_COLORS = {
    WARN: COLORS.warning,
    CLEAR_WARNINGS: COLORS.admin,
    TIMEOUT: COLORS.warning,
    MUTE: COLORS.warning,
    UNTIMEOUT: COLORS.success,
    UNMUTE: COLORS.success,
    KICK: COLORS.error,
    BAN: 0x992D22,
    UNBAN: COLORS.success,
    TEMPBAN: 0xD9822B,
    SOFTBAN: 0xD9822B,
    PURGE: COLORS.moderation,
    LOCK: 0x9B59B6,
    UNLOCK: COLORS.success,
    SLOWMODE: COLORS.moderation,
    NICKNAME: COLORS.info,
    NOTE: COLORS.admin,
    QUARANTINE: 0xE67E22,
    UNQUARANTINE: COLORS.success,
    LOCKDOWN_ENABLE: COLORS.error,
    LOCKDOWN_DISABLE: COLORS.success,
    ANTI_LINK: 0x9B59B6,
    ANTI_INVITE: 0xC45AA0,
    ANTI_SPAM: 0xE67E22,
    MESSAGE_SHIELD: COLORS.security,
}

let _client = null

function setClient(client) {
    _client = client
    const initializers = [
        ["Activity tracking", () => require("./activityTracker").attachActivityTracking(client)],
        ["Moderation foundation", () => require("./moderationPhase2Bootstrap").initializeModerationPhase2(client)],
        ["Server protection", () => require("./securityPhase3Bootstrap").initializeSecurityPhase3(client)],
        ["Ticket system", () => require("./ticketBootstrap").initializeTicketSystem(client)],
    ]
    for (const [label, initialize] of initializers) {
        try {
            initialize()
        } catch (error) {
            console.error(`${label} setup error:`, error.message)
        }
    }
}

function inferDurationMs(extra) {
    const text = String(extra || "")
    const minuteMatch = text.match(/(\d+)\s*minute/i)
    if (minuteMatch) return Number(minuteMatch[1]) * 60 * 1000
    const hourMatch = text.match(/(\d+)\s*hour/i)
    if (hourMatch) return Number(hourMatch[1]) * 60 * 60 * 1000
    const dayMatch = text.match(/(\d+)\s*day/i)
    if (dayMatch) return Number(dayMatch[1]) * 24 * 60 * 60 * 1000
    return null
}

function isAutoAction(action, moderator, source) {
    return source === "automod"
        || source === "system"
        || (!moderator && ["ANTI_", "MESSAGE_SHIELD"].some(prefix => String(action).startsWith(prefix)))
}

function actionLabel(action) {
    return String(action || "NOTE")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase())
}

async function createCaseSafely(guild, input) {
    if (!input.createCaseRecord || !guild?.id || !input.target?.id) return null
    try {
        return await createCase({
            guildId: guild.id,
            action: input.normalizedAction,
            target: input.target,
            moderator: input.moderator,
            reason: input.reason,
            durationMs: input.durationMs || inferDurationMs(input.extra),
            evidenceUrl: input.evidenceUrl,
            source: input.resolvedSource,
            metadata: {
                ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
                details: input.extra || null,
            },
        })
    } catch (error) {
        console.error("Moderation case persistence error:", error.message)
        return null
    }
}

function resolveLogChannelId(guildId) {
    try {
        const { getServerConfig } = require("./serverConfig")
        const { config } = getServerConfig(guildId)
        return config.modLogChannelId || process.env.MOD_LOG_CHANNEL_ID || null
    } catch {
        return process.env.MOD_LOG_CHANNEL_ID || null
    }
}

async function logAction(guild, {
    action,
    target,
    moderator,
    reason,
    extra,
    durationMs = null,
    evidenceUrl = null,
    source = null,
    metadata = {},
    createCaseRecord = true,
}) {
    const normalizedAction = String(action || "NOTE").toUpperCase()
    const resolvedSource = source || (isAutoAction(normalizedAction, moderator, source) ? "automod" : "manual")
    const caseRecord = await createCaseSafely(guild, {
        createCaseRecord,
        normalizedAction,
        target,
        moderator,
        reason,
        extra,
        durationMs,
        evidenceUrl,
        resolvedSource,
        metadata,
    })

    if (!_client || !guild?.id) return { caseRecord, logged: false }
    const channelId = resolveLogChannelId(guild.id)
    if (!channelId) return { caseRecord, logged: false }

    const channel = guild.channels.cache.get(channelId)
    if (!channel?.isTextBased()) return { caseRecord, logged: false }

    const targetType = metadata?.targetType === "channel" ? "channel" : "user"
    const targetDisplay = targetType === "channel"
        ? `<#${target.id}> (${target.tag || "Unknown channel"})`
        : `<@${target.id}> (${target.tag || "Unknown user"})`

    const fields = [
        { name: targetType === "channel" ? "Channel" : "User", value: targetDisplay, inline: true },
        { name: "Target ID", value: String(target.id), inline: true },
    ]
    if (caseRecord) fields.push({ name: "Case", value: `#${caseRecord.caseNumber}`, inline: true })
    fields.push({
        name: moderator ? "Moderator" : "Source",
        value: moderator ? `<@${moderator.id}> (${moderator.tag || "Unknown"})` : actionLabel(resolvedSource),
        inline: true,
    })
    if (reason) fields.push({ name: "Reason", value: String(reason).slice(0, 1024), inline: false })
    if (extra) fields.push({ name: "Details", value: String(extra).slice(0, 1024), inline: false })
    if (evidenceUrl) fields.push({ name: "Evidence", value: String(evidenceUrl).slice(0, 1024), inline: false })

    const embed = buildEmbed({
        title: `Moderation • ${actionLabel(normalizedAction)}`,
        color: ACTION_COLORS[normalizedAction] ?? COLORS.admin,
        fields,
        footer: "CURSED • Moderation",
        timestamp: true,
    })

    try {
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        return { caseRecord, logged: true }
    } catch (error) {
        console.error("Moderation log send error:", error.message)
        return { caseRecord, logged: false }
    }
}

module.exports = { setClient, logAction }
