const { logAction } = require("./modlog")

const userStates = new Map()
const LINK_REGEX = /https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi
const INVITE_REGEX = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]{2,32}/gi
const EMOJI_REGEX = /(?:<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic})/gu
const ADVERTISEMENT_REGEX = /(?:discord\.gg|join\s+my|free\s+nitro|dm\s+me|\.gg\/)/i

function stateKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function normalizeDuplicateText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, "[link]")
        .replace(/<@!?\d+>/g, "[mention]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500)
}

function decayState(state, config, now) {
    const elapsed = Math.max(0, now - state.lastAt)
    const decayMs = Math.max(10, config.decaySeconds) * 1000
    const amount = Math.floor(elapsed / decayMs)
    if (amount > 0) state.heat = Math.max(0, state.heat - amount)
    state.lastAt = now
    return state
}

function getState(message, config, now = Date.now()) {
    const key = stateKey(message.guild.id, message.author.id)
    const state = decayState(userStates.get(key) || {
        heat: 0,
        lastAt: now,
        messages: [],
        lastAction: null,
        lastActionAt: 0,
    }, config, now)
    const keepMs = Math.max(
        config.duplicateWindowSeconds,
        config.limits.messageWindowSeconds,
        config.decaySeconds * 3
    ) * 1000
    state.messages = state.messages.filter(item => now - item.at <= keepMs)
    userStates.set(key, state)
    return state
}

function hostnameAllowed(link, whitelist) {
    try {
        const url = link.startsWith("http") ? link : `https://${link}`
        const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
        return (whitelist || []).some(item => hostname === item || hostname.endsWith(`.${item}`))
    } catch {
        return false
    }
}

function countMentions(message) {
    return (message.mentions?.users?.size || 0)
        + (message.mentions?.roles?.size || 0)
        + (message.mentions?.everyone ? 1 : 0)
}

function capsPercent(content) {
    const letters = String(content || "").match(/[a-z]/gi) || []
    if (letters.length < 12) return 0
    const upper = letters.filter(letter => letter === letter.toUpperCase()).length
    return Math.round((upper / letters.length) * 100)
}

function analyzeMessage(message, config, linkWhitelist = []) {
    const now = Date.now()
    const state = getState(message, config, now)
    const content = String(message.content || "")
    const normalized = normalizeDuplicateText(content)
    const violations = []
    let addedHeat = 0

    const add = (type, detail) => {
        const points = Number(config.heat[type]) || 0
        if (points <= 0) return
        violations.push({ type, points, detail })
        addedHeat += points
    }

    const recentRapid = state.messages.filter(item => now - item.at <= config.limits.messageWindowSeconds * 1000)
    if (config.filters.rapidSpam && recentRapid.length + 1 >= config.limits.messages) {
        add("rapidSpam", `${recentRapid.length + 1} messages in ${config.limits.messageWindowSeconds}s`)
    }

    if (config.filters.duplicateSpam && normalized.length >= 4) {
        const duplicates = state.messages.filter(item =>
            item.normalized === normalized && now - item.at <= config.duplicateWindowSeconds * 1000
        ).length + 1
        if (duplicates >= config.limits.duplicates) add("duplicateSpam", `${duplicates} repeated messages`)
    }

    const mentions = countMentions(message)
    if (config.filters.mentionSpam && mentions >= config.limits.mentions) add("mentionSpam", `${mentions} mentions`)

    const caps = capsPercent(content)
    if (config.filters.capsSpam && caps >= config.limits.capsPercent) add("capsSpam", `${caps}% uppercase`)

    const emojiCount = (content.match(EMOJI_REGEX) || []).length
    if (config.filters.emojiSpam && emojiCount >= config.limits.emojis) add("emojiSpam", `${emojiCount} emoji`)

    const newlineCount = (content.match(/\n/g) || []).length
    if (config.filters.newlineSpam && newlineCount >= config.limits.newlines) add("newlineSpam", `${newlineCount} newlines`)

    const combiningCount = (content.match(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g) || []).length
    if (config.filters.zalgo && combiningCount >= 8) add("zalgo", `${combiningCount} combining characters`)

    const attachmentCount = message.attachments?.size || 0
    if (config.filters.attachmentSpam && attachmentCount >= config.limits.attachments) add("attachmentSpam", `${attachmentCount} attachments`)

    if (config.filters.invites) {
        INVITE_REGEX.lastIndex = 0
        if (INVITE_REGEX.test(content)) add("invite", "Discord invite")
    }

    if (config.filters.links) {
        LINK_REGEX.lastIndex = 0
        const links = content.match(LINK_REGEX) || []
        const blocked = links.filter(link => !hostnameAllowed(link, linkWhitelist))
        if (blocked.length) add("link", `${blocked.length} unapproved link(s)`)
    }

    state.messages.push({ at: now, normalized, messageId: message.id, channelId: message.channel.id })
    state.heat += addedHeat
    userStates.set(stateKey(message.guild.id, message.author.id), state)

    return {
        state,
        violations,
        addedHeat,
        heat: state.heat,
        advertisement: ADVERTISEMENT_REGEX.test(content),
    }
}

