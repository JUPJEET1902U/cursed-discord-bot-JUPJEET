const { askSafe } = require("../utils/aiHelper")
const { getPet, savePets, PET_TYPES, calcPetLevel } = require("../utils/pets")
const { getUser, saveEconomy, checkAndGrantAchievements, updateQuestProgress, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeMentions } = require("../utils/inputValidator")
const logger = require("../utils/logger")
const { COOLDOWNS, ECONOMY } = require("../config/constants")

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

    if (msgLower.startsWith("!adopt")) {
        const parts = message.content.split(" ")
        const petType = parts[1]?.toLowerCase()
        const petName = parts.slice(2).join(" ").trim()
        const typeList = Object.entries(PET_TYPES).map(([t, d]) => `\`${t}\` ${d.emoji} — ${d.desc}`).join("\n")
        if (!petType || !PET_TYPES[petType] || !petName) {
            await message.channel.send(`🐾 **Adopt a Pet!**\n\nUsage: \`!adopt [type] [name]\`\n\nAvailable types:\n${typeList}`)
            return true
        }
        const { data: petData, pet: existing } = getPet(userId)
        if (existing) {
            await message.channel.send(`😅 **${senderName}**, you already have **${existing.emoji} ${existing.name}**! You can't adopt another. Take care of the one you have.`)
            return true
        }
        const typeInfo = PET_TYPES[petType]
        petData[userId] = {
            name: petName, type: petType, emoji: typeInfo.emoji,
            level: 1, xp: 0, hunger: 100, mood: "happy",
            lastFed: new Date().toDateString(), lastPlay: null, adoptedAt: new Date().toISOString()
        }
        savePets(petData)
        incrementStat(userId, senderName, "petAdopt")
        await message.channel.send(`🎉 **${senderName}** adopted a **${typeInfo.emoji} ${petType}** named **${petName}**!\n> ${typeInfo.desc}\n\nUse \`!feedpet\` and \`!petplay\` to keep it happy!`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!mypet") {
        const { pet } = getPet(userId)
        if (!pet) { await message.channel.send(`🐾 **${senderName}**, you don't have a pet yet! Use \`!adopt [type] [name]\` to get one.`); return true }
        const level = calcPetLevel(pet.xp)
        const hunger = pet.hunger || 0
        const hungerBar = "█".repeat(Math.floor(hunger / 10)) + "░".repeat(10 - Math.floor(hunger / 10))
        const moodEmoji = hunger > 70 ? "😄" : hunger > 40 ? "😐" : "😢"
        await message.channel.send(`${pet.emoji} **${pet.name}** — *${pet.type}*\n\n⭐ Level: **${level}**\n📊 XP: **${pet.xp}**\n🍖 Hunger: \`[${hungerBar}]\` ${hunger}% ${moodEmoji}\n😊 Mood: **${pet.mood}**\n📅 Adopted: ${new Date(pet.adoptedAt).toDateString()}`)
        return true
    }

    if (msgLower === "!feedpet") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await message.channel.send(`🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const { data: ecoData, user } = getUser(userId, senderName)
        const cost = ECONOMY.PET_FEED_COST
        if (user.coins < cost) { await message.channel.send(`💸 Feeding costs **${cost} coins** and you only have **${user.coins}**. Your pet is judging you.`); return true }
        user.coins -= cost
        saveEconomy(ecoData)
        pet.hunger = Math.min(100, (pet.hunger || 0) + ECONOMY.PET_FEED_HUNGER)
        pet.xp += ECONOMY.PET_FEED_XP
        pet.mood = pet.hunger > 70 ? "happy" : "content"
        pet.lastFed = new Date().toDateString()
        savePets(petData)
        updateQuestProgress(userId, senderName, "feedpet")
        await message.channel.send(`🍖 **${senderName}** fed **${pet.emoji} ${pet.name}**! (-${cost} coins)\nHunger: **${pet.hunger}%** | Mood: **${pet.mood}** 😊`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!petplay") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await message.channel.send(`🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const cd = checkCooldown(userId, "petplay", COOLDOWNS.PET_PLAY)
        if (!cd.ok) { await message.channel.send(`⏳ **${pet.name}** is tired. Wait **${Math.floor(cd.remaining / 60)}m** before playing again.`); return true }
        const reward = Math.floor(Math.random() * (ECONOMY.PET_PLAY_COIN_MAX - ECONOMY.PET_PLAY_COIN_MIN + 1)) + ECONOMY.PET_PLAY_COIN_MIN
        pet.xp += ECONOMY.PET_PLAY_XP
        pet.mood = "excited"
        pet.lastPlay = new Date().toISOString()
        savePets(petData)
        const { data: ecoData, user } = getUser(userId, senderName)
        user.coins += reward
        saveEconomy(ecoData)
        await message.channel.send(`🎾 **${senderName}** played with **${pet.emoji} ${pet.name}**!\n+20 pet XP | +${reward} coins earned 🎉`)
        return true
    }

    if (msgLower.startsWith("!petsay")) {
        const rawMsg = message.content.slice(7).trim()
        if (!rawMsg) { await message.channel.send("Usage: `!petsay [message]` — make your pet say something!"); return true }
        const msg = sanitizeMentions(rawMsg).slice(0, 300)
        const cd = checkCooldown(userId, "petsay", COOLDOWNS.PET_SAY)
        if (!cd.ok) { await message.channel.send(`⏳ Your pet is catching its breath. Wait **${cd.remaining}s**.`); return true }
        const { pet } = getPet(userId)
        if (!pet) { await message.channel.send(`🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const typeInfo = PET_TYPES[pet.type]
        const personality = typeInfo.personality.replace("{name}", pet.name)
        const response = await askSafe([
            { role: "system", content: `${personality} Your owner is ${senderName}. They want you to say something. 1-2 sentences, fully in character.` },
            { role: "user", content: msg }
        ], { maxTokens: 150, context: "Pets:petsay" })
        await message.channel.send(`${pet.emoji} **${pet.name}** says:\n> ${response}`)
        return true
    }

    return false
}

module.exports = { handle }
