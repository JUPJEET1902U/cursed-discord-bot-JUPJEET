const { PermissionFlagsBits } = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { neutralizeExecutor, notifyOwner } = require("./securityResponse")
const { createSecurityIncident } = require("./securityIncidents")
const { getIncidentModeState } = require("./securityRecoverySuite")
const { logAction } = require("./modlog")
const { recordTiming } = require("./runtimeMetrics")

const windows = new Map()
const cooldowns = new Map()
const INVITE_REGEX = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]{2,32}/gi
const LINK_REGEX = /https?:\/\/\S+|www\.\S+\.\S+/gi
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g
const MAX_TRACKED_KEYS = 5000
const MAX_RECORDS_PER_KEY = 30

function normalize(content) {
    return String(content || "")
        .normalize("NFKC")
        .replace(ZERO_WIDTH, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700)
}

function keyFor(message) {
    return `${message.guild.id}:${message.author.id}`
}

function prune(records, windowMs) {
    const cutoff = Date.now() - windowMs
    return records.filter(record => record.at >= cutoff)
}

function countMatches(regex, content) {
    regex.lastIndex = 0
    return [...String(content || "").matchAll(regex)].length
}

function effectiveShield(config, incidentMode) {
    const shield = config.messageShield
    if (!incidentMode?.active || config.incidentMode?.strictMessageShield === false) return shield
    return {
        ...shield,
        repeatedMessageThreshold: Math.max(2, shield.repeatedMessageThreshold - 1),
        rapidMessageThreshold: Math.max(3, shield.rapidMessageThreshold - 2),
        botInviteThreshold: 1,
        inviteThreshold: Math.max(1, shield.inviteThreshold - 1),
        linkThreshold: Math.max(2, Math.floor(shield.linkThreshold / 2)),
        maxMentions: Math.max(2, shield.maxMentions - 2),
    }
}

function signalFor(message, shield) {
    const key = keyFor(message)
    const windowMs = shield.windowSeconds * 1000
    const content = normalize(message.content)
    const record = {
        at: Date.now(),
        content,
        invites: countMatches(INVITE_REGEX, content),
        links: countMatches(LINK_REGEX, content),
    }
    const records = prune(windows.get(key) || [], windowMs)
    records.push(record)
    windows.set(key, records.slice(-MAX_RECORDS_PER_KEY))

    const repeated = content ? records.filter(item => item.content === content).length : 0
    const invites = records.reduce((sum, item) => sum + item.invites, 0)
    const links = records.reduce((sum, item) => sum + item.links, 0)
    const mentions = message.mentions.users.size
        + message.mentions.roles.size
        + (message.mentions.everyone ? shield.maxMentions : 0)
    const rapid = records.length
    const isBot = message.author.bot

    const reasons = []
    if (mentions >= shield.maxMentions) reasons.push("mass mentions")
    if (repeated >= shield.repeatedMessageThreshold) reasons.push("repeated messages")
    if (rapid >= shield.rapidMessageThreshold) reasons.push("rapid messages")
    if (invites >= (isBot ? shield.botInviteThreshold : shield.inviteThreshold)) reasons.push("invite spam")
    if (links >= shield.linkThreshold) reasons.push("link spam")
    if (!reasons.length) return null

    return {
        repeated,
        invites,
        links,
        mentions,
        rapid,
        reasons,
        windowSeconds: shield.windowSeconds,
    }
}

function cleanupRuntimeState() {
    const current = Date.now()
    for (const [key, records] of windows.entries()) {
        const recent = records.filter(record => current - record.at < 60_000)
        if (!recent.length) windows.delete(key)
        else windows.set(key, recent.slice(-MAX_RECORDS_PER_KEY))
    }
    for (const [key, expiresAt] of cooldowns.entries()) {
        if (expiresAt <= current) cooldowns.delete(key)
    }
    while (windows.size > MAX_TRACKED_KEYS) windows.delete(windows.keys().next().value)
    while (cooldowns.size > MAX_TRACKED_KEYS) cooldowns.delete(cooldowns.keys().next().value)
}

const cleanupTimer = setInterval(cleanupRuntimeState, 30_000)
cleanupTimer.unref?.()

async function runSecurityMessageShield(message) {
    const startedAt = Date.now()
    try {
        if (!message?.guild || !message.author || message.webhookId) return false
        const config = getSecurityPhase3Config(message.guild.id)
        if (!config.enabled || !config.messageShield.enabled) return false
        if (message.author.id === message.guild.ownerId || message.author.id === message.guild.members.me?.id) return false

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null)
        if (isTrustedForScope({
            guildId: message.guild.id,
            member,
            userId: message.author.id,
            isBot: message.author.bot,
            channelId: message.channel.id,
            scope: "automod",
        })) return false

        const incidentMode = await getIncidentModeState(message.guild.id)
        const shield = effectiveShield(config, incidentMode)
        const signal = signalFor(message, shield)
        if (!signal) return false

        const cooldownKey = keyFor(message)
        const cooldownUntil = cooldowns.get(cooldownKey) || 0
        if (cooldownUntil > Date.now()) {
            if (message.deletable) await message.delete().catch(() => {})
            return true
        }
        cooldowns.set(cooldownKey, Date.now() + shield.windowSeconds * 1000)

        if (message.deletable && message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await message.delete().catch(() => {})
        }

        const reasonText = signal.reasons.join(", ")
        const summary = `Message Shield detected ${reasonText} within ${signal.windowSeconds}s.`

        // Defensive response happens before database/log/owner notification work.
        const response = member
            ? await neutralizeExecutor(message.guild, member, config, {
                reason: `Message Shield: ${summary}`,
                actor: { id: message.guild.members.me?.id, tag: "CURSED Message Shield" },
            })
            : { ok: false, action: "alert", error: "Member unavailable" }

        const severity = message.author.bot || incidentMode.active ? "critical" : "high"
        const incidentInput = {
            guildId: message.guild.id,
            type: incidentMode.active ? "INCIDENT_MODE_MESSAGE_SHIELD" : "MESSAGE_SHIELD",
            severity,
            executorId: message.author.id,
            executorTag: message.author.tag || message.author.username,
            targetId: message.channel.id,
            targetTag: message.channel.name || "channel",
            actionTaken: response.ok ? "neutralize" : "alert",
            details: { summary, ...signal, incidentMode: incidentMode.active, response },
        }

        const tasks = [
            createSecurityIncident(incidentInput).catch(() => {}),
            logAction(message.guild, {
                action: "MESSAGE_SHIELD",
                target: { id: message.author.id, tag: message.author.tag || message.author.username },
                reason: summary,
                source: "system",
                metadata: { channelId: message.channel.id, messageId: message.id, incidentMode: incidentMode.active, response, signal },
            }).catch(() => {}),
        ]

        if (severity === "critical" && config.antiNuke.ownerAlerts !== false) {
            tasks.push(notifyOwner(
                message.guild,
                `CURSED blocked coordinated spam in **${message.guild.name}** from ${message.author.tag || message.author.id}.`
            ).catch(() => {}))
        }
        await Promise.allSettled(tasks)
        return true
    } finally {
        recordTiming("security.message-shield", Date.now() - startedAt)
    }
}

module.exports = {
    runSecurityMessageShield,
    effectiveShield,
    signalFor,
    cleanupRuntimeState,
    __testing: process.env.NODE_ENV === "test" ? { windows, cooldowns, normalize } : undefined,
}
