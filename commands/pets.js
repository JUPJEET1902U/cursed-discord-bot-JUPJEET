const { callAI } = require("../utils/ai")
const { getPet, savePets, PET_TYPES, calcPetLevel } = require("../utils/pets")
const { getUser, saveEconomy, checkAndGrantAchievements, updateQuestProgress, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeName } = require("../utils/sanitizer")

async function announce(message, userId, name) {
    const achs = checkAndGrantAchievements(userId, name)
    for (const a of achs) {
        await createSafeMessage(message.channel, `🏆 **ACHIEVEMENT UNLOCKED — ${a.name}!**\n> ${a.desc}\n🎁 +${a.xp} XP | +${a.coins} coins`)
    }
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower.startsWith("!adopt")) {
        const parts = message.content.split(" ")
        const petType = parts[1]?.toLowerCase()
        const petName = sanitizeName(parts.slice(2).join(" ").trim())
        const typeList = Object.entries(PET_TYPES).map(([t, d]) => `\`${t}\` ${d.emoji} — ${d.desc}`).join("\n")
        if (!petType || !PET_TYPES[petType] || !petName) {
            await createSafeMessage(message.channel, `🐾 **Adopt a Pet!**\n\nUsage: \`!adopt [type] [name]\`\n\nAvailable types:\n${typeList}`)
            return true
        }
        const { data: petData, pet: existing } = getPet(userId)
        if (existing) {
            await createSafeMessage(message.channel, `😅 **${senderName}**, you already have **${existing.emoji} ${existing.name}**! You can't adopt another. Take care of the one you have.`)
            return true
        }
        const typeInfo = PET_TYPES[petType]
        petData[userId] = {
            name: petName, type: petType, emoji: typeInfo.emoji,
            level: 1, xp: 0, hunger: 100, health: 100, mood: "happy", rarity: "common", skills: [],
            lastFed: new Date().toDateString(), lastPlay: null, adoptedAt: new Date().toISOString()
        }
        savePets(petData)
        incrementStat(userId, senderName, "petAdopt")
        await createSafeMessage(message.channel, `🎉 **${senderName}** adopted a **${typeInfo.emoji} ${petType}** named **${petName}**!\n> ${typeInfo.desc}\n\nUse \`!feedpet\` and \`!petplay\` to keep it happy!`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!mypet") {
        const { pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 **${senderName}**, you don't have a pet yet! Use \`!adopt [type] [name]\` to get one.`); return true }
        const level = calcPetLevel(pet.xp)
        const hunger = pet.hunger || 0
        const hungerBar = "█".repeat(Math.floor(hunger / 10)) + "░".repeat(10 - Math.floor(hunger / 10))
        const moodEmoji = hunger > 70 ? "😄" : hunger > 40 ? "😐" : "😢"
        await createSafeMessage(message.channel, `${pet.emoji} **${pet.name}** — *${pet.type}*\n\n⭐ Level: **${level}**\n📊 XP: **${pet.xp}**\n🍖 Hunger: \`[${hungerBar}]\` ${hunger}% ${moodEmoji}\n😊 Mood: **${pet.mood}**\n📅 Adopted: ${new Date(pet.adoptedAt).toDateString()}`)
        return true
    }

    if (msgLower === "!feedpet") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const { data: ecoData, user } = getUser(userId, senderName)
        const cost = 10
        if (user.coins < cost) { await createSafeMessage(message.channel, `💸 Feeding costs **${cost} coins** and you only have **${user.coins}**. Your pet is judging you.`); return true }
        user.coins -= cost
        saveEconomy(ecoData)
        pet.hunger = Math.min(100, (pet.hunger || 0) + 30)
        pet.xp += 10
        pet.mood = pet.hunger > 70 ? "happy" : "content"
        pet.lastFed = new Date().toDateString()
        savePets(petData)
        updateQuestProgress(userId, senderName, "feedpet")
        incrementStat(userId, senderName, "feedpet")
        await createSafeMessage(message.channel, `🍖 **${senderName}** fed **${pet.emoji} ${pet.name}**! (-${cost} coins)\nHunger: **${pet.hunger}%** | Mood: **${pet.mood}** 😊`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!petplay") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const cd = checkCooldown(userId, "petplay", 60 * 60 * 1000)
        if (!cd.ok) { await createSafeMessage(message.channel, `⏳ **${pet.name}** is tired. Wait **${Math.floor(cd.remaining / 60)}m** before playing again.`); return true }
        const reward = Math.floor(Math.random() * 30) + 10
        pet.xp += 20
        pet.mood = "excited"
        pet.lastPlay = new Date().toISOString()
        savePets(petData)
        const { data: ecoData, user } = getUser(userId, senderName)
        user.coins += reward
        saveEconomy(ecoData)
        incrementStat(userId, senderName, "petplay")
        await createSafeMessage(message.channel, `🎾 **${senderName}** played with **${pet.emoji} ${pet.name}**!\n+20 pet XP | +${reward} coins earned 🎉`)
        return true
    }

    if (msgLower.startsWith("!petsay")) {
        const msg = message.content.slice(7).trim()
        if (!msg) { await createSafeMessage(message.channel, "Usage: `!petsay [message]` — make your pet say something!"); return true }
        const cd = checkCooldown(userId, "petsay", 30 * 1000)
        if (!cd.ok) { await createSafeMessage(message.channel, `⏳ Your pet is catching its breath. Wait **${cd.remaining}s**.`); return true }
        const { pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const typeInfo = PET_TYPES[pet.type]
        const personality = typeInfo.personality.replace("{name}", pet.name)
        try {
            const result = await callAI([
                { role: "system", content: `${personality} Your owner is ${senderName}. They want you to say something. 1-2 sentences, fully in character. Never output Discord mentions or IDs.` },
                { role: "user", content: msg }
            ], { maxTokens: 150 })
            await createSafeMessage(message.channel, `${pet.emoji} **${pet.name}** says:\n> ${result.content}`)
        } catch (err) { console.error("Petsay error:", err.message) }
        return true
    }

    // ── !petstats ──────────────────────────────────────────────────────────────
    if (msgLower === "!petstats") {
        const { pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet! Use \`!adopt [type] [name]\` to get one.`); return true }
        const level = calcPetLevel(pet.xp)
        const hunger = pet.hunger || 0
        const health = pet.health || 100
        const hungerBar = "█".repeat(Math.floor(hunger / 10)) + "░".repeat(10 - Math.floor(hunger / 10))
        const healthBar = "█".repeat(Math.floor(health / 10)) + "░".repeat(10 - Math.floor(health / 10))
        const xpToNext = Math.pow(((level + 1) / 0.15), 2)
        await createSafeMessage(message.channel,
            `${pet.emoji} **${pet.name}** — *${pet.type}*\n\n` +
            `⭐ Level: **${level}** | 📊 XP: **${pet.xp}** / ${Math.floor(xpToNext)}\n` +
            `❤️ Health: \`[${healthBar}]\` ${health}%\n` +
            `🍖 Hunger: \`[${hungerBar}]\` ${hunger}%\n` +
            `😊 Mood: **${pet.mood}**\n` +
            `📅 Adopted: ${new Date(pet.adoptedAt).toDateString()}\n` +
            `🏷️ Rarity: **${pet.rarity || "common"}**`)
        return true
    }

    // ── !petheal ───────────────────────────────────────────────────────────────
    if (msgLower === "!petheal") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet!`); return true }
        if ((pet.health || 100) >= 100) { await createSafeMessage(message.channel, `💚 **${pet.name}** is already at full health!`); return true }
        const { data: ecoData, user } = getUser(userId, senderName)
        const cost = 50
        if (user.coins < cost) { await createSafeMessage(message.channel, `💸 Healing costs **${cost} coins** and you only have **${user.coins}**.`); return true }
        user.coins -= cost
        saveEconomy(ecoData)
        pet.health = 100
        pet.mood = "happy"
        savePets(petData)
        await createSafeMessage(message.channel, `💊 **${senderName}** healed **${pet.emoji} ${pet.name}** to full health! (-${cost} coins)`)
        return true
    }

    // ── !petrename ─────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!petrename")) {
        const newName = message.content.slice(10).trim()
        if (!newName || newName.length > 32) { await createSafeMessage(message.channel, `Usage: \`!petrename [new name]\` (max 32 chars)`); return true }
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet!`); return true }
        const oldName = pet.name
        pet.name = sanitizeName(newName)
        savePets(petData)
        await createSafeMessage(message.channel, `✏️ **${oldName}** has been renamed to **${pet.name}**!`)
        return true
    }

    // ── !pettrain ──────────────────────────────────────────────────────────────
    if (msgLower === "!pettrain") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet!`); return true }
        const cd = checkCooldown(userId, "pettrain", 2 * 60 * 60 * 1000) // 2 hours
        if (!cd.ok) { await createSafeMessage(message.channel, `⏳ **${pet.name}** is still recovering from training. Wait **${Math.floor(cd.remaining / 60)}m**.`); return true }
        const { data: ecoData, user } = getUser(userId, senderName)
        const cost = 30
        if (user.coins < cost) { await createSafeMessage(message.channel, `💸 Training costs **${cost} coins**.`); return true }
        user.coins -= cost
        saveEconomy(ecoData)
        const xpGain = Math.floor(Math.random() * 40) + 20
        pet.xp += xpGain
        pet.trainedAt = new Date().toISOString()
        const newLevel = calcPetLevel(pet.xp)
        savePets(petData)
        // Track pet max level for achievements
        const { data: freshEco, user: freshUser } = getUser(userId, senderName)
        freshUser.stats = freshUser.stats || {}
        freshUser.stats.petMaxLevel = Math.max(freshUser.stats.petMaxLevel || 0, newLevel)
        saveEconomy(freshEco)
        await createSafeMessage(message.channel,
            `🏋️ **${senderName}** trained **${pet.emoji} ${pet.name}**! (+${xpGain} XP, -${cost} coins)\n` +
            `Level: **${newLevel}** | Total XP: **${pet.xp}**`)
        await announce(message, userId, senderName)
        return true
    }

    // ── !petbattle ─────────────────────────────────────────────────────────────
    if (msgLower === "!petbattle") {
        const { pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet! Use \`!adopt\` first.`); return true }
        const cd = checkCooldown(userId, "petbattle", 30 * 60 * 1000) // 30 min
        if (!cd.ok) { await createSafeMessage(message.channel, `⏳ **${pet.name}** needs to rest. Wait **${Math.floor(cd.remaining / 60)}m**.`); return true }

        const petLevel = calcPetLevel(pet.xp)
        const enemyNames = ["Wild Slime", "Shadow Cat", "Chaos Pup", "Void Sprite", "Cursed Toad"]
        const enemy = enemyNames[Math.floor(Math.random() * enemyNames.length)]
        const enemyLevel = Math.max(1, petLevel + Math.floor(Math.random() * 3) - 1)

        const playerScore = Math.random() * petLevel * 10
        const enemyScore = Math.random() * enemyLevel * 10
        const won = playerScore > enemyScore

        const reward = won ? Math.floor(Math.random() * 50) + 20 : 5
        const xpGain = won ? 30 : 10

        const { data: petData } = getPet(userId)
        const currentPet = petData[userId]
        if (currentPet) {
            currentPet.xp += xpGain
            if (!won) currentPet.health = Math.max(10, (currentPet.health || 100) - 20)
            savePets(petData)
        }

        const { data: ecoData, user } = getUser(userId, senderName)
        user.coins += reward
        saveEconomy(ecoData)

        await createSafeMessage(message.channel,
            `⚔️ **Pet Battle: ${pet.emoji} ${pet.name} (Lv.${petLevel}) vs ${enemy} (Lv.${enemyLevel})**\n\n` +
            `${won
                ? `🏆 **${pet.name} WINS!** +${xpGain} XP | +${reward} coins`
                : `💀 **${enemy} wins!** ${pet.name} lost some health. (+${xpGain} XP consolation | +${reward} coins)`
            }`)
        await announce(message, userId, senderName)
        return true
    }

    // ── !petshop ───────────────────────────────────────────────────────────────
    if (msgLower === "!petshop") {
        const typeList = Object.entries(PET_TYPES).map(([t, d]) => `\`${t}\` ${d.emoji} — ${d.desc}`).join("\n")
        await createSafeMessage(message.channel,
            `🐾 **Pet Shop**\n\nAdopt a pet with \`!adopt [type] [name]\`\n\nAvailable types:\n${typeList}\n\n` +
            `**Pet Commands:**\n` +
            `\`!mypet\` — View your pet\n\`!feedpet\` — Feed your pet (10 coins)\n` +
            `\`!petplay\` — Play with your pet\n\`!pettrain\` — Train your pet (30 coins, 2h cooldown)\n` +
            `\`!petbattle\` — Battle wild pets (30m cooldown)\n\`!petheal\` — Heal your pet (50 coins)\n` +
            `\`!petrename [name]\` — Rename your pet\n\`!petstats\` — Detailed pet stats\n\`!petsay [msg]\` — Make your pet speak`)
        return true
    }

    // ── !petinventory ──────────────────────────────────────────────────────────
    if (msgLower === "!petinventory") {
        const { pet } = getPet(userId)
        if (!pet) { await createSafeMessage(message.channel, `🐾 You don't have a pet yet! Use \`!adopt\` to get one.`); return true }
        const level = calcPetLevel(pet.xp)
        const skills = pet.skills?.length ? pet.skills.join(", ") : "None yet (train to unlock skills!)"
        await createSafeMessage(message.channel,
            `🎒 **${pet.emoji} ${pet.name}'s Inventory**\n\n` +
            `⭐ Level: **${level}** | 🏷️ Rarity: **${pet.rarity || "common"}**\n` +
            `🛡️ Skills: ${skills}\n` +
            `❤️ Health: **${pet.health || 100}%** | 🍖 Hunger: **${pet.hunger || 0}%**`)
        return true
    }

    return false
}

module.exports = { handle }
