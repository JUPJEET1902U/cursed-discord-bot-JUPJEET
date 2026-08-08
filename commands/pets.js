const { callAI } = require("../utils/ai")
const { getPet, savePets, PET_TYPES, calcPetLevel } = require("../utils/pets")
const { getUser, saveEconomy, updateQuestProgress, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeName } = require("../utils/sanitizer")
const {
    pets: petsEmbed,
    statusLine,
    cooldownMessage,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

function bar(value, size = 10) {
    const safe = Math.max(0, Math.min(100, Number(value) || 0))
    const filled = Math.round((safe / 100) * size)
    return `${"█".repeat(filled)}${"░".repeat(size - filled)}`
}

function formatTypes() {
    return Object.entries(PET_TYPES)
        .map(([type, definition]) => `\`${type}\` ${definition.emoji} · ${definition.desc}`)
        .join("\n")
}

function missingPet() {
    return statusLine("warning", "You do not have a pet yet. Use `!adopt [type] [name]` to adopt one.")
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower.startsWith("!adopt")) {
        const parts = message.content.split(" ")
        const petType = parts[1]?.toLowerCase()
        const petName = sanitizeName(parts.slice(2).join(" ").trim())
        if (!petType || !PET_TYPES[petType] || !petName) {
            await sendEmbed(message, petsEmbed("Adopt a pet", "Choose a type and give your pet a name.", {
                fields: [
                    { name: "Usage", value: "`!adopt [type] [name]`", inline: false },
                    { name: "Available types", value: formatTypes().slice(0, 1024), inline: false },
                ],
            }))
            return true
        }

        const { data: petData, pet: existing } = getPet(userId)
        if (existing) {
            await sendSafe(message, statusLine("warning", `You already have **${existing.emoji} ${existing.name}**.`))
            return true
        }

        const typeInfo = PET_TYPES[petType]
        petData[userId] = {
            name: petName,
            type: petType,
            emoji: typeInfo.emoji,
            level: 1,
            xp: 0,
            hunger: 100,
            health: 100,
            mood: "happy",
            rarity: "common",
            skills: [],
            lastFed: new Date().toDateString(),
            lastPlay: null,
            adoptedAt: new Date().toISOString(),
        }
        savePets(petData)
        incrementStat(userId, senderName, "petAdopt")
        await sendEmbed(message, petsEmbed("Pet adopted", `${typeInfo.emoji} **${petName}** joined your profile.`, {
            fields: [
                { name: "Type", value: petType, inline: true },
                { name: "Description", value: typeInfo.desc, inline: false },
                { name: "Next", value: "Use `!feedpet`, `!petplay`, or `!petstats`.", inline: false },
            ],
        }))
        return true
    }

    if (msgLower === "!mypet") {
        const { pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const hunger = Math.max(0, Math.min(100, Number(pet.hunger) || 0))
        await sendEmbed(message, petsEmbed(`${pet.emoji} ${pet.name}`, pet.type, {
            fields: [
                { name: "Level", value: String(calcPetLevel(pet.xp)), inline: true },
                { name: "XP", value: String(pet.xp || 0), inline: true },
                { name: "Mood", value: String(pet.mood || "unknown"), inline: true },
                { name: "Hunger", value: `${hunger}%\n\`${bar(hunger)}\``, inline: false },
                { name: "Adopted", value: new Date(pet.adoptedAt).toDateString(), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!feedpet") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const { data: economyData, user } = getUser(userId, senderName)
        const cost = 10
        if (user.coins < cost) {
            await sendSafe(message, statusLine("error", `Feeding costs **${cost} coins**. You have **${user.coins}**.`))
            return true
        }

        user.coins -= cost
        saveEconomy(economyData)
        pet.hunger = Math.min(100, (pet.hunger || 0) + 30)
        pet.xp += 10
        pet.mood = pet.hunger > 70 ? "happy" : "content"
        pet.lastFed = new Date().toDateString()
        savePets(petData)
        updateQuestProgress(userId, senderName, "feedpet")
        incrementStat(userId, senderName, "feedpet")
        await sendEmbed(message, petsEmbed("Pet fed", `${pet.emoji} **${pet.name}** was fed.`, {
            fields: [
                { name: "Cost", value: `${cost} coins`, inline: true },
                { name: "Pet XP", value: "+10", inline: true },
                { name: "Hunger", value: `${pet.hunger}%`, inline: true },
                { name: "Mood", value: pet.mood, inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!petplay") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const cd = checkCooldown(userId, "petplay", 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(pet.name, cd.remaining, "!petplay"))
            return true
        }

        const reward = Math.floor(Math.random() * 30) + 10
        pet.xp += 20
        pet.mood = "excited"
        pet.lastPlay = new Date().toISOString()
        savePets(petData)
        const { data: economyData, user } = getUser(userId, senderName)
        user.coins += reward
        saveEconomy(economyData)
        incrementStat(userId, senderName, "petplay")
        await sendEmbed(message, petsEmbed("Play session", `${pet.emoji} **${pet.name}** had a good play session.`, {
            fields: [
                { name: "Pet XP", value: "+20", inline: true },
                { name: "Coins", value: `+${reward}`, inline: true },
                { name: "Mood", value: pet.mood, inline: true },
            ],
        }))
        return true
    }

    if (msgLower.startsWith("!petsay")) {
        const input = message.content.slice(7).trim()
        if (!input) {
            await sendSafe(message, invalidUsage("!petsay [message]"))
            return true
        }
        const cd = checkCooldown(userId, "petsay", 30 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(null, cd.remaining, "!petsay"))
            return true
        }
        const { pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }

        const typeInfo = PET_TYPES[pet.type]
        const personality = typeInfo.personality.replace("{name}", pet.name)
        try {
            const result = await callAI([
                { role: "system", content: `${personality} Your owner is ${senderName}. Respond in 1-2 sentences, fully in character. Never output Discord mentions or IDs.` },
                { role: "user", content: input },
            ], { maxTokens: 150 })
            await sendEmbed(message, petsEmbed(`${pet.emoji} ${pet.name}`, result.content))
        } catch (error) {
            console.error("Petsay error:", error.message)
            await sendSafe(message, statusLine("error", "Pet dialogue is unavailable right now. Try again in a moment."))
        }
        return true
    }

    if (msgLower === "!petstats") {
        const { pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const level = calcPetLevel(pet.xp)
        const hunger = Math.max(0, Math.min(100, Number(pet.hunger) || 0))
        const health = Math.max(0, Math.min(100, Number(pet.health) || 100))
        const xpToNext = Math.pow(((level + 1) / 0.15), 2)
        await sendEmbed(message, petsEmbed(`${pet.emoji} ${pet.name} • Stats`, pet.type, {
            fields: [
                { name: "Level", value: String(level), inline: true },
                { name: "Rarity", value: String(pet.rarity || "common"), inline: true },
                { name: "XP", value: `${pet.xp || 0} / ${Math.floor(xpToNext)}`, inline: true },
                { name: "Health", value: `${health}%\n\`${bar(health)}\``, inline: false },
                { name: "Hunger", value: `${hunger}%\n\`${bar(hunger)}\``, inline: false },
                { name: "Mood", value: String(pet.mood || "unknown"), inline: true },
                { name: "Adopted", value: new Date(pet.adoptedAt).toDateString(), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!petheal") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        if ((pet.health || 100) >= 100) {
            await sendSafe(message, statusLine("success", `${pet.name} is already at full health.`))
            return true
        }
        const { data: economyData, user } = getUser(userId, senderName)
        const cost = 50
        if (user.coins < cost) {
            await sendSafe(message, statusLine("error", `Healing costs **${cost} coins**. You have **${user.coins}**.`))
            return true
        }
        user.coins -= cost
        saveEconomy(economyData)
        pet.health = 100
        pet.mood = "happy"
        savePets(petData)
        await sendEmbed(message, petsEmbed("Pet healed", `${pet.emoji} **${pet.name}** is back to full health.`, {
            fields: [{ name: "Cost", value: `${cost} coins`, inline: true }],
        }))
        return true
    }

    if (msgLower.startsWith("!petrename")) {
        const newName = sanitizeName(message.content.slice(10).trim())
        if (!newName || newName.length > 32) {
            await sendSafe(message, invalidUsage("!petrename [new name]"))
            return true
        }
        const { data: petData, pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const oldName = pet.name
        pet.name = newName
        savePets(petData)
        await sendSafe(message, statusLine("success", `Pet renamed from **${oldName}** to **${pet.name}**.`))
        return true
    }

    if (msgLower === "!pettrain") {
        const { data: petData, pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const cd = checkCooldown(userId, "pettrain", 2 * 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(pet.name, cd.remaining, "!pettrain"))
            return true
        }
        const { data: economyData, user } = getUser(userId, senderName)
        const cost = 30
        if (user.coins < cost) {
            await sendSafe(message, statusLine("error", `Training costs **${cost} coins**. You have **${user.coins}**.`))
            return true
        }

        user.coins -= cost
        saveEconomy(economyData)
        const xpGain = Math.floor(Math.random() * 40) + 20
        pet.xp += xpGain
        pet.trainedAt = new Date().toISOString()
        const newLevel = calcPetLevel(pet.xp)
        savePets(petData)

        const { data: freshEconomy, user: freshUser } = getUser(userId, senderName)
        freshUser.stats = freshUser.stats || {}
        freshUser.stats.petMaxLevel = Math.max(freshUser.stats.petMaxLevel || 0, newLevel)
        saveEconomy(freshEconomy)

        await sendEmbed(message, petsEmbed("Pet training", `${pet.emoji} **${pet.name}** completed training.`, {
            fields: [
                { name: "XP", value: `+${xpGain}`, inline: true },
                { name: "Cost", value: `${cost} coins`, inline: true },
                { name: "Level", value: String(newLevel), inline: true },
                { name: "Total XP", value: String(pet.xp), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!petbattle") {
        const { pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const cd = checkCooldown(userId, "petbattle", 30 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(pet.name, cd.remaining, "!petbattle"))
            return true
        }

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
        const { data: economyData, user } = getUser(userId, senderName)
        user.coins += reward
        saveEconomy(economyData)

        await sendEmbed(message, petsEmbed("Pet battle", won ? `${pet.name} won.` : `${enemy} won.`, {
            fields: [
                { name: pet.name, value: `Level ${petLevel} · ${Math.floor(playerScore)} points`, inline: true },
                { name: enemy, value: `Level ${enemyLevel} · ${Math.floor(enemyScore)} points`, inline: true },
                { name: "Pet XP", value: `+${xpGain}`, inline: true },
                { name: "Coins", value: `+${reward}`, inline: true },
                ...(won ? [] : [{ name: "Health", value: `${currentPet?.health ?? pet.health ?? 100}%`, inline: true }]),
            ],
        }))
        return true
    }

    if (msgLower === "!petshop") {
        await sendEmbed(message, petsEmbed("Pet guide", "Adopt and manage your companion.", {
            fields: [
                { name: "Available types", value: formatTypes().slice(0, 1024), inline: false },
                { name: "Care", value: "`!mypet` · `!feedpet` · `!petplay` · `!petheal` · `!petstats`", inline: false },
                { name: "Progress", value: "`!pettrain` · `!petbattle` · `!petinventory`", inline: false },
                { name: "Personalize", value: "`!petrename [name]` · `!petsay [message]`", inline: false },
            ],
        }))
        return true
    }

    if (msgLower === "!petinventory") {
        const { pet } = getPet(userId)
        if (!pet) {
            await sendSafe(message, missingPet())
            return true
        }
        const skills = pet.skills?.length ? pet.skills.join(", ") : "None"
        await sendEmbed(message, petsEmbed(`${pet.emoji} ${pet.name} • Inventory`, null, {
            fields: [
                { name: "Level", value: String(calcPetLevel(pet.xp)), inline: true },
                { name: "Rarity", value: String(pet.rarity || "common"), inline: true },
                { name: "Skills", value: skills, inline: false },
                { name: "Health", value: `${pet.health || 100}%`, inline: true },
                { name: "Hunger", value: `${pet.hunger || 0}%`, inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = { handle }
