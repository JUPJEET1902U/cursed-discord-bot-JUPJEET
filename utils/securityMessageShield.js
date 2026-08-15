const { PermissionFlagsBits } = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { neutralizeExecutor, notifyOwner } = require("./securityResponse")
const { createSecurityIncident } = require("./securityIncidents")
const { getIncidentModeState } = require("./securityRecoverySuite")
const { logAction } = require("./modlog")

const windows = new Map()
const guildWindows = new Map()
const cooldowns = new Map()
const guildAlertCooldowns = new Map()
const INVITE_REGEX = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]{2,32}/gi
const LINK_REGEX = /https?:\/\/\S+|www\.\S+\.\S+/gi

function normalize(content) {
    return String(content || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500)
}

function keyFor(message) {
    return `${message.guild.id}:${message.author.id}`
}

function prune(records, windowMs) {
    const cutoff = Date.now() - windowMs
    return records.filter(record => record.at >= cutoff)
}

function pruneCooldownMap(map, ttlMs, maxSize = 5000) {
    const cutoff = Date.now() - ttlMs
    if (map.size <= maxSize) return
    for (const [key, timestamp] of map) {
        if (timestamp < cutoff) map.delete(key)
    }
    while (map.size > maxSize) map.delete(map.keys().next().value)
}

function countMatches(regex, content) {
    regex.lastIndex = 0
    return [...String(content || "").matchAll(regex)].length
}

function messageMentionCount(message, shield) {
    return message.mentions.users.size
        + message.mentions.roles.size
        + (message.mentions.everyone ? shield.maxMentions : 0)
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
        invites: countMatches(INVITE_REGEX, message.content),
        links: countMatches(LINK_REGEX, message.content),
    }
    const records = prune(windows.get(key) || [], windowMs)
    records.push(record)
    windows.set(key, records.slice(-30))

    const repeated = content ? records.filter(item => item.content === content).length : 0
    const invites = records.reduce((sum, item) => sum + item.invites, 0)
    const links = records.reduce((sum, item) => sum + item.links, 0)
    const mentions = messageMentionCount(message, shield)
    const rapid = records.length
    const isBot = message.author.bot

    const triggered = mentions >= shield.maxMentions
        || repeated >= shield.repeatedMessageThreshold
        || rapid >= shield.rapidMessageThreshold
        || invites >= (isBot ? shield.botInviteThreshold : shield.inviteThreshold)
        || links >= shield.linkThreshold

    if (!triggered) return null
    return { repeated, invites, links, mentions, rapid, windowSeconds: shield.windowSeconds }
}

function coordinatedSignalFor(message, shield, incidentMode = { active: false }) {
    const guildId = message.guild.id
    const windowMs = shield.windowSeconds * 1000
    const content = normalize(message.content)
    const record = {
        at: Date.now(),
        authorId: String(message.author.id),
        content,
        invites: countMatches(INVITE_REGEX, message.content),
        links: countMatches(LINK_REGEX, message.content),
        mentions: messageMentionCount(message, shield),
    }
    const records = prune(guildWindows.get(guildId) || [], windowMs)
    records.push(record)
    guildWindows.set(guildId, records.slice(-180))

    const distinctAuthors = new Set(records.map(item => item.authorId)).size
    const minimumAuthors = incidentMode?.active ? 2 : 3
    if (distinctAuthors < minimumAuthors) return null

    const sameContentAuthors = content.length >= 8
        ? new Set(records.filter(item => item.content === content).map(item => item.authorId)).size
        : 0
    const inviteAuthors = new Set(records.filter(item => item.invites > 0).map(item => item.authorId)).size
    const linkAuthors = new Set(records.filter(item => item.links > 0).map(item => item.authorId)).size
    const mentionAuthors = new Set(records.filter(item => item.mentions > 0).map(item => item.authorId)).size
    const totalInvites = records.reduce((sum, item) => sum + item.invites, 0)
    const totalLinks = records.reduce((sum, item) => sum + item.links, 0)
    const totalMentions = records.reduce((sum, item) => sum + item.mentions, 0)

    const repeatAuthorsThreshold = minimumAuthors
    const inviteThreshold = incidentMode?.active
        ? Math.max(2, shield.inviteThreshold)
        : Math.max(3, shield.inviteThreshold)
    const linkThreshold = incidentMode?.active
        ? Math.max(3, shield.linkThreshold)
        : Math.max(6, shield.linkThreshold)
    const mentionThreshold = incidentMode?.active
        ? Math.max(5, shield.maxMentions + 2)
        : Math.max(8, shield.maxMentions * 2)

    const repeatedTrigger = sameContentAuthors >= repeatAuthorsThreshold
    const inviteTrigger = record.invites > 0 && inviteAuthors >= minimumAuthors && totalInvites >= inviteThreshold
    const linkTrigger = record.links > 0 && linkAuthors >= minimumAuthors && totalLinks >= linkThreshold
    const mentionTrigger = record.mentions > 0 && mentionAuthors >= minimumAuthors && totalMentions >= mentionThreshold

    if (!repeatedTrigger && !inviteTrigger && !linkTrigger && !mentionTrigger) return null
    return {
        coordinated: true,
        distinctAuthors,
        sameContentAuthors,
        inviteAuthors,
        linkAuthors,
        mentionAuthors,
        totalInvites,
        totalLinks,
        totalMentions,
        repeatedTrigger,
        inviteTrigger,
        linkTrigger,
        mentionTrigger,
        windowSeconds: shield.windowSeconds,
    }
}

