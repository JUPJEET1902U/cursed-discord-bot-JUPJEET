/**
 * Structured moderation logging plus MongoDB case creation.
 * A moderation case is persisted even when no log channel is configured.
 */

const { LOG_COLORS, buildLogEmbed, userAvatar } = require("./logPresentation")
const { createCase } = require("./moderationCases")
const { hasExplicitLogsConfig, normalizeLogsConfig } = require("./loggingConfig")

const ACTION_COLORS = {
    WARN: LOG_COLORS.warning,
    CLEAR_WARNINGS: LOG_COLORS.moderation,
    TIMEOUT: 0xF0B232,
    MUTE: 0xF0B232,
    UNTIMEOUT: LOG_COLORS.success,
    UNMUTE: LOG_COLORS.success,
    KICK: LOG_COLORS.danger,
    BAN: 0x991B1B,
    UNBAN: LOG_COLORS.success,
    TEMPBAN: 0xD97706,
    SOFTBAN: 0xD97706,
    PURGE: LOG_COLORS.moderation,
    LOCK: 0x7C3AED,
    UNLOCK: LOG_COLORS.success,
    SLOWMODE: LOG_COLORS.info,
    NICKNAME: LOG_COLORS.info,
    NOTE: LOG_COLORS.neutral,
    QUARANTINE: LOG_COLORS.securityHigh,
    UNQUARANTINE: LOG_COLORS.success,
    LOCKDOWN_ENABLE: LOG_COLORS.critical,
    LOCKDOWN_DISABLE: LOG_COLORS.success,
    ANTI_LINK: 0x7C3AED,
    ANTI_INVITE: 0xC026D3,
    ANTI_SPAM: LOG_COLORS.securityHigh,
    MESSAGE_SHIELD: LOG_COLORS.critical,
}

const ACTION_ICONS = Object.freeze({
    WARN: "⚠️",
    CLEAR_WARNINGS: "🧹",
    TIMEOUT: "⏱️",
    MUTE: "🔇",
    UNTIMEOUT: "✅",
    UNMUTE: "🔊",
    KICK: "👢",
    BAN: "🔨",
    UNBAN: "✅",
    TEMPBAN: "⏳",
    SOFTBAN: "🧹",
    PURGE: "🗑️",
    LOCK: "🔒",
    UNLOCK: "🔓",
    SLOWMODE: "🐢",
    NICKNAME: "📝",
    NOTE: "📌",
    QUARANTINE: "🛡️",
    UNQUARANTINE: "✅",
    LOCKDOWN_ENABLE: "🚨",
    LOCKDOWN_DISABLE: "✅",
    ANTI_LINK: "🔗",
    ANTI_INVITE: "📨",
    ANTI_SPAM: "🚫",
    MESSAGE_SHIELD: "🛡️",
})

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

    try {
        const { attachLoggingCenter } = require("./loggingRuntime")
        attachLoggingCenter(client)
    } catch (err) {
        console.error("Unified logging setup error:", err.message)
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
        if (hasExplicitLogsConfig(config)) {
            const category = normalizeLogsConfig(config).moderationAction
            channelId = category.enabled ? category.channelId : null
        } else {
            channelId = config.modLogChannelId || process.env.MOD_LOG_CHANNEL_ID || null
        }
    } catch {
        channelId = process.env.MOD_LOG_CHANNEL_ID || null
    }

    if (!channelId) return { caseRecord, logged: false }

    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased()) return { caseRecord, logged: false }

    const targetType = metadata?.targetType === "channel" ? "channel" : "user"
    const targetDisplay = targetType === "channel"
        ? `<#${target.id}>`
        : `<@${target.id}>`
    const targetName = target.tag || (targetType === "channel" ? "Unknown channel" : "Unknown user")

    const fields = []
    if (caseRecord) fields.push({ name: "CASE", value: `#${caseRecord.caseNumber}`, inline: true })
    fields.push({
        name: moderator ? "MODERATOR" : "SOURCE",
        value: moderator ? `<@${moderator.id}>` : "AutoMod",
        inline: true,
    })
    if (reason) fields.push({ name: "REASON", value: String(reason).slice(0, 1024), inline: false })
    if (extra) fields.push({ name: "DETAILS", value: String(extra).slice(0, 1024), inline: false })
    if (evidenceUrl) fields.push({ name: "EVIDENCE", value: `[Open evidence](${String(evidenceUrl).slice(0, 950)})`, inline: false })

    const targetUser = targetType === "user"
        ? guild.members.cache.get(target.id)?.user || guild.client?.users?.cache?.get(target.id) || null
        : null

    const embed = buildLogEmbed({
        guild,
        category: "Moderation",
        event: actionLabel(normalizedAction),
        icon: ACTION_ICONS[normalizedAction] || "⚖️",
        color: ACTION_COLORS[normalizedAction] ?? LOG_COLORS.moderation,
        description: `${targetDisplay} • **${targetName}**`,
        fields,
        thumbnail: userAvatar(targetUser),
        footerMeta: [
            `Target ID: ${target.id}`,
            moderator?.id ? `Moderator ID: ${moderator.id}` : null,
            caseRecord ? `Case #${caseRecord.caseNumber}` : null,
        ].filter(Boolean).join(" • "),
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
