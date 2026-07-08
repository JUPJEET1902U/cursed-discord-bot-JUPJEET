/**
 * utils/welcome.js
 * Welcome system for CURSED bot.
 *
 * Supports:
 *  - Custom welcome messages with placeholders
 *  - Embed messages (prefix message with "embed:")
 *  - AI-generated welcome messages with custom message fallback
 *  - Per-guild configuration stored in serverConfig
 */

const { EmbedBuilder } = require("discord.js")
const { getServerConfig, saveConfig } = require("./serverConfig")
const { sendSafe } = require("./mentionSanitizer")
const logger = require("./logger")
const log = logger.child("Welcome")

// ─── Config helpers ───────────────────────────────────────────────────────────

/**
 * Get the welcome config for a guild.
 * @param {string} guildId
 * @returns {{ welcomeChannelId: string|null, welcomeMessage: string|null, welcomeUseAI: boolean }}
 */
function getWelcome(guildId) {
    const { config } = getServerConfig(guildId)
    return {
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage:   config.welcomeMessage   || null,
        welcomeUseAI:     config.welcomeUseAI     || false,
    }
}

/**
 * Save welcome config for a guild.
 * @param {string} guildId
 * @param {string} channelId
 * @param {string|null} message
 * @param {boolean} useAI
 */
function setWelcome(guildId, channelId, message, useAI) {
    const { data, config } = getServerConfig(guildId)
    config.welcomeChannelId = channelId
    config.welcomeMessage   = message  || null
    config.welcomeUseAI     = useAI    || false
    saveConfig(data)
}

/**
 * Remove welcome config for a guild.
 * @param {string} guildId
 */
function disableWelcome(guildId) {
    const { data, config } = getServerConfig(guildId)
    config.welcomeChannelId = null
    config.welcomeMessage   = null
    config.welcomeUseAI     = false
    saveConfig(data)
}

// ─── Placeholder resolution ───────────────────────────────────────────────────

/**
 * Replace supported placeholders in a message string.
 * Supported: {user}, {username}, {mention}, {server}, {membercount}
 * @param {string} template
 * @param {import("discord.js").GuildMember} member
 * @returns {string}
 */
function resolvePlaceholders(template, member) {
    const guild = member.guild
    return template
        .replace(/\{user\}/gi,        member.displayName || member.user.username)
        .replace(/\{username\}/gi,    member.user.username)
        .replace(/\{mention\}/gi,     `<@${member.user.id}>`)
        .replace(/\{server\}/gi,      guild.name)
        .replace(/\{membercount\}/gi, String(guild.memberCount))
}

// ─── Message sending ──────────────────────────────────────────────────────────

/**
 * Build and send a welcome message to a channel.
 * If the message starts with "embed:", parse it as an embed description.
 * @param {import("discord.js").TextBasedChannel} channel
 * @param {string} messageText  - Resolved (placeholders already replaced) message
 * @param {import("discord.js").GuildMember} member
 * @returns {Promise<void>}
 */
async function sendWelcomeMessage(channel, messageText, member) {
    if (messageText.startsWith("embed:")) {
        const description = messageText.slice("embed:".length).trim()
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`👋 Welcome to ${member.guild.name}!`)
            .setDescription(description)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Member #${member.guild.memberCount}` })
            .setTimestamp()
        await sendSafe(channel, { embeds: [embed] })
    } else {
        await sendSafe(channel, messageText)
    }
}

/**
 * Send a welcome message for a new member using the guild's welcome config.
 * If useAI is true, attempts an AI-generated message and falls back to the
 * custom message on failure. Silently skips if the channel is missing or the
 * bot lacks permissions.
 *
 * @param {import("discord.js").GuildMember} member
 * @param {{ welcomeChannelId: string, welcomeMessage: string|null, welcomeUseAI: boolean }} config
 * @param {Function} callAI  - The callAI function from utils/ai
 * @returns {Promise<void>}
 */
async function sendWelcome(member, config, callAI) {
    const { welcomeChannelId, welcomeMessage, welcomeUseAI } = config

    if (!welcomeChannelId) return

    // Resolve channel — silently skip if deleted or inaccessible
    let channel
    try {
        channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null)
    } catch {
        channel = null
    }

    if (!channel) {
        log.warn(`[${member.guild.name}] Welcome channel ${welcomeChannelId} not found — skipping`)
        return
    }

    // Check bot permissions
    const perms = channel.permissionsFor(member.guild.members.me)
    if (!perms || !perms.has("SendMessages")) {
        log.warn(`[${member.guild.name}] Missing SendMessages in welcome channel — skipping`)
        return
    }

    const fallbackMessage = welcomeMessage
        ? resolvePlaceholders(welcomeMessage, member)
        : `👋 **Welcome to ${member.guild.name}, ${member.displayName || member.user.username}!** CURSED is watching you. 👀`

    if (welcomeUseAI && typeof callAI === "function") {
        try {
            const name = member.displayName || member.user.username
            const result = await callAI([
                {
                    role: "system",
                    content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. Keep it to 2-3 sentences, funny but not mean. Never use @mentions or Discord IDs."
                },
                { role: "user", content: `Welcome this new member: ${name}` }
            ], { maxTokens: 150 })

            const aiText = result.content || fallbackMessage
            await sendWelcomeMessage(channel, aiText, member)
            return
        } catch (err) {
            log.error(`[${member.guild.name}] AI welcome failed, using custom message: ${err.message}`)
            // Fall through to custom message
        }
    }

    try {
        await sendWelcomeMessage(channel, fallbackMessage, member)
    } catch (err) {
        log.error(`[${member.guild.name}] Failed to send welcome message: ${err.message}`)
    }
}

/**
 * Send a test welcome message in the given channel using the guild's config.
 * Uses the interaction member as the "new member" for placeholder resolution.
 *
 * @param {import("discord.js").TextBasedChannel} channel
 * @param {{ welcomeChannelId: string, welcomeMessage: string|null, welcomeUseAI: boolean }} config
 * @param {Function} callAI
 * @param {import("discord.js").GuildMember} member  - The member triggering the test
 * @returns {Promise<void>}
 */
async function testWelcome(channel, config, callAI, member) {
    const { welcomeMessage, welcomeUseAI } = config

    const fallbackMessage = welcomeMessage
        ? resolvePlaceholders(welcomeMessage, member)
        : `👋 **Welcome to ${member.guild.name}, ${member.displayName || member.user.username}!** CURSED is watching you. 👀`

    if (welcomeUseAI && typeof callAI === "function") {
        try {
            const name = member.displayName || member.user.username
            const result = await callAI([
                {
                    role: "system",
                    content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. Keep it to 2-3 sentences, funny but not mean. Never use @mentions or Discord IDs."
                },
                { role: "user", content: `Welcome this new member: ${name}` }
            ], { maxTokens: 150 })

            const aiText = result.content || fallbackMessage
            await sendWelcomeMessage(channel, aiText, member)
            return
        } catch (err) {
            log.error(`Test welcome AI failed, using custom message: ${err.message}`)
            // Fall through to custom message
        }
    }

    await sendWelcomeMessage(channel, fallbackMessage, member)
}

module.exports = { getWelcome, setWelcome, disableWelcome, sendWelcome, testWelcome }