function resolveAction(actions, heat) {
    return [...(actions || [])]
        .filter(item => heat >= item.heat)
        .sort((a, b) => b.heat - a.heat)[0] || null
}

async function safeDelete(message) {
    if (!message.deletable) return false
    try {
        await message.delete()
        return true
    } catch {
        return false
    }
}

async function notifyMember(message, action, heat, violations) {
    const reason = violations.map(item => item.type).join(", ")
    const content = `🛡️ CURSED AutoMod detected **${reason || "suspicious activity"}** in **${message.guild.name}**. Action: **${action}**. Heat: **${heat}**.`
    await message.author.send({ content, allowedMentions: { parse: [] } }).catch(() => {})
}

async function runHeatAutoMod(message, fortressConfig, legacyConfig = {}) {
    const config = fortressConfig?.automod
    if (!config?.enabled || !message.guild || message.author.bot) return { active: false, handled: false }

    const result = analyzeMessage(message, config, legacyConfig.linkWhitelist || [])
    if (!result.violations.length) return { active: true, handled: false, ...result }

    const actionRule = resolveAction(config.actions, result.heat)
    const action = actionRule?.action || (config.deleteViolations ? "delete" : "warn")
    const reason = `Fortress AutoMod: ${result.violations.map(item => item.type).join(", ")} (heat ${result.heat})`
    const target = { id: message.author.id, tag: message.author.tag || message.author.username }
    let actionTaken = config.dryRun ? "dry-run" : action
    let actionError = null

    if (!config.dryRun) {
        if (config.deleteViolations || ["delete", "warn", "timeout", "kick", "ban"].includes(action)) {
            await safeDelete(message)
        }

        try {
            if (action === "timeout") {
                const durationMs = Math.max(1, Math.min(40320, actionRule.durationMinutes || 10)) * 60_000
                if (!message.member?.moderatable) throw new Error("Member cannot be timed out because of role hierarchy.")
                await message.member.timeout(durationMs, reason.slice(0, 512))
            } else if (action === "kick") {
                if (!message.member?.kickable) throw new Error("Member cannot be kicked because of role hierarchy.")
                await message.member.kick(reason.slice(0, 512))
            } else if (action === "ban") {
                if (!message.member?.bannable) throw new Error("Member cannot be banned because of role hierarchy.")
                await message.member.ban({ reason: reason.slice(0, 512), deleteMessageSeconds: 0 })
            } else if (action === "warn") {
                await message.channel.send({
                    content: `⚠️ <@${message.author.id}> AutoMod warning • heat **${result.heat}**.`,
                    allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
                }).catch(() => {})
            }
        } catch (err) {
            actionError = err.message
            actionTaken = `delete-only (${err.message})`
        }
        await notifyMember(message, actionTaken, result.heat, result.violations)
    }

    await logAction(message.guild, {
        action: `FORTRESS_AUTOMOD_${String(action).toUpperCase()}`,
        target,
        reason,
        source: "automod",
        durationMs: action === "timeout" ? (actionRule.durationMinutes || 10) * 60_000 : null,
        metadata: {
            channelId: message.channel.id,
            messageId: message.id,
            heat: result.heat,
            addedHeat: result.addedHeat,
            violations: result.violations,
            dryRun: config.dryRun,
            actionError,
        },
    })

    const state = result.state
    state.lastAction = actionTaken
    state.lastActionAt = Date.now()
    userStates.set(stateKey(message.guild.id, message.author.id), state)

    return { active: true, handled: !config.dryRun, action: actionTaken, actionError, ...result }
}

function getUserHeat(guildId, userId) {
    const state = userStates.get(stateKey(guildId, userId))
    return state ? { ...state, messages: [...state.messages] } : null
}

function resetUserHeat(guildId, userId) {
    return userStates.delete(stateKey(guildId, userId))
}

function cleanupHeatStates() {
    const cutoff = Date.now() - 60 * 60_000
    for (const [key, state] of userStates.entries()) {
        if (state.lastAt < cutoff) userStates.delete(key)
    }
}

const cleanupTimer = setInterval(cleanupHeatStates, 10 * 60_000)
cleanupTimer.unref?.()

module.exports = {
    analyzeMessage,
    resolveAction,
    runHeatAutoMod,
    getUserHeat,
    resetUserHeat,
    cleanupHeatStates,
}
