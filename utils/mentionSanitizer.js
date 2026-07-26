/**
 * utils/mentionSanitizer.js
 * Strong mention abuse prevention for CURSED bot.
 * Sanitizes all AI output and user-facing content to prevent
 * @everyone, @here, role mentions, and raw ID pings.
 */

const logger = require("./logger")
const log = logger.child("MentionSanitizer")

// Zero-width space to break mention syntax
const ZWS = "\u200B"

// Patterns that must never appear in bot output
const DANGEROUS_PATTERNS = [
    { pattern: /@everyone/gi,       replacement: `@${ZWS}everyone`,  label: "@everyone" },
    { pattern: /@here/gi,           replacement: `@${ZWS}here`,      label: "@here" },
    { pattern: /<@!?\d{17,20}>/g,   replacement: "[user]",           label: "user mention" },
    { pattern: /<@&\d{17,20}>/g,    replacement: "[role]",           label: "role mention" },
    { pattern: /<#\d{17,20}>/g,     replacement: "[channel]",        label: "channel mention" },
    { pattern: /\b\d{17,20}\b/g,    replacement: "[id]",             label: "raw snowflake ID" },
]

/**
 * Sanitize text to remove all dangerous Discord mention patterns.
 * @param {string} text
 * @returns {string}
 */
function sanitize(text) {
    if (text === null || text === undefined) return ""
    if (typeof text !== "string") text = String(text)

    let result = text
    let modified = false

    for (const { pattern, replacement, label } of DANGEROUS_PATTERNS) {
        const before = result
        result = result.replace(pattern, replacement)
        if (result !== before) {
            log.warn(`Sanitized dangerous pattern: ${label}`)
            modified = true
        }
    }

    // Truncate to Discord's message limit
    if (result.length > 2000) {
        result = result.slice(0, 1990) + "..."
        log.warn("Message truncated to 2000 chars")
    }

    return result
}

/**
 * Safe allowed_mentions payload — blocks all pings.
 */
const SAFE_ALLOWED_MENTIONS = {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
}

/**
 * Safe allowed_mentions that only pings the message author.
 * @param {string} userId
 */
function authorOnlyMentions(userId) {
    return {
        parse: [],
        users: [userId],
        roles: [],
        repliedUser: false,
    }
}

/**
 * Send a safe message to a channel — no mentions allowed.
 * @param {import("discord.js").TextChannel} channel
 * @param {string|object} content - String or message options object
 * @returns {Promise}
 */
async function sendSafe(channel, content) {
    if (typeof content === "string") {
        return channel.send({
            content: sanitize(content),
            allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
    }
    // Object payload — sanitize content field if present
    const payload = { ...content, allowedMentions: SAFE_ALLOWED_MENTIONS }
    if (payload.content) payload.content = sanitize(payload.content)
    return channel.send(payload)
}

/**
 * Send a safe native Discord reply and notify the replied user by default.
 * The reply ping uses Discord's native reply notification only; the response
 * text still cannot contain user, role, @everyone, or @here mentions.
 * Falls back to one normal channel message if the original message can no
 * longer be referenced. The fallback prevents lost AI responses without
 * sending both a reply and a duplicate channel message.
 * @param {import("discord.js").Message} message
 * @param {string} content
 * @param {object} [opts]
 * @param {boolean} [opts.mentionAuthor]
 * @param {boolean} [opts.fallbackToChannel]
 * @returns {Promise}
 */
async function replySafe(message, content, { mentionAuthor = true, fallbackToChannel = true } = {}) {
    const payload = {
        content: sanitize(content),
        allowedMentions: mentionAuthor
            ? { ...SAFE_ALLOWED_MENTIONS, repliedUser: true }
            : SAFE_ALLOWED_MENTIONS,
        failIfNotExists: false,
    }

    try {
        return await message.reply(payload)
    } catch (error) {
        if (!fallbackToChannel || !message.channel?.send) throw error
        return message.channel.send({
            ...payload,
            allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
    }
}

/**
 * Safe interaction reply.
 * @param {import("discord.js").Interaction} interaction
 * @param {string|object} content
 * @param {object} [opts]
 * @param {boolean} [opts.ephemeral]
 * @param {boolean} [opts.mentionUser]
 * @returns {Promise}
 */
async function interactionReplySafe(interaction, content, { ephemeral = false, mentionUser = false } = {}) {
    const payload = {
        allowedMentions: mentionUser
            ? authorOnlyMentions(interaction.user.id)
            : SAFE_ALLOWED_MENTIONS,
        ephemeral,
    }
    if (typeof content === "string") {
        payload.content = sanitize(content)
    } else {
        Object.assign(payload, content)
        if (payload.content) payload.content = sanitize(payload.content)
    }
    return interaction.reply(payload)
}

/**
 * Safe interaction followUp.
 * @param {import("discord.js").Interaction} interaction
 * @param {string|object} content
 * @param {object} [opts]
 * @returns {Promise}
 */
async function interactionFollowUpSafe(interaction, content, opts = {}) {
    const payload = {
        allowedMentions: SAFE_ALLOWED_MENTIONS,
        ...opts,
    }
    if (typeof content === "string") {
        payload.content = sanitize(content)
    } else {
        Object.assign(payload, content)
        if (payload.content) payload.content = sanitize(payload.content)
    }
    return interaction.followUp(payload)
}

module.exports = {
    sanitize,
    sendSafe,
    replySafe,
    interactionReplySafe,
    interactionFollowUpSafe,
    SAFE_ALLOWED_MENTIONS,
    authorOnlyMentions,
}
