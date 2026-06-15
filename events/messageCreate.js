/**
 * @fileoverview MessageCreate event handler.
 * Routes incoming messages through auto-mod, moderation commands,
 * channel allow-list, command handler, and AI chat fallback.
 */

"use strict"

const logger              = require("../utils/logger")
const { handleCommand }   = require("../handlers/commandHandler")
const { runAutoMod }      = require("../utils/automod")
const { isChannelAllowed } = require("../utils/serverConfig")
const { checkRateLimit }  = require("../utils/cooldowns")
const { getUser, saveEconomy, addXP, checkAndGrantAchievements, incrementStat, updateQuestProgress } = require("../utils/economy")
const { getUserMemory, appendUserMemory } = require("../utils/memory")
const { getProfile }      = require("../utils/profiles")
const { ask }             = require("../utils/aiHelper")
const { PROMPTS, RAGE_TRIGGERS, ECONOMY } = require("../config/constants")
const moderationCmd       = require("../commands/moderation")

/**
 * @param {import("discord.js").Message} message
 */
async function execute(message) {
    if (message.author.bot) return
    if (!message.guild)     return

    const guildId   = message.guild.id
    const channelId = message.channel.id

    // ── Auto-Moderation ────────────────────────────────────────────────────────
    try {
        if (await runAutoMod(message)) return
    } catch (err) {
        logger.error("MessageCreate", `AutoMod error: ${err.message}`)
    }

    // ── Moderation Prefix Commands ─────────────────────────────────────────────
    try {
        if (await moderationCmd.handlePrefixCommand(message)) return
    } catch (err) {
        logger.error("MessageCreate", `Moderation prefix error: ${err.message}`)
    }

    // ── Channel Allow-List ─────────────────────────────────────────────────────
    if (!isChannelAllowed(guildId, channelId)) return

    // ── Typing Indicator ───────────────────────────────────────────────────────
    message.channel.sendTyping().catch(() => {})

    const msgLower   = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId     = message.author.id

    // ── Command Routing ────────────────────────────────────────────────────────
    const handled = await handleCommand(message)
    if (handled) return

    // ── Rate Limiting ──────────────────────────────────────────────────────────
    const rl = checkRateLimit(userId)
    if (!rl.ok) {
        await message.channel.send(
            `⚠️ **${senderName}**, slow down! Wait **${rl.remaining}s** — even I need to breathe. 😤`
        ).catch(() => {})
        return
    }

    // ── AI Chat ────────────────────────────────────────────────────────────────
    const isRageMode = RAGE_TRIGGERS.some(t => msgLower.includes(t))
    if (isRageMode) logger.info("MessageCreate", "🔥 RAGE MODE ACTIVATED")

    const { data: ecoData, user: ecoUser } = getUser(userId, senderName)

    // Roast Shield
    const hasShield = (ecoUser.roastShield || 0) > 0
    if (hasShield) {
        ecoUser.roastShield--
        saveEconomy(ecoData)
    }

    // Build system prompt
    const userProfile = getProfile(userId)
    let systemPrompt
    if (isRageMode) {
        systemPrompt = PROMPTS.RAGE
    } else {
        systemPrompt = userProfile?.personality
            ? `${PROMPTS.SYSTEM}\n\nSPECIAL INSTRUCTION for this user: ${userProfile.personality}`
            : PROMPTS.SYSTEM
        if (hasShield) {
            systemPrompt += "\n\nIMPORTANT: This user has a Roast Shield active. Be KIND and helpful only — NO roasting or insults this message."
        }
    }

    const userHistory    = getUserMemory(userId)
    const chatMessages   = [{ role: "system", content: systemPrompt }, ...userHistory]
    const currentUserMsg = `${senderName}: ${message.content}`
    chatMessages.push({ role: "user", content: currentUserMsg })

    logger.command(
        message.guild.name,
        message.channel.name,
        senderName,
        message.content
    )

    try {
        const result = await ask(chatMessages, { maxTokens: 500, context: "Chat" })
        await message.channel.send(result.content).catch(() => {})
        appendUserMemory(userId, currentUserMsg, result.content)

        // Stats & quests
        incrementStat(userId, senderName, "chat")
        updateQuestProgress(userId, senderName, "chat")

        // XP gain
        let xpGain = Math.floor(Math.random() * (ECONOMY.XP_MAX - ECONOMY.XP_MIN + 1)) + ECONOMY.XP_MIN
        const freshEco = getUser(userId, senderName)
        if ((freshEco.user.xpBoost || 0) > 0) {
            xpGain *= 2
            freshEco.user.xpBoost--
            saveEconomy(freshEco.data)
        }

        const { leveledUp, newLevel } = addXP(userId, senderName, xpGain)
        if (leveledUp) {
            await message.channel.send(
                `🎉 **${senderName}** leveled up to **Level ${newLevel}**! Congrats, I guess. 💀`
            ).catch(() => {})
        }

        // Achievement checks
        const newAchs = checkAndGrantAchievements(userId, senderName)
        for (const a of newAchs) {
            await message.channel.send(
                `🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`
            ).catch(() => {})
        }
    } catch (err) {
        logger.error("MessageCreate", `AI chat error: ${err.message}`)
        if (err.status === 429) {
            await message.channel.send("⚠️ AI is rate limited right now. Try again in a moment!").catch(() => {})
        } else {
            await message.channel.send("⚠️ Something went wrong. Try again!").catch(() => {})
        }
    }
}

module.exports = { name: "MessageCreate", once: false, execute }
