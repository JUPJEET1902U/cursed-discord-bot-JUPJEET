/**
 * utils/welcome.js
 * Professional welcome delivery for CURSED.
 *
 * Existing guild configuration APIs remain synchronous. A configured channel is
 * attempted first, then the guild system channel, then a DM. Exactly one
 * successful destination is used.
 */

const {
    AttachmentBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
} = require("discord.js")
const { getServerConfig, saveConfig } = require("./serverConfig")
const { sendSafe, SAFE_ALLOWED_MENTIONS } = require("./mentionSanitizer")
const { generateWelcomeCard } = require("./welcomeCard")
const logger = require("./logger")
const log = logger.child("Welcome")

const DEFAULT_COLOR = 0x5865F2
const DEFAULT_TITLE = "👋 Welcome to {server}!"
const DEFAULT_MESSAGE = "👋 **Welcome to {server}, {user}!** We're glad you're here. 🎉"

function getWelcome(guildId) {
    const { config } = getServerConfig(guildId)
    return {
        welcomeEnabled: config.welcomeEnabled !== false,
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage: config.welcomeMessage || null,
        welcomeUseAI: config.welcomeUseAI || false,
        welcomeEmbedTitle: config.welcomeEmbedTitle || null,
        welcomeColor: config.welcomeColor || null,
        welcomeThumbnail: config.welcomeThumbnail !== false,
        welcomeImageUrl: config.welcomeImageUrl || null,
        welcomeFooter: config.welcomeFooter || null,
        welcomeCardEnabled: config.welcomeCardEnabled !== false,
        welcomeCardTheme: config.welcomeCardTheme || "classic",
        welcomeCardBackground: config.welcomeCardBackground || null,
        welcomeAccentColor: config.welcomeAccentColor || null,
        welcomeMediaUrl: config.welcomeMediaUrl || null,
        rulesChannelId: config.rulesChannelId || config.welcomeRulesChannelId || null,
        staffRoleId: config.staffRoleId || config.welcomeStaffRoleId || null,
        moderatorRoleIds: Array.isArray(config.moderatorRoleIds) ? config.moderatorRoleIds : [],
    }
}

