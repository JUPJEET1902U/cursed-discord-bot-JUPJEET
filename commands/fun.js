const { callAI } = require("../utils/ai")
const { addRoast, getLeaderboard } = require("../utils/roast")
const { checkCooldown } = require("../utils/cooldowns")
const { incrementStat, updateQuestProgress, MEDALS } = require("../utils/economy")
const { clearUserMemory } = require("../utils/memory")
const { activeTriviaAnswers } = require("../utils/state")
const { handleImagineCommand } = require("../utils/imageGeneration")
const {
    fun: funEmbed,
    statusLine,
    cooldownMessage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")
const { createSafeMessage } = require("../utils/sanitizeMentions")

async function aiFailure(message, label) {
    await sendSafe(message, statusLine("error", `${label} is unavailable right now. Try again in a moment.`)).catch(() => {})
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower.startsWith("!roast")) {
        const cd = checkCooldown(userId, "roast", 15 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!roast"))
            return true
        }
        const mentioned = message.mentions.users.first()
        const target = mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : message.content.slice(6).trim() || senderName
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED. Generate one witty, creative roast in under 3 sentences. Keep it playful rather than genuinely hurtful." },
                { role: "user", content: `Roast this person: ${target}` },
            ], { maxTokens: 200 })
            addRoast(target)
            await sendEmbed(message, funEmbed(`Roast • ${target}`, result.content))
            incrementStat(userId, senderName, "roast")
            updateQuestProgress(userId, senderName, "roast")
        } catch (error) {
            console.error("Roast error:", error.message)
            await aiFailure(message, "Roast generation")
        }
        return true
    }

    if (msgLower.startsWith("!imagine")) {
        return handleImagineCommand(message, {
            onSuccess: async () => {
                try {
                    incrementStat(userId, senderName, "imagine")
                    updateQuestProgress(userId, senderName, "imagine")
                } catch (error) {
                    console.error("Image generation stat update error:", error.message)
                }
            },
        })
    }

    if (msgLower.startsWith("!meme")) {
        const topic = message.content.slice(5).trim() || "something cursed and funny"
        const cd = checkCooldown(userId, "meme", 30 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!meme"))
            return true
        }

        try {
            await sendSafe(message, statusLine("success", `Generating a meme about **${topic}**.`))
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`funny internet meme style image about ${topic}`)}`
            await createSafeMessage(message.channel, `**${topic}**\n${imageUrl}`)
        } catch (error) {
            console.error("Meme generation error:", error.message)
            await sendSafe(message, statusLine("error", "Meme generation failed. Try a different topic."))
        }
        return true
    }

    if (msgLower === "!leaderboard") {
        const board = getLeaderboard()
        if (!board) {
            await sendSafe(message, "No roast activity yet. Use `!roast @user` to get started.")
            return true
        }
        const lines = board.slice(0, 10).map(([name, count], index) => `${MEDALS[index] || `#${index + 1}`} **${name}** · ${count} roast${count === 1 ? "" : "s"}`)
        await sendEmbed(message, funEmbed("Roast leaderboard", lines.join("\n")))
        return true
    }

    if (msgLower.startsWith("!trivia")) {
        const cd = checkCooldown(message.channel.id, "trivia", 20 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(null, cd.remaining, "!trivia"))
            return true
        }
        try {
            const result = await callAI([
                { role: "system", content: "You are a trivia host. Generate one interesting question with four options A-D and clearly state the correct answer using exactly 'Answer: X'." },
                { role: "user", content: "Give me a random trivia question." },
            ], { maxTokens: 300 })
            const trivia = result.content
            const answer = trivia.match(/Answer:\s*([A-D])/i)?.[1]?.toUpperCase()
            if (!answer) {
                await aiFailure(message, "Trivia generation")
                return true
            }
            activeTriviaAnswers.set(message.channel.id, answer)
            await sendEmbed(message, funEmbed("Trivia", `${trivia.replace(/Answer:.*$/im, "").trim()}\n\nReply with **A**, **B**, **C**, or **D**.`))
        } catch (error) {
            console.error("Trivia error:", error.message)
            await aiFailure(message, "Trivia")
        }
        return true
    }

    if (["a", "b", "c", "d"].includes(msgLower) && activeTriviaAnswers.has(message.channel.id)) {
        const correct = activeTriviaAnswers.get(message.channel.id)
        activeTriviaAnswers.delete(message.channel.id)
        if (msgLower.toUpperCase() === correct) {
            await sendSafe(message, statusLine("success", `**${senderName}** answered correctly. The answer was **${correct}**.`))
            incrementStat(userId, senderName, "triviaWin")
            updateQuestProgress(userId, senderName, "triviaWin")
        } else {
            await sendSafe(message, statusLine("error", `Incorrect. The correct answer was **${correct}**.`))
        }
        return true
    }

    if (msgLower.startsWith("!story")) {
        const theme = message.content.slice(6).trim() || "a random cursed adventure"
        const cd = checkCooldown(userId, "story", 20 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!story"))
            return true
        }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a chaotic storyteller. Write a short entertaining story in 4-6 sentences. Keep it clever, surprising and readable." },
                { role: "user", content: `Tell a story about: ${theme}` },
            ], { maxTokens: 400 })
            await sendEmbed(message, funEmbed(`Story • ${theme}`, result.content))
            incrementStat(userId, senderName, "story")
            updateQuestProgress(userId, senderName, "story")
        } catch (error) {
            console.error("Story error:", error.message)
            await aiFailure(message, "Story generation")
        }
        return true
    }

    if (msgLower.startsWith("!roleplay")) {
        const scenario = message.content.slice(9).trim() || "a mysterious encounter in a dark alley"
        const cd = checkCooldown(userId, "roleplay", 20 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!roleplay"))
            return true
        }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a roleplay partner. Set the scene vividly in 3-4 sentences and end with a prompt inviting the user to continue." },
                { role: "user", content: `Start a roleplay for ${senderName} with this scenario: ${scenario}` },
            ], { maxTokens: 400 })
            await sendEmbed(message, funEmbed(`Roleplay • ${scenario}`, result.content))
            incrementStat(userId, senderName, "roleplay")
            updateQuestProgress(userId, senderName, "roleplay")
        } catch (error) {
            console.error("Roleplay error:", error.message)
            await aiFailure(message, "Roleplay")
        }
        return true
    }

    if (msgLower.startsWith("!challenge")) {
        const cd = checkCooldown(userId, "challenge", 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!challenge"))
            return true
        }
        try {
            const today = new Date().toDateString()
            const result = await callAI([
                { role: "system", content: "You are CURSED. Create one fun, creative daily challenge with a playful fictional reward. Keep it to 3-4 sentences." },
                { role: "user", content: `Generate a daily challenge for ${today}` },
            ], { maxTokens: 250 })
            await sendEmbed(message, funEmbed(`Daily challenge • ${today}`, result.content))
        } catch (error) {
            console.error("Challenge error:", error.message)
            await aiFailure(message, "Challenge generation")
        }
        return true
    }

    if (msgLower.startsWith("!fortune")) {
        const cd = checkCooldown(userId, "fortune", 30 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!fortune"))
            return true
        }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a dramatic but concise fortune teller. Give a mysterious, funny fortune in 3-4 sentences." },
                { role: "user", content: `Tell the fortune of: ${senderName}` },
            ], { maxTokens: 250 })
            await sendEmbed(message, funEmbed(`Fortune • ${senderName}`, result.content))
            incrementStat(userId, senderName, "fortune")
            updateQuestProgress(userId, senderName, "fortune")
        } catch (error) {
            console.error("Fortune error:", error.message)
            await aiFailure(message, "Fortune generation")
        }
        return true
    }

    if (msgLower === "!forget") {
        clearUserMemory(message.guild.id, userId)
        await sendSafe(message, statusLine("success", "Short-term conversation memory cleared."))
        return true
    }

    return false
}

module.exports = { handle }
