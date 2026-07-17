/**
 * utils/welcome.js
 * Welcome system for CURSED bot — production-ready rich embed implementation.
 *
 * Features:
 *  - Rich Discord embeds (configurable color, thumbnail, image, footer, timestamp)
 *  - AI-generated welcome message with automatic fallback to custom message
 *  - Custom message with placeholder variables
 *  - Per-guild configuration stored in serverConfig.json
 *  - Never crashes — all errors are caught and logged
 *
 * Placeholders: {user} {username} {mention} {server} {membercount}
 */

const { AttachmentBuilder, EmbedBuilder } = require("discord.js")
const { getServerConfig, saveConfig } = require("./serverConfig")
const { sendSafe } = require("./mentionSanitizer")
const { generateWelcomeCard } = require("./welcomeCard")
const logger = require("./logger")
const log = logger.child("Welcome")

const DEFAULT_COLOR = 0x5865F2
const DEFAULT_MESSAGE = "👋 **Welcome to {server}, {user}!** We're glad you're here. 🎉"

function getWelcome(guildId) {
    const { config } = getServerConfig(guildId)
    return {
        welcomeEnabled: config.welcomeEnabled !== false,
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage: config.welcomeMessage || null,
        welcomeUseAI: config.welcomeUseAI || false,
        welcomeColor: config.welcomeColor || null,
        welcomeThumbnail: config.welcomeThumbnail !== false,
        welcomeImageUrl: config.welcomeImageUrl || null,
        welcomeFooter: config.welcomeFooter || null,
        welcomeCardEnabled: config.welcomeCardEnabled !== false,
        welcomeCardTheme: config.welcomeCardTheme || "classic",
        welcomeCardBackground: config.welcomeCardBackground || null,
        welcomeAccentColor: config.welcomeAccentColor || null,
        welcomeMediaUrl: config.welcomeMediaUrl || null,
    }
}

function setWelcome(guildId, channelId, options = {}) {
    const { data, config } = getServerConfig(guildId)
    config.welcomeEnabled = true
    config.welcomeChannelId = channelId
    config.welcomeMessage = options.message ?? config.welcomeMessage ?? null
    config.welcomeUseAI = options.useAI ?? config.welcomeUseAI ?? false
    config.welcomeColor = options.color ?? config.welcomeColor ?? null
    config.welcomeThumbnail = options.thumbnail ?? config.welcomeThumbnail ?? true
    config.welcomeImageUrl = options.imageUrl ?? config.welcomeImageUrl ?? null
    config.welcomeFooter = options.footer ?? config.welcomeFooter ?? null
    config.welcomeCardEnabled = options.cardEnabled ?? config.welcomeCardEnabled ?? true
    config.welcomeCardTheme = options.cardTheme ?? config.welcomeCardTheme ?? "classic"
    config.welcomeCardBackground = options.cardBackground ?? config.welcomeCardBackground ?? null
    config.welcomeAccentColor = options.accentColor ?? config.welcomeAccentColor ?? null
    config.welcomeMediaUrl = options.mediaUrl ?? config.welcomeMediaUrl ?? null
    saveConfig(data)
}

function disableWelcome(guildId) {
    const { data, config } = getServerConfig(guildId)
    config.welcomeEnabled = false
    config.welcomeChannelId = null
    config.welcomeMessage = null
    config.welcomeUseAI = false
    config.welcomeColor = null
    config.welcomeThumbnail = true
    config.welcomeImageUrl = null
    config.welcomeFooter = null
    config.welcomeCardEnabled = true
    config.welcomeCardTheme = "classic"
    config.welcomeCardBackground = null
    config.welcomeAccentColor = null
    config.welcomeMediaUrl = null
    saveConfig(data)
}

function resolvePlaceholders(template, member) {
    if (!template) return ""
    const guild = member.guild
    return template
        .replace(/\{user\}/gi, member.displayName || member.user.username)
        .replace(/\{username\}/gi, member.user.username)
        .replace(/\{mention\}/gi, `<@${member.user.id}>`)
        .replace(/\{server\}/gi, guild.name)
        .replace(/\{membercount\}/gi, String(guild.memberCount))
}

