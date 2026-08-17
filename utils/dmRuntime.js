const { Events } = require("discord.js")
const { callAI } = require("./ai")
const { getUserMemory, appendUserMemory } = require("./memory")
const { getUser, saveEconomy, incrementStat, updateQuestProgress } = require("./economy")
const { checkRateLimit } = require("./cooldowns")
const { getProfile } = require("./profiles")
const { replySafe } = require("./mentionSanitizer")
const { sanitizeUserInput, sanitizeAIOutput, sanitizeName } = require("./sanitizer")
const { buildSystemPrompt } = require("./prompts")
const { getUserPersonality } = require("./personalities")
const { extractAndStoreMemories, buildMemoryContext } = require("./longTermMemory")
const { formatError } = require("./errorFormatter")
const logger = require("./logger")
const { dispatchCommand } = require("../handlers/commandLoader")
const { DM_SCOPE_ID, getDmAiControl } = require("./dmSupport")

const log = logger.child("DMRuntime")
const RAGE_TRIGGERS = ["randi"]

function registerDmRuntime(client, commandModules) {
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot || message.guild) return

        const channelId = message.channel.id
        const userId = message.author.id
        const senderName = sanitizeName(message.author.username)
        const control = getDmAiControl()

        try {
            const handled = await dispatchCommand(message, commandModules)
            if (handled) return
        } catch (err) {
            log.error(`DM command dispatch failed: ${err.message}`, {
                stack: err.stack,
                channelId,
                userId,
            })
            await replySafe(message, "⚠️ Something went wrong while running that command. Try again!").catch(() => {})
            return
        }

        const aiInput = String(message.content || "").trim()
        if (!aiInput) return

        message.channel.sendTyping().catch(() => {})

        const rl = checkRateLimit(userId, {
            limit: control.aiRateLimit,
            windowMs: control.aiRateWindowSeconds * 1000,
            scope: DM_SCOPE_ID,
        })
        if (!rl.ok) {
            await replySafe(message,
                `⏳ **${senderName}**, slow down! Wait **${rl.remaining}s** before sending another message. 😤`)
            return
        }

        const { safe, sanitized: sanitizedInput } = sanitizeUserInput(aiInput)
        if (!safe) {
            await replySafe(message, `🛡️ Nice try, **${senderName}**. I see what you're doing. 😏`)
            return
        }

        const isRageMode = RAGE_TRIGGERS.some(trigger => sanitizedInput.toLowerCase().includes(trigger))
        const { data: ecoData, user: ecoUser } = getUser(userId, senderName)
        const hasShield = (ecoUser.roastShield || 0) > 0
        if (hasShield) {
            ecoUser.roastShield--
            ecoUser.stats = ecoUser.stats || {}
            ecoUser.stats.shieldUsed = (ecoUser.stats.shieldUsed || 0) + 1
            saveEconomy(ecoData)
        }

        const userProfile = getProfile(userId)
        const personality = await getUserPersonality(userId)
        const memoryContext = control.aiLongTermMemoryEnabled
            ? await buildMemoryContext(userId)
            : ""

        const systemPrompt = buildSystemPrompt({
            personality,
            profileInstruction: userProfile?.personality || null,
            hasShield,
            rageMode: isRageMode,
        }) + memoryContext +
            "\n\nDM CONTEXT: You are speaking privately with this user in Discord DMs. Do not imply that a server, channel, roles, or guild members are available unless the user explicitly provides that information."

        const userHistory = control.aiMemoryEnabled
            ? getUserMemory(DM_SCOPE_ID, userId)
            : []
        const currentUserMsg = `${senderName}: ${sanitizedInput}`
        const chatMessages = [
            { role: "system", content: systemPrompt },
            ...userHistory,
            { role: "user", content: currentUserMsg },
        ]

        log.info(`[DM] ${senderName}: ${aiInput.slice(0, 50)}`)

        let safeOutput
        try {
            const result = await callAI(chatMessages, { maxTokens: control.aiMaxTokens })
            safeOutput = sanitizeAIOutput(result.content)
            await replySafe(message, safeOutput)
        } catch (err) {
            const userMessage = formatError(err, "ai-chat", {
                guildId: DM_SCOPE_ID,
                channelId,
                userId,
            })
            await replySafe(message, userMessage)
            return
        }

        if (control.aiMemoryEnabled) {
            try {
                appendUserMemory(DM_SCOPE_ID, userId, currentUserMsg, safeOutput)
            } catch (err) {
                log.error(`DM appendUserMemory failed: ${err.message}`, { stack: err.stack, userId })
            }
        }

        if (control.aiLongTermMemoryEnabled) {
            extractAndStoreMemories(userId, sanitizedInput, safeOutput).catch(err => {
                log.error(`DM extractAndStoreMemories failed: ${err.message}`, { stack: err.stack, userId })
            })
        }

        // Keep global usage stats/quests consistent, but do not award passive
        // legacy chat XP in DMs (getDmAiControl disables that path).
        try {
            incrementStat(userId, senderName, "chat")
            updateQuestProgress(userId, senderName, "chat")
        } catch (err) {
            log.error(`DM chat stat/quest update failed: ${err.message}`, { stack: err.stack, userId })
        }
    })
}

module.exports = { registerDmRuntime }
