/**
 * @fileoverview Common command utilities for CURSED Bot.
 * Shared helpers used across multiple command files to reduce duplication.
 */

"use strict"

const { checkAndGrantAchievements } = require("./economy")
const logger = require("./logger")

// ─── Achievement Announcer ────────────────────────────────────────────────────

/**
 * Check for newly unlocked achievements and announce them in the channel.
 * @param {import("discord.js").Message} message
 * @param {string} userId
 * @param {string} name
 */
async function announceAchievements(message, userId, name) {
    try {
        const achs = checkAndGrantAchievements(userId, name)
        for (const a of achs) {
            await message.channel.send(
                `🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`
            )
        }
    } catch (err) {
        logger.error("CommandUtils", `Achievement announce error: ${err.message}`)
    }
}

// ─── User Info Helpers ────────────────────────────────────────────────────────

/**
 * Extract sender name and user ID from a Discord message.
 * @param {import("discord.js").Message} message
 * @returns {{ senderName: string, userId: string }}
 */
function getSenderInfo(message) {
    return {
        senderName: message.member?.displayName || message.author.username,
        userId:     message.author.id,
    }
}

/**
 * Get the display name of a mentioned user or fall back to their username.
 * @param {import("discord.js").Message} message
 * @param {import("discord.js").User} user
 * @returns {string}
 */
function getMentionedName(message, user) {
    return message.guild?.members.cache.get(user.id)?.displayName || user.username
}

// ─── Cooldown Message ─────────────────────────────────────────────────────────

/**
 * Send a standardized cooldown message.
 * @param {import("discord.js").Message} message
 * @param {number} remaining - Seconds remaining
 * @param {string} [action]  - What action is on cooldown
 */
async function sendCooldownMessage(message, remaining, action = "that") {
    await message.channel.send(
        `⏳ **${message.member?.displayName || message.author.username}**, slow down! ` +
        `Wait **${remaining}s** before using ${action} again.`
    )
}

// ─── Safe Send ────────────────────────────────────────────────────────────────

/**
 * Send a message to a channel, catching and logging any errors.
 * @param {import("discord.js").TextChannel} channel
 * @param {string|object} content
 * @returns {Promise<import("discord.js").Message|null>}
 */
async function safeSend(channel, content) {
    try {
        return await channel.send(content)
    } catch (err) {
        logger.error("CommandUtils", `Failed to send message: ${err.message}`)
        return null
    }
}

module.exports = {
    announceAchievements,
    getSenderInfo,
    getMentionedName,
    sendCooldownMessage,
    safeSend,
}