function shouldAlertGuild(guildId, cooldownMs = 30_000) {
    const currentTime = Date.now()
    const last = guildAlertCooldowns.get(guildId) || 0
    if (currentTime - last < cooldownMs) return false
    guildAlertCooldowns.set(guildId, currentTime)
    pruneCooldownMap(guildAlertCooldowns, 10 * 60_000, 2000)
    return true
}

async function runSecurityMessageShield(message) {
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
    const individualSignal = signalFor(message, shield)
    const coordinatedSignal = coordinatedSignalFor(message, shield, incidentMode)
    const signal = individualSignal || coordinatedSignal
    if (!signal) return false

    const cooldownKey = keyFor(message)
    const last = cooldowns.get(cooldownKey) || 0
    if (Date.now() - last < shield.windowSeconds * 1000) {
        if (message.deletable) await message.delete().catch(() => {})
        return true
    }
    cooldowns.set(cooldownKey, Date.now())
    pruneCooldownMap(cooldowns, Math.max(60_000, shield.windowSeconds * 4000), 5000)

    if (message.deletable && message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await message.delete().catch(() => {})
    }

    const modeText = incidentMode.active ? " Incident mode sensitivity was active." : ""
    const summary = coordinatedSignal
        ? `Coordinated raid shield triggered across ${coordinatedSignal.distinctAuthors} accounts in ${coordinatedSignal.windowSeconds}s: ${coordinatedSignal.totalInvites} invites, ${coordinatedSignal.totalLinks} links and ${coordinatedSignal.totalMentions} mentions.${modeText}`
        : `Advert/spam shield triggered: ${individualSignal.rapid} messages, ${individualSignal.repeated} repeated, ${individualSignal.invites} invites, ${individualSignal.links} links and ${individualSignal.mentions} mentions within ${individualSignal.windowSeconds}s.${modeText}`
    const response = member
        ? await neutralizeExecutor(message.guild, member, config, {
            reason: `Message Shield: ${summary}`,
            actor: { id: message.guild.members.me?.id, tag: "CURSED Message Shield" },
        })
        : { ok: false, action: "alert", error: "Member unavailable" }

    await createSecurityIncident({
        guildId: message.guild.id,
        type: coordinatedSignal
            ? "COORDINATED_MESSAGE_RAID"
            : incidentMode.active ? "INCIDENT_MODE_MESSAGE_SHIELD" : "MESSAGE_SHIELD",
        severity: coordinatedSignal || message.author.bot || incidentMode.active ? "critical" : "high",
        executorId: message.author.id,
        executorTag: message.author.tag || message.author.username,
        targetId: message.channel.id,
        targetTag: message.channel.name || "channel",
        actionTaken: response.ok ? "neutralize" : "alert",
        details: {
            summary,
            ...(individualSignal || {}),
            coordinated: coordinatedSignal || null,
            incidentMode: incidentMode.active,
            response,
        },
    }).catch(() => {})

    await logAction(message.guild, {
        action: coordinatedSignal ? "COORDINATED_MESSAGE_RAID" : "MESSAGE_SHIELD",
        target: { id: message.author.id, tag: message.author.tag || message.author.username },
        reason: summary,
        source: "system",
        metadata: {
            channelId: message.channel.id,
            messageId: message.id,
            incidentMode: incidentMode.active,
            coordinated: Boolean(coordinatedSignal),
            response,
        },
    }).catch(() => {})

    if (config.antiNuke.ownerAlerts !== false && (!coordinatedSignal || shouldAlertGuild(message.guild.id))) {
        await notifyOwner(message.guild, `🚨 CURSED blocked ${coordinatedSignal ? "a coordinated message raid" : "advertising/spam"} in **${message.guild.name}** from ${message.author.tag || message.author.id}. ${summary}`)
    }
    return true
}

module.exports = {
    runSecurityMessageShield,
    effectiveShield,
    signalFor,
    coordinatedSignalFor,
}
