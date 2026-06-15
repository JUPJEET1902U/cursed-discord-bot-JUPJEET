/**
 * @fileoverview Standardized Discord embed builder for CURSED Bot.
 * All embeds should be created through these helpers to ensure consistent
 * styling, branding, and structure across all commands.
 */

"use strict"

const { EmbedBuilder } = require("discord.js")
const { COLORS, EMOJIS, BOT } = require("../config/constants")

// ─── Base Builder ─────────────────────────────────────────────────────────────

/**
 * Create a base embed with consistent footer and timestamp.
 * @param {number} color - Hex color integer
 * @returns {EmbedBuilder}
 */
function base(color = COLORS.PRIMARY) {
    return new EmbedBuilder()
        .setColor(color)
        .setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot` })
        .setTimestamp()
}

// ─── Preset Builders ──────────────────────────────────────────────────────────

/**
 * Success embed (green).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function success(title, description) {
    const embed = base(COLORS.SUCCESS).setTitle(`${EMOJIS.SUCCESS} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Error embed (red).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function error(title, description) {
    const embed = base(COLORS.ERROR).setTitle(`${EMOJIS.ERROR} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Warning embed (amber).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function warning(title, description) {
    const embed = base(COLORS.WARNING).setTitle(`${EMOJIS.WARN} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Info embed (blue).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function info(title, description) {
    const embed = base(COLORS.INFO).setTitle(`${EMOJIS.INFO} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Economy embed (gold).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function economy(title, description) {
    const embed = base(COLORS.ECONOMY).setTitle(`${EMOJIS.COIN} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Stats embed (dark blue-grey).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function stats(title, description) {
    const embed = base(COLORS.STATS).setTitle(`${EMOJIS.STATS} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Help embed (dark purple).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function help(title, description) {
    const embed = base(COLORS.HELP).setTitle(`${EMOJIS.HELP} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Premium embed (gold).
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function premium(title, description) {
    const embed = base(COLORS.PREMIUM).setTitle(`${EMOJIS.PREMIUM} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Moderation embed with dynamic color based on action type.
 * @param {string} action  - e.g. "WARN", "BAN"
 * @param {string} title
 * @param {string} [description]
 * @returns {EmbedBuilder}
 */
function moderation(action, title, description) {
    const { MODERATION } = require("../config/constants")
    const color = MODERATION.ACTION_COLORS[action] ?? COLORS.MODERATION
    const emoji = MODERATION.ACTION_EMOJIS[action] ?? EMOJIS.SHIELD
    const embed = base(color).setTitle(`${emoji} ${title}`)
    if (description) embed.setDescription(description)
    return embed
}

/**
 * Achievement unlock embed.
 * @param {object} achievement - { name, desc, xp, coins }
 * @returns {EmbedBuilder}
 */
function achievement(ach) {
    return base(COLORS.ECONOMY)
        .setTitle(`🏆 ACHIEVEMENT UNLOCKED — ${ach.name}!`)
        .setDescription(`> ${ach.desc}`)
        .addFields(
            { name: "XP Reward",   value: `+${ach.xp} XP`,     inline: true },
            { name: "Coin Reward", value: `+${ach.coins} 🪙`,   inline: true },
        )
}

/**
 * XP progress bar string.
 * @param {number} current - Current XP
 * @param {number} max     - XP needed for next level
 * @param {number} [width=10] - Bar width in characters
 * @returns {string}
 */
function xpBar(current, max, width = 10) {
    const progress = Math.min(Math.floor((current / max) * width), width)
    return `\`[${"█".repeat(progress)}${"░".repeat(width - progress)}]\``
}

/**
 * Hunger bar string.
 * @param {number} hunger - 0–100
 * @param {number} [width=10]
 * @returns {string}
 */
function hungerBar(hunger, width = 10) {
    const filled = Math.floor((hunger / 100) * width)
    return `\`[${"█".repeat(filled)}${"░".repeat(width - filled)}]\``
}

module.exports = {
    base,
    success,
    error,
    warning,
    info,
    economy,
    stats,
    help,
    premium,
    moderation,
    achievement,
    xpBar,
    hungerBar,
}