function setWelcome(guildId, channelId, options = {}) {
    const { data, config } = getServerConfig(guildId)
    config.welcomeEnabled = true
    config.welcomeChannelId = channelId
    config.welcomeMessage = options.message ?? config.welcomeMessage ?? null
    config.welcomeUseAI = options.useAI ?? config.welcomeUseAI ?? false
    config.welcomeEmbedTitle = options.embedTitle ?? config.welcomeEmbedTitle ?? null
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
    config.welcomeEmbedTitle = null
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

function collectionFind(cache, predicate) {
    if (!cache) return null
    if (typeof cache.find === "function") return cache.find(predicate) || null
    if (typeof cache.values === "function") return [...cache.values()].find(predicate) || null
    return null
}

function resolveRulesChannel(member, config = {}) {
    const configuredId = config.rulesChannelId || config.welcomeRulesChannelId
    if (configuredId) return `<#${configuredId}>`

    const found = collectionFind(member.guild?.channels?.cache, channel =>
        channel?.isTextBased?.()
        && /^(rules?|server-rules|rules-and-info|information)$/i.test(String(channel.name || ""))
    )
    return found?.id ? `<#${found.id}>` : "the rules channel"
}

function resolveStaffRole(member, config = {}) {
    const moderatorRoleId = Array.isArray(config.moderatorRoleIds) ? config.moderatorRoleIds[0] : null
    const configuredId = config.staffRoleId || config.welcomeStaffRoleId || moderatorRoleId
    if (configuredId) return `<@&${configuredId}>`

    const found = collectionFind(member.guild?.roles?.cache, role =>
        role?.id !== member.guild?.id
        && /^(staff|moderators?|admins?|support)$/i.test(String(role.name || ""))
    )
    return found?.id ? `<@&${found.id}>` : "the staff team"
}

function discordDate(timestamp, style = "D") {
    const value = Number(timestamp)
    if (!Number.isFinite(value) || value <= 0) return "Unknown"
    return `<t:${Math.floor(value / 1000)}:${style}>`
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function resolvePlaceholders(template, member, config = {}) {
    if (!template) return ""
    const guild = member.guild
    const user = member.user || {}
    const displayName = member.displayName || user.globalName || user.username || "New member"
    const replacements = {
        "{user}": displayName,
        "{username}": user.username || displayName,
        "{mention}": user.id ? `<@${user.id}>` : displayName,
        "{user.id}": user.id || "Unknown",
        "{user.tag}": user.tag || user.username || displayName,
        "{server}": guild?.name || "the server",
        "{memberCount}": String(guild?.memberCount ?? 0),
        "{createdAt}": discordDate(user.createdTimestamp, "D"),
        "{joinedAt}": discordDate(member.joinedTimestamp, "D"),
        "{rulesChannel}": resolveRulesChannel(member, config),
        "{staffRole}": resolveStaffRole(member, config),
    }

    let output = String(template)
    for (const [placeholder, value] of Object.entries(replacements)) {
        output = output.replace(new RegExp(escapeRegex(placeholder), "gi"), String(value))
    }
    return output
}

function parseColor(colorStr) {
    if (!colorStr) return DEFAULT_COLOR
    try {
        const hex = colorStr.replace(/^#/, "")
        const value = parseInt(hex, 16)
        return Number.isNaN(value) ? DEFAULT_COLOR : value
    } catch {
        return DEFAULT_COLOR
    }
}

function buildEmbed(description, member, config, assignedRoleId = null) {
    const guild = member.guild
    const title = resolvePlaceholders(config.welcomeEmbedTitle || DEFAULT_TITLE, member, config).slice(0, 256)
    const resolvedDescription = resolvePlaceholders(description, member, config).slice(0, 4096)
    const embed = new EmbedBuilder()
        .setColor(parseColor(config.welcomeColor))
        .setTitle(title || resolvePlaceholders(DEFAULT_TITLE, member, config))
        .setDescription(resolvedDescription || resolvePlaceholders(DEFAULT_MESSAGE, member, config))
        .setTimestamp()

    if (config.welcomeThumbnail !== false) {
        embed.setThumbnail(member.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 }))
    }
    if (config.welcomeImageUrl) embed.setImage(config.welcomeImageUrl)

    const footerText = config.welcomeFooter
        ? resolvePlaceholders(config.welcomeFooter, member, config)
        : `Member #${guild.memberCount}`
    embed.setFooter({ text: footerText.slice(0, 2048) || `Member #${guild.memberCount}` })

    if (assignedRoleId) {
        embed.addFields({ name: "Role assigned", value: `<@&${assignedRoleId}>`, inline: true })
    }
    return embed
}

function canUseWelcomeChannel(channel, member) {
    if (!channel?.isTextBased?.()) return false
    if ([ChannelType.DM, ChannelType.GroupDM].includes(channel.type)) return false
    const me = member.guild?.members?.me
    if (!me || typeof channel.permissionsFor !== "function") return false
    try {
        const permissions = channel.permissionsFor(me)
        return permissions?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]) === true
    } catch {
        return false
    }
}

function canAttachFiles(channel, member) {
    if (!channel || typeof channel.permissionsFor !== "function") return false
    try {
        return channel.permissionsFor(member.guild?.members?.me)?.has(PermissionFlagsBits.AttachFiles) === true
    } catch {
        return false
    }
}

async function sendTarget(target, payload, type) {
    if (type === "channel") return sendSafe(target, payload)
    const sender = typeof target?.send === "function" ? target : target?.user
    if (!sender || typeof sender.send !== "function") throw new Error("Member DMs are unavailable")
    return sender.send({ ...payload, allowedMentions: SAFE_ALLOWED_MENTIONS })
}

