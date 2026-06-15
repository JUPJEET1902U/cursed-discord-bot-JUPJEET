const { AttachmentBuilder } = require("discord.js")
const { askSafe } = require("../utils/aiHelper")
const { addRoast, getLeaderboard } = require("../utils/roast")
const { checkCooldown } = require("../utils/cooldowns")
const { incrementStat, updateQuestProgress, checkAndGrantAchievements, MEDALS } = require("../utils/economy")
const { clearUserMemory } = require("../utils/memory")
const { activeTriviaAnswers } = require("../utils/state")
const { sanitizeMentions, validateText } = require("../utils/inputValidator")
const logger = require("../utils/logger")
const { COOLDOWNS } = require("../config/constants")

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
        const cd = checkCooldown(userId, "roast", COOLDOWNS.ROAST)
        if (!cd.ok) { await message.channel.send(`⏳ Chill! Wait **${cd.remaining}s** before roasting again.`); return true }
        const mentioned = message.mentions.users.first()
        const rawTarget = mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : message.content.slice(6).trim() || senderName
        const target = sanitizeMentions(rawTarget).slice(0, 100)
        const response = await askSafe([
            { role: "system", content: "You are CURSED, a savage roast bot. Generate one witty, funny, creative roast. Make it personal-sounding and hilarious. Under 3 sentences. Fun, not genuinely hurtful." },
            { role: "user", content: `Roast this person: ${target}` }
        ], { maxTokens: 200, context: "Fun:roast" })
        addRoast(target)
        await message.channel.send(`🔥 ${response}`)
        incrementStat(userId, senderName, "roast")
        updateQuestProgress(userId, senderName, "roast")
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower.startsWith("!imagine")) {
        const rawPrompt = message.content.slice(8).trim()
        if (!rawPrompt) { await message.channel.send("Give me something to imagine! e.g. `!imagine a cursed cat on a skateboard`"); return true }
        const prompt = sanitizeMentions(rawPrompt).slice(0, 500)
        const cd = checkCooldown(userId, "imagine", COOLDOWNS.IMAGINE)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before generating another image.`); return true }
        try {
            await message.channel.send(`🎨 Generating **${prompt}**... give me a sec`)
            const hfRes = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ inputs: prompt })
            })
            if (!hfRes.ok) { await message.channel.send("😤 Image generation failed. Try again in a moment!"); return true }
            const buffer = Buffer.from(await hfRes.arrayBuffer())
            const attachment = new AttachmentBuilder(buffer, { name: "cursed.png" })
            await message.channel.send({ content: `🎨 **${prompt}**`, files: [attachment] })
            incrementStat(userId, senderName, "imagine")
            updateQuestProgress(userId, senderName, "imagine")
        } catch (err) { logger.error("Fun:imagine", err.message); await message.channel.send("😤 Couldn't generate that. Try a different prompt!") }
        return true
    }

    if (msgLower.startsWith("!meme")) {
        const rawTopic = message.content.slice(5).trim() || "something cursed and funny"
        const topic = sanitizeMentions(rawTopic).slice(0, 200)
        const cd = checkCooldown(userId, "meme", COOLDOWNS.MEME)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before another meme.`); return true }
        try {
            await message.channel.send(`😂 Generating a meme about **${topic}**... hang on`)
            const hfRes = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ inputs: `funny internet meme style image about ${topic}, bold text, humorous, viral meme format` })
            })
            if (!hfRes.ok) { await message.channel.send("😤 Meme generation failed. Try again!"); return true }
            const buffer = Buffer.from(await hfRes.arrayBuffer())
            await message.channel.send({ content: `😂 **${topic}**`, files: [new AttachmentBuilder(buffer, { name: "meme.png" })] })
        } catch (err) { logger.error("Fun:meme", err.message) }
        return true
    }

    if (msgLower === "!leaderboard") {
        const board = getLeaderboard()
        if (!board) { await message.channel.send("😐 Nobody has been roasted yet. Type `!roast @someone` to get started."); return true }
        const lines = board.slice(0, 10).map(([name, count], i) =>
            `${MEDALS[i] || `**#${i + 1}**`} **${name}** — roasted **${count}** time${count === 1 ? "" : "s"}`
        )
        await message.channel.send(`🔥 **CURSED ROAST LEADERBOARD** 🔥\n\n${lines.join("\n")}`)
        return true
    }

    if (msgLower.startsWith("!trivia")) {
        const cd = checkCooldown(message.channel.id, "trivia", COOLDOWNS.TRIVIA)
        if (!cd.ok) { await message.channel.send(`⏳ Trivia is on cooldown! Wait **${cd.remaining}s**.`); return true }
        const trivia = await askSafe([
            { role: "system", content: "You are a trivia host. Generate one interesting trivia question with 4 multiple choice options (A, B, C, D) and clearly state the correct answer. Format:\nQuestion: ...\nA) ...\nB) ...\nC) ...\nD) ...\nAnswer: X" },
            { role: "user", content: "Give me a random trivia question." }
        ], { maxTokens: 300, context: "Fun:trivia" })
        activeTriviaAnswers.set(message.channel.id, trivia.match(/Answer:\s*([A-D])/i)?.[1]?.toUpperCase())
        await message.channel.send(`🧠 **TRIVIA TIME!**\n\n${trivia.replace(/Answer:.*$/im, "").trim()}\n\nType **A**, **B**, **C**, or **D** to answer!`)
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
        const rawTheme = message.content.slice(6).trim() || "a random cursed adventure"
        const theme = sanitizeMentions(rawTheme).slice(0, 200)
        const cd = checkCooldown(userId, "story", COOLDOWNS.STORY)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before requesting another story.`); return true }
        const response = await askSafe([
            { role: "system", content: "You are CURSED, a chaotic storyteller. Write a short, entertaining story (4-6 sentences) that is wild, funny, and unexpected. Dark humor and absurdity welcome." },
            { role: "user", content: `Tell a story about: ${theme}` }
        ], { maxTokens: 400, context: "Fun:story" })
        await message.channel.send(`📖 **A CURSED STORY: ${theme.toUpperCase()}**\n\n${response}`)
        incrementStat(userId, senderName, "story")
        updateQuestProgress(userId, senderName, "story")
        return true
    }

    if (msgLower.startsWith("!roleplay")) {
        const rawScenario = message.content.slice(9).trim() || "a mysterious encounter in a dark alley"
        const scenario = sanitizeMentions(rawScenario).slice(0, 200)
        const cd = checkCooldown(userId, "roleplay", COOLDOWNS.ROLEPLAY)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before starting another roleplay.`); return true }
        const response = await askSafe([
            { role: "system", content: "You are CURSED, a roleplay partner. Set the scene vividly in 3-4 sentences and end with a prompt inviting the user to continue." },
            { role: "user", content: `Start a roleplay for ${senderName} with this scenario: ${scenario}` }
        ], { maxTokens: 400, context: "Fun:roleplay" })
        await message.channel.send(`🎭 **ROLEPLAY: ${scenario.toUpperCase()}**\n\n${response}`)
        incrementStat(userId, senderName, "roleplay")
        updateQuestProgress(userId, senderName, "roleplay")
        return true
    }

    if (msgLower.startsWith("!challenge")) {
        const cd = checkCooldown(userId, "challenge", COOLDOWNS.CHALLENGE)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before getting another challenge.`); return true }
        const today = new Date().toDateString()
        const response = await askSafe([
            { role: "system", content: "You are CURSED, a daily challenge giver. Create a fun, creative, slightly ridiculous daily challenge. Include a fake reward. 3-4 sentences." },
            { role: "user", content: `Generate a daily challenge for ${today}` }
        ], { maxTokens: 250, context: "Fun:challenge" })
        await message.channel.send(`⚔️ **DAILY CHALLENGE — ${today.toUpperCase()}**\n\n${response}`)
        return true
    }

    if (msgLower.startsWith("!fortune")) {
        const cd = checkCooldown(userId, "fortune", COOLDOWNS.FORTUNE)
        if (!cd.ok) { await message.channel.send(`⏳ The oracle needs **${cd.remaining}s** to recover its powers.`); return true }
        const response = await askSafe([
            { role: "system", content: "You are CURSED, a dramatic and slightly unhinged fortune teller. Give a mysterious, cryptic, and funny fortune. Mix mysticism with absurd humor. 3-4 sentences, make it feel personal." },
            { role: "user", content: `Tell the fortune of: ${senderName}` }
        ], { maxTokens: 250, context: "Fun:fortune" })
        await message.channel.send(`🔮 **THE CURSED ORACLE SPEAKS FOR ${senderName.toUpperCase()}...**\n\n${response}`)
        incrementStat(userId, senderName, "fortune")
        updateQuestProgress(userId, senderName, "fortune")
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
