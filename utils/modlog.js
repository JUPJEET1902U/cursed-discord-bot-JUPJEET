/**
 * Structured moderation logging plus MongoDB case creation.
 * A moderation case is persisted even when no log channel is configured.
 */

const { buildEmbed, COLORS } = require("./responseBuilder")
const { createCase } = require("./moderationCases")

const ACTION_COLORS = {
    WARN: COLORS.warning,
    CLEAR_WARNINGS: COLORS.admin,
    TIMEOUT: 0xF0B232,
    MUTE: 0xF0B232,
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
    try {
        const { attachActivityTracking } = require("./activityTracker")
        attachActivityTracking(client)
    } catch (err) {
        console.error("Activity tracking listener setup error:", err.message)
    }

    try {
        const { initializeModerationPhase2 } = require("./moderationPhase2Bootstrap")
        initializeModerationPhase2(client)
    } catch (err) {
        console.error("Moderation Phase 2 setup error:", err.message)
    }

    try {
        const { initializeSecurityPhase3 } = require("./securityPhase3Bootstrap")
        initializeSecurityPhase3(client)
    } catch (err) {
        console.error("Moderation Phase 3 setup error:", err.message)
    }

    try {
        const { initializeTicketSystem } = require("./ticketBootstrap")
        initializeTicketSystem(client)
    } catch (err) {
        console.error("Ticket System setup error:", err.message)
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
    return source === "automod" || (!moderator && String(action).startsWith("ANTI_"))
}

function actionLabel(action) {
    return String(action || "NOTE")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase())
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

    let caseRecord = null
    if (createCaseRecord && guild?.id && target?.id) {
        caseRecord = await createCase({
            guildId: guild.id,
            action: normalizedAction,
            target,
            moderator,
            reason,
            durationMs: durationMs || inferDurationMs(extra),
            evidenceUrl,
            source: resolvedSource,
            metadata: {
                ...(metadata && typeof metadata === "object" ? metadata : {}),
                details: extra || null,
            },
        })
    }

    if (!_client) return { caseRecord, logged: false }

    let channelId = null
    try {
        const { getServerConfig } = require("./serverConfig")
        const { config } = getServerConfig(guild.id)
        channelId = config.modLogChannelId || process.env.MOD_LOG_CHANNEL_ID || null
    } catch {
        channelId = process.env.MOD_LOG_CHANNEL_ID || null
    }

    if (!channelId) return { caseRecord, logged: false }

    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased()) return { caseRecord, logged: false }

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
        value: moderator ? `<@${moderator.id}> (${moderator.tag || "Unknown"})` : "AutoMod",
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
    } catch (err) {
        console.error("Mod-log send error:", err.message)
        return { caseRecord, logged: false }
    }
}

module.exports = { setClient, logAction }
