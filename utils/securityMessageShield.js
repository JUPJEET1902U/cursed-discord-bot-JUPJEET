const { PermissionFlagsBits } = require("discord.js")
const { getSecurityPhase3Config, isTrustedForScope } = require("./securityPhase3Config")
const { neutralizeExecutor, notifyOwner } = require("./securityResponse")
const { createSecurityIncident } = require("./securityIncidents")
const { logAction } = require("./modlog")

const windows = new Map()
const cooldowns = new Map()
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

function countMatches(regex, content) {
    regex.lastIndex = 0
    return [...String(content || "").matchAll(regex)].length
}

function signalFor(message, config) {
    const shield = config.messageShield
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
    const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? shield.maxMentions : 0)
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

    const signal = signalFor(message, config)
    if (!signal) return false

    const cooldownKey = keyFor(message)
    const last = cooldowns.get(cooldownKey) || 0
    if (Date.now() - last < config.messageShield.windowSeconds * 1000) {
        if (message.deletable) await message.delete().catch(() => {})
        return true
    }
    cooldowns.set(cooldownKey, Date.now())

    if (message.deletable && message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await message.delete().catch(() => {})
    }

    const summary = `Coordinated advert/spam shield triggered: ${signal.rapid} messages, ${signal.repeated} repeated, ${signal.invites} invites, ${signal.links} links and ${signal.mentions} mentions within ${signal.windowSeconds}s.`
    const response = member
        ? await neutralizeExecutor(message.guild, member, config, {
            reason: `Message Shield: ${summary}`,
            actor: { id: message.guild.members.me?.id, tag: "CURSED Message Shield" },
        })
        : { ok: false, action: "alert", error: "Member unavailable" }

    await createSecurityIncident({
        guildId: message.guild.id,
        type: "MESSAGE_SHIELD",
        severity: message.author.bot ? "critical" : "high",
        executorId: message.author.id,
        executorTag: message.author.tag || message.author.username,
        targetId: message.channel.id,
        targetTag: message.channel.name || "channel",
        actionTaken: response.ok ? "neutralize" : "alert",
        details: { summary, ...signal, response },
    }).catch(() => {})

    await logAction(message.guild, {
        action: "MESSAGE_SHIELD",
        target: { id: message.author.id, tag: message.author.tag || message.author.username },
        reason: summary,
        source: "system",
        metadata: { channelId: message.channel.id, messageId: message.id, response },
    }).catch(() => {})

    if (config.antiNuke.ownerAlerts !== false) {
        await notifyOwner(message.guild, `🚨 CURSED blocked coordinated advertising/spam in **${message.guild.name}** from ${message.author.tag || message.author.id}. ${summary}`)
    }
    return true
}

module.exports = { runSecurityMessageShield }