async function sendWelcomeToTarget(target, type, messageText, member, config, assignedRoleId = null) {
    const embed = buildEmbed(messageText, member, config, assignedRoleId)
    const payload = { embeds: [embed] }
    const attachmentsAllowed = type === "dm" || canAttachFiles(target, member)

    if (config.welcomeCardEnabled !== false && attachmentsAllowed) {
        try {
            const card = await generateWelcomeCard(member, config, { assignedRoleId })
            const attachment = new AttachmentBuilder(card, { name: "welcome-card.png" })
            embed.setImage("attachment://welcome-card.png")
            payload.files = [attachment]
        } catch (err) {
            log.warn(`[${member.guild.name}] Welcome card generation failed - sending embed only: ${err.message}`)
        }
    } else if (config.welcomeCardEnabled !== false && type === "channel") {
        log.warn(`[${member.guild.name}] Missing AttachFiles in welcome channel - sending embed only`)
    }

    try {
        await sendTarget(target, payload, type)
        return true
    } catch (err) {
        if (!payload.files) throw err
        log.warn(`[${member.guild.name}] Welcome card send failed - retrying embed only: ${err.message}`)
        await sendTarget(target, { embeds: [buildEmbed(messageText, member, config, assignedRoleId)] }, type)
        return true
    }
}

async function buildWelcomeText(member, config, callAI) {
    const customText = config.welcomeMessage
        ? resolvePlaceholders(config.welcomeMessage, member, config)
        : resolvePlaceholders(DEFAULT_MESSAGE, member, config)

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

            const aiText = String(result.content || "").trim()
            if (aiText) return aiText
        } catch (err) {
            log.warn(`[${member.guild.name}] AI welcome failed — using custom message: ${err.message}`)
        }
    }

    return customText
}

async function fetchConfiguredChannel(member, channelId) {
    if (!channelId) return null
    try {
        return await member.guild.channels.fetch(channelId).catch(() => null)
    } catch {
        return null
    }
}

async function sendWelcome(member, config, callAI, assignedRoleId = null) {
    const { welcomeChannelId } = config
    if (config.welcomeEnabled === false || !welcomeChannelId) return { sent: false, destination: null }

    const messageText = await buildWelcomeText(member, config, callAI)
    const configuredChannel = await fetchConfiguredChannel(member, welcomeChannelId)
    const systemChannel = member.guild.systemChannel || null
    const candidates = []

    for (const channel of [configuredChannel, systemChannel]) {
        if (!channel?.id || candidates.some(existing => existing.id === channel.id)) continue
        candidates.push(channel)
    }

    for (const channel of candidates) {
        if (!canUseWelcomeChannel(channel, member)) {
            log.warn(`[${member.guild.name}] Welcome channel ${channel.id} is unavailable or missing permissions`)
            continue
        }
        try {
            await sendWelcomeToTarget(channel, "channel", messageText, member, config, assignedRoleId)
            return { sent: true, destination: "channel", channelId: channel.id }
        } catch (err) {
            log.warn(`[${member.guild.name}] Welcome delivery failed in ${channel.id}: ${err.message}`)
        }
    }

    try {
        await sendWelcomeToTarget(member, "dm", messageText, member, config, assignedRoleId)
        return { sent: true, destination: "dm", channelId: null }
    } catch (err) {
        log.warn(`[${member.guild.name}] Welcome DM fallback failed for ${member.user.id}: ${err.message}`)
        return { sent: false, destination: null, channelId: null }
    }
}

function buildPreviewEmbed(config, member) {
    const text = config.welcomeMessage
        ? resolvePlaceholders(config.welcomeMessage, member, config)
        : resolvePlaceholders(DEFAULT_MESSAGE, member, config)
    return buildEmbed(text, member, config)
}

async function testWelcome(channel, config, callAI, member) {
    const messageText = await buildWelcomeText(member, config, callAI)
    await sendWelcomeToTarget(channel, "channel", messageText, member, config)
}

module.exports = {
    getWelcome,
    setWelcome,
    disableWelcome,
    sendWelcome,
    testWelcome,
    buildPreviewEmbed,
    resolvePlaceholders,
    DEFAULT_TITLE,
    DEFAULT_MESSAGE,
    _internals: {
        canUseWelcomeChannel,
        buildEmbed,
        buildWelcomeText,
        sendWelcomeToTarget,
        resolveRulesChannel,
        resolveStaffRole,
    },
}