function parseColor(colorStr) {
    if (!colorStr) return DEFAULT_COLOR
    try {
        const hex = colorStr.replace(/^#/, "")
        const value = parseInt(hex, 16)
        return isNaN(value) ? DEFAULT_COLOR : value
    } catch {
        return DEFAULT_COLOR
    }
}

function buildEmbed(description, member, cfg, assignedRoleId = null) {
    const guild = member.guild
    const embed = new EmbedBuilder()
        .setColor(parseColor(cfg.welcomeColor))
        .setTitle(`👋 Welcome to ${guild.name}!`)
        .setDescription(description)
        .setTimestamp()

    if (cfg.welcomeThumbnail !== false) {
        embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    }
    if (cfg.welcomeImageUrl) embed.setImage(cfg.welcomeImageUrl)

    const footerText = cfg.welcomeFooter
        ? resolvePlaceholders(cfg.welcomeFooter, member)
        : `Member #${guild.memberCount}`
    embed.setFooter({ text: footerText })

    if (assignedRoleId) {
        embed.addFields({ name: "Role assigned", value: `<@&${assignedRoleId}>`, inline: true })
    }
    return embed
}

async function sendWelcomeEmbed(channel, messageText, member, cfg, assignedRoleId = null) {
    const embed = buildEmbed(messageText, member, cfg, assignedRoleId)
    const payload = { embeds: [embed] }
    const perms = channel.permissionsFor?.(member.guild.members.me)
    const canAttachFiles = !perms || perms.has("AttachFiles")

    if (cfg.welcomeCardEnabled !== false && canAttachFiles) {
        try {
            const card = await generateWelcomeCard(member, cfg, { assignedRoleId })
            const attachment = new AttachmentBuilder(card, { name: "welcome-card.png" })
            embed.setImage("attachment://welcome-card.png")
            payload.files = [attachment]
        } catch (err) {
            log.warn(`[${member.guild.name}] Welcome card generation failed - sending embed only: ${err.message}`)
        }
    } else if (cfg.welcomeCardEnabled !== false) {
        log.warn(`[${member.guild.name}] Missing AttachFiles in welcome channel - sending embed only`)
    }

    try {
        await sendSafe(channel, payload)
    } catch (err) {
        if (!payload.files) throw err
        log.warn(`[${member.guild.name}] Welcome card send failed - retrying embed only: ${err.message}`)
        await sendSafe(channel, { embeds: [buildEmbed(messageText, member, cfg, assignedRoleId)] })
    }
}

async function sendWelcome(member, config, callAI, assignedRoleId = null) {
    const { welcomeChannelId } = config
    if (config.welcomeEnabled === false || !welcomeChannelId) return

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

    const perms = channel.permissionsFor(member.guild.members.me)
    if (!perms || !perms.has("SendMessages") || !perms.has("EmbedLinks")) {
        log.warn(`[${member.guild.name}] Missing SendMessages/EmbedLinks in welcome channel — skipping`)
        return
    }

    const customText = config.welcomeMessage
        ? resolvePlaceholders(config.welcomeMessage, member)
        : resolvePlaceholders(DEFAULT_MESSAGE, member)

    if (config.welcomeUseAI && typeof callAI === "function") {
        try {
            const name = member.displayName || member.user.username
            const result = await callAI([
                {
                    role: "system",
                    content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. Keep it to 2-3 sentences, funny but not mean. Never use @mentions or Discord IDs.",
                },
                { role: "user", content: `Welcome this new member: ${name}` },
            ], { maxTokens: 150 })

            const aiText = (result.content || "").trim()
            if (aiText) {
                await sendWelcomeEmbed(channel, aiText, member, config, assignedRoleId)
                return
            }
        } catch (err) {
            log.warn(`[${member.guild.name}] AI welcome failed — using custom message: ${err.message}`)
        }
    }

    try {
        await sendWelcomeEmbed(channel, customText, member, config, assignedRoleId)
    } catch (err) {
        log.error(`[${member.guild.name}] Failed to send welcome message: ${err.message}`)
    }
}

function buildPreviewEmbed(config, member) {
    const text = config.welcomeMessage
        ? resolvePlaceholders(config.welcomeMessage, member)
        : resolvePlaceholders(DEFAULT_MESSAGE, member)
    return buildEmbed(text, member, config)
}

async function testWelcome(channel, config, callAI, member) {
    const customText = config.welcomeMessage
        ? resolvePlaceholders(config.welcomeMessage, member)
        : resolvePlaceholders(DEFAULT_MESSAGE, member)

    if (config.welcomeUseAI && typeof callAI === "function") {
        try {
            const name = member.displayName || member.user.username
            const result = await callAI([
                {
                    role: "system",
                    content: "You are CURSED, a Discord bot. Welcome new members warmly but roast them gently. Keep it to 2-3 sentences, funny but not mean. Never use @mentions or Discord IDs.",
                },
                { role: "user", content: `Welcome this new member: ${name}` },
            ], { maxTokens: 150 })

            const aiText = (result.content || "").trim()
            if (aiText) {
                await sendWelcomeEmbed(channel, aiText, member, config)
                return
            }
        } catch (err) {
            log.warn(`Test welcome AI failed — using custom message: ${err.message}`)
        }
    }

    await sendWelcomeEmbed(channel, customText, member, config)
}

module.exports = {
    getWelcome,
    setWelcome,
    disableWelcome,
    sendWelcome,
    testWelcome,
    buildPreviewEmbed,
    resolvePlaceholders,
}
