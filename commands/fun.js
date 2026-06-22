const { AttachmentBuilder } = require("discord.js")
const { callAI } = require("../utils/ai")
const { addRoast, getLeaderboard } = require("../utils/roast")
const { checkCooldown } = require("../utils/cooldowns")
const { incrementStat, updateQuestProgress, checkAndGrantAchievements, MEDALS } = require("../utils/economy")
const { clearUserMemory } = require("../utils/memory")
const { activeTriviaAnswers } = require("../utils/state")

// ── HF_TOKEN validation ────────────────────────────────────────────────────────
const HF_TOKEN = process.env.HF_TOKEN
if (!HF_TOKEN) {
    console.warn("⚠️  HF_TOKEN is not set — !imagine and !meme commands will be disabled")
} else {
    console.log("✅ HF_TOKEN detected — image generation enabled")
}

async function announce(message, userId, name) {
    const achs = checkAndGrantAchievements(userId, name)
    for (const a of achs) {
        await message.channel.send(`🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`)
    }
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower.startsWith("!roast")) {
        const cd = checkCooldown(userId, "roast", 15 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Chill! Wait **${cd.remaining}s** before roasting again.`); return true }
        const mentioned = message.mentions.users.first()
        const target = mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : message.content.slice(6).trim() || senderName
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a savage roast bot. Generate one witty, funny, creative roast. Make it personal-sounding and hilarious. Under 3 sentences. Fun, not genuinely hurtful." },
                { role: "user", content: `Roast this person: ${target}` }
            ], { maxTokens: 200 })
            addRoast(target)
            await message.channel.send(`🔥 ${result.content}`)
            incrementStat(userId, senderName, "roast")
            updateQuestProgress(userId, senderName, "roast")
            await announce(message, userId, senderName)
        } catch (err) { console.error("Roast error:", err.message) }
        return true
    }

    if (msgLower.startsWith("!imagine")) {
        const prompt = message.content.slice(8).trim()
        if (!prompt) { await message.channel.send("Give me something to imagine! e.g. `!imagine a cursed cat on a skateboard`"); return true }
        if (!HF_TOKEN) { await message.channel.send("🚫 Image generation is not configured on this bot. Ask the server owner to set up `HF_TOKEN`."); return true }
        const cd = checkCooldown(userId, "imagine", 30 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before generating another image.`); return true }
        try {
            await message.channel.send(`🎨 Generating **${prompt}**... give me a sec`)
            const hfRes = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
                method: "POST",
                headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ inputs: prompt })
            })
            if (!hfRes.ok) {
                const errText = await hfRes.text().catch(() => "(no body)")
                console.error(`Image generation failed [${hfRes.status}]:`, errText)
                await message.channel.send("😤 Image generation failed. The model may be loading — try again in a moment!")
                return true
            }
            const arrayBuf = await hfRes.arrayBuffer()
            if (!arrayBuf || arrayBuf.byteLength === 0) {
                console.error("Image generation returned empty buffer for prompt:", prompt)
                await message.channel.send("😤 Got an empty image back. Try a different prompt!")
                return true
            }
            const buffer = Buffer.from(arrayBuf)
            const attachment = new AttachmentBuilder(buffer, { name: "cursed.png" })
            await message.channel.send({ content: `🎨 **${prompt}**`, files: [attachment] })
            incrementStat(userId, senderName, "imagine")
            updateQuestProgress(userId, senderName, "imagine")
        } catch (err) {
            console.error("Image generation error:", err)
            await message.channel.send("😤 Couldn't generate that. Try a different prompt!")
        }
        return true
    }

    if (msgLower.startsWith("!meme")) {
        const topic = message.content.slice(5).trim() || "something cursed and funny"
        if (!HF_TOKEN) { await message.channel.send("🚫 Image generation is not configured on this bot. Ask the server owner to set up `HF_TOKEN`."); return true }
        const cd = checkCooldown(userId, "meme", 30 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before another meme.`); return true }
        try {
            await message.channel.send(`😂 Generating a meme about **${topic}**... hang on`)
            const hfRes = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
                method: "POST",
                headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ inputs: `funny internet meme style image about ${topic}, bold text, humorous, viral meme format` })
            })
            if (!hfRes.ok) {
                const errText = await hfRes.text().catch(() => "(no body)")
                console.error(`Meme generation failed [${hfRes.status}]:`, errText)
                await message.channel.send("😤 Meme generation failed. The model may be loading — try again!")
                return true
            }
            const arrayBuf = await hfRes.arrayBuffer()
            if (!arrayBuf || arrayBuf.byteLength === 0) {
                console.error("Meme generation returned empty buffer for topic:", topic)
                await message.channel.send("😤 Got an empty image back. Try a different topic!")
                return true
            }
            const buffer = Buffer.from(arrayBuf)
            await message.channel.send({ content: `😂 **${topic}**`, files: [new AttachmentBuilder(buffer, { name: "meme.png" })] })
        } catch (err) {
            console.error("Meme generation error:", err)
            await message.channel.send("😤 Couldn't generate that meme. Try a different topic!")
        }
        return true
    }


    if (msgLower === "!leaderboard") {
        const { createSafeMessage: csm } = require("../utils/sanitizeMentions")
        const board = getLeaderboard()
        if (!board) { await csm(message.channel, "😐 Nobody has been roasted yet. Type `!roast @someone` to get started."); return true }
        const lines = board.slice(0, 10).map(([name, count], i) =>
            `${MEDALS[i] || `**#${i + 1}**`} **${name}** — roasted **${count}** time${count === 1 ? "" : "s"}`
        )
        await csm(message.channel, `🔥 **CURSED ROAST LEADERBOARD** 🔥\n\n${lines.join("\n")}`)
        return true
    }

    if (msgLower.startsWith("!trivia")) {
        const cd = checkCooldown(message.channel.id, "trivia", 20 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Trivia is on cooldown! Wait **${cd.remaining}s**.`); return true }
        try {
            const result = await callAI([
                { role: "system", content: "You are a trivia host. Generate one interesting trivia question with 4 multiple choice options (A, B, C, D) and clearly state the correct answer. Format:\nQuestion: ...\nA) ...\nB) ...\nC) ...\nD) ...\nAnswer: X" },
                { role: "user", content: "Give me a random trivia question." }
            ], { maxTokens: 300 })
            const trivia = result.content
            activeTriviaAnswers.set(message.channel.id, trivia.match(/Answer:\s*([A-D])/i)?.[1]?.toUpperCase())
            await message.channel.send(`🧠 **TRIVIA TIME!**\n\n${trivia.replace(/Answer:.*$/im, "").trim()}\n\nType **A**, **B**, **C**, or **D** to answer!`)
        } catch (err) { console.error("Trivia error:", err.message) }
        return true
    }

    if (["a", "b", "c", "d"].includes(msgLower.trim()) && activeTriviaAnswers.has(message.channel.id)) {
        const correct = activeTriviaAnswers.get(message.channel.id)
        activeTriviaAnswers.delete(message.channel.id)
        if (msgLower.trim().toUpperCase() === correct) {
            await message.channel.send(`✅ **${senderName}** got it right! The answer was **${correct}**! 🎉 You're not as dumb as you look.`)
            incrementStat(userId, senderName, "triviaWin")
            updateQuestProgress(userId, senderName, "triviaWin")
            await announce(message, userId, senderName)
        } else {
            await message.channel.send(`❌ Wrong, **${senderName}**! The correct answer was **${correct}**. Maybe try using your brain next time? 💀`)
        }
        return true
    }

    if (msgLower.startsWith("!story")) {
        const theme = message.content.slice(6).trim() || "a random cursed adventure"
        const cd = checkCooldown(userId, "story", 20 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before requesting another story.`); return true }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a chaotic storyteller. Write a short, entertaining story (4-6 sentences) that is wild, funny, and unexpected. Dark humor and absurdity welcome." },
                { role: "user", content: `Tell a story about: ${theme}` }
            ], { maxTokens: 400 })
            await message.channel.send(`📖 **A CURSED STORY: ${theme.toUpperCase()}**\n\n${result.content}`)
            incrementStat(userId, senderName, "story")
            updateQuestProgress(userId, senderName, "story")
        } catch (err) { console.error("Story error:", err.message) }
        return true
    }

    if (msgLower.startsWith("!roleplay")) {
        const scenario = message.content.slice(9).trim() || "a mysterious encounter in a dark alley"
        const cd = checkCooldown(userId, "roleplay", 20 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before starting another roleplay.`); return true }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a roleplay partner. Set the scene vividly in 3-4 sentences and end with a prompt inviting the user to continue." },
                { role: "user", content: `Start a roleplay for ${senderName} with this scenario: ${scenario}` }
            ], { maxTokens: 400 })
            await message.channel.send(`🎭 **ROLEPLAY: ${scenario.toUpperCase()}**\n\n${result.content}`)
            incrementStat(userId, senderName, "roleplay")
            updateQuestProgress(userId, senderName, "roleplay")
        } catch (err) { console.error("Roleplay error:", err.message) }
        return true
    }

    if (msgLower.startsWith("!challenge")) {
        const cd = checkCooldown(userId, "challenge", 60 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before getting another challenge.`); return true }
        try {
            const today = new Date().toDateString()
            const result = await callAI([
                { role: "system", content: "You are CURSED, a daily challenge giver. Create a fun, creative, slightly ridiculous daily challenge. Include a fake reward. 3-4 sentences." },
                { role: "user", content: `Generate a daily challenge for ${today}` }
            ], { maxTokens: 250 })
            await message.channel.send(`⚔️ **DAILY CHALLENGE — ${today.toUpperCase()}**\n\n${result.content}`)
        } catch (err) { console.error("Challenge error:", err.message) }
        return true
    }

    if (msgLower.startsWith("!fortune")) {
        const cd = checkCooldown(userId, "fortune", 30 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ The oracle needs **${cd.remaining}s** to recover its powers.`); return true }
        try {
            const result = await callAI([
                { role: "system", content: "You are CURSED, a dramatic and slightly unhinged fortune teller. Give a mysterious, cryptic, and funny fortune. Mix mysticism with absurd humor. 3-4 sentences, make it feel personal." },
                { role: "user", content: `Tell the fortune of: ${senderName}` }
            ], { maxTokens: 250 })
            await message.channel.send(`🔮 **THE CURSED ORACLE SPEAKS FOR ${senderName.toUpperCase()}...**\n\n${result.content}`)
            incrementStat(userId, senderName, "fortune")
            updateQuestProgress(userId, senderName, "fortune")
        } catch (err) { console.error("Fortune error:", err.message) }
        return true
    }

    if (msgLower === "!forget") {
        clearUserMemory(userId)
        await message.channel.send(`🧹 Done, **${senderName}**. Who are you again? I've completely forgotten you existed. Fresh start! 😇`)
        return true
    }

    return false
}

module.exports = { handle }
