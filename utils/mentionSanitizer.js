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

    for (const { pattern, replacement, label } of DANGEROUS_PATTERNS) {
        const before = result
        result = result.replace(pattern, replacement)
        if (result !== before) {
            log.warn(`Sanitized dangerous pattern: ${label}`)
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
 * Safe allowed_mentions that only pings the message author through an explicit
 * mention. Used only as the fallback when Discord cannot create a reply.
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
 * Safe allowed_mentions for a Discord message reply. Setting repliedUser to
 * true creates the normal Discord reply notification without allowing any
 * arbitrary user, role, @everyone, or @here mentions in the response body.
 * @param {boolean} mentionAuthor
 */
function replyAllowedMentions(mentionAuthor = false) {
    return {
        parse: [],
        users: [],
        roles: [],
        repliedUser: Boolean(mentionAuthor),
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
 * Send a safe reply to the exact triggering message.
 *
 * When mentionAuthor is true Discord shows the standard reply header and sends
 * the normal reply notification to that message author. If the source message
 * was deleted or cannot be referenced, the fallback sends one explicit,
 * author-only mention so the response is not lost or sent to the wrong person.
 *
 * @param {import("discord.js").Message} message
 * @param {string} content
 * @param {object} [opts]
 * @param {boolean} [opts.mentionAuthor]
 * @param {boolean} [opts.fallbackToChannel]
 * @returns {Promise}
 */
async function replySafe(message, content, { mentionAuthor = false, fallbackToChannel = true } = {}) {
    const safeContent = sanitize(content)

    try {
        return await message.reply({
            content: safeContent,
            allowedMentions: replyAllowedMentions(mentionAuthor),
        })
    } catch (error) {
        if (!fallbackToChannel) throw error

        log.warn(`Message reply failed; using safe channel fallback: ${error.message}`)
        const fallbackContent = mentionAuthor
            ? `<@${message.author.id}> ${safeContent}`
            : safeContent

        return message.channel.send({
            content: fallbackContent,
            allowedMentions: mentionAuthor
                ? authorOnlyMentions(message.author.id)
                : SAFE_ALLOWED_MENTIONS,
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
    replyAllowedMentions,
}
