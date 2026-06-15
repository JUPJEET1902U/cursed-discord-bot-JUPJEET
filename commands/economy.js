const {
    CURRENCY, MEDALS, SHOP, loadEconomy, saveEconomy, getUser,
    calcLevel, xpToNextLevel, addCoins, incrementStat,
    updateQuestProgress, checkAndGrantAchievements
} = require("../utils/economy")
const { validateAmount } = require("../utils/inputValidator")
const { ECONOMY } = require("../config/constants")

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

    if (msgLower === "!daily") {
        const { data, user } = getUser(userId, senderName)
        const today = new Date().toDateString()
        if (user.lastDaily === today) {
            await message.channel.send(`⏳ **${senderName}**, you already claimed your daily today. Come back tomorrow — and maybe do something useful in the meantime. 😏`)
            return true
        }
        let coinsEarned = Math.floor(Math.random() * (ECONOMY.DAILY_MAX - ECONOMY.DAILY_MIN + 1)) + ECONOMY.DAILY_MIN
        const xpEarned = 50
        const boosted = (user.dailyBoost || 0) > 0
        if (boosted) { coinsEarned *= 2; user.dailyBoost-- }
        user.coins += coinsEarned
        user.xp += xpEarned
        user.level = calcLevel(user.xp)
        user.lastDaily = today
        user.stats = user.stats || {}
        user.stats.dailyClaimed = (user.stats.dailyClaimed || 0) + 1
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "dailyClaimed")
        const boostNote = boosted ? " *(🎲 Daily Boost applied — double coins!)*" : ""
        await message.channel.send(`🎁 **Daily Reward Claimed!**${boostNote}\n\n**${senderName}** got **${coinsEarned} ${CURRENCY}** + **${xpEarned} XP**!\nBalance: **${user.coins} coins** | Level: **${user.level}**\n\nCome back tomorrow. Try not to waste it. 🙄`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!balance" || msgLower === "!bal") {
        const { user } = getUser(userId, senderName)
        const nextLevelXP = xpToNextLevel(user.level)
        const progress = Math.floor((user.xp / nextLevelXP) * 10)
        const bar = "█".repeat(progress) + "░".repeat(10 - progress)
        const badges = [user.prestige ? "🌟 Prestige" : null, user.badge ? "💀 Cursed Badge" : null, user.vip ? "⭐ VIP" : null].filter(Boolean)
        const badgeLine = badges.length ? `\n🏅 **Items:** ${badges.join(" | ")}` : ""
        const perks = [
            (user.roastShield || 0) > 0 ? `🛡️ Shield (${user.roastShield} left)` : null,
            (user.xpBoost || 0) > 0 ? `💥 XP Boost (${user.xpBoost} left)` : null,
            (user.dailyBoost || 0) > 0 ? `🎲 Daily Boost ready!` : null
        ].filter(Boolean)
        const perksLine = perks.length ? `\n⚡ **Active:** ${perks.join(" | ")}` : ""
        const achCount = (user.achievements || []).length
        await message.channel.send(`💰 **${senderName}'s Balance**\n\n🪙 **Coins:** ${user.coins}\n⭐ **Level:** ${user.level}\n📊 **XP:** ${user.xp} / ${Math.floor(nextLevelXP)}\n\`[${bar}]\`\n🏆 **Achievements:** ${achCount}${badgeLine}${perksLine}`)
        return true
    }

    if (msgLower === "!rank") {
        const { user } = getUser(userId, senderName)
        const allUsers = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp)
        const rank = allUsers.findIndex(u => u.name === senderName) + 1
        const nextLevelXP = xpToNextLevel(user.level)
        const badges = [user.prestige ? "🌟" : null, user.badge ? "💀" : null, user.vip ? "⭐" : null].filter(Boolean).join(" ")
        await message.channel.send(`${badges ? badges + " " : ""}**${senderName}'s Rank**\n\n🏅 Server Rank: **#${rank}**\n⭐ Level: **${user.level}**\n📊 XP: **${user.xp}** / ${Math.floor(nextLevelXP)} to next level\n🪙 Coins: **${user.coins}**`)
        return true
    }

    if (msgLower.startsWith("!give")) {
        const mentioned = message.mentions.users.first()
        const parts = message.content.split(" ")
        const amountValidation = validateAmount(parts[parts.length - 1])
        if (!mentioned || !amountValidation.ok) {
            await message.channel.send("Usage: `!give @user [amount]`")
            return true
        }
        const amount = amountValidation.value
        const { user: sender } = getUser(userId, senderName)
        if (sender.coins < amount) {
            await message.channel.send(`😂 **${senderName}**, you only have **${sender.coins} coins**. You can't give what you don't have, broke.`)
            return true
        }
        const targetName = message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username
        addCoins(userId, senderName, -amount)
        addCoins(mentioned.id, targetName, amount)
        incrementStat(userId, senderName, "give")
        updateQuestProgress(userId, senderName, "give")
        await message.channel.send(`💸 **${senderName}** gave **${amount} ${CURRENCY}** to **${targetName}**! How generous... or suspicious. 👀`)
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower === "!richlist") {
        const data = loadEconomy()
        const sorted = Object.values(data).sort((a, b) => b.coins - a.coins).slice(0, 10)
        if (sorted.length === 0) { await message.channel.send("Nobody has coins yet! Type `!daily` to start earning."); return true }
        const lines = sorted.map((u, i) => `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — 🪙 ${u.coins} coins`)
        await message.channel.send(`🏦 **CURSED RICH LIST** 🏦\n\n${lines.join("\n")}`)
        return true
    }

    if (msgLower === "!levels") {
        const data = loadEconomy()
        const sorted = Object.values(data).sort((a, b) => b.xp - a.xp).slice(0, 10)
        if (sorted.length === 0) { await message.channel.send("Nobody has XP yet! Start chatting to earn XP."); return true }
        const lines = sorted.map((u, i) => `${MEDALS[i] || `**#${i + 1}**`} **${u.name}** — ⭐ Level ${u.level} | 📊 ${u.xp} XP`)
        await message.channel.send(`⭐ **CURSED LEVELS LEADERBOARD** ⭐\n\n${lines.join("\n")}`)
        return true
    }

    if (msgLower === "!shop") {
        const lines = Object.entries(SHOP).map(([id, item]) =>
            `\`!buy ${id}\` — ${item.name} — **${item.price} coins**\n  ↳ ${item.desc}`
        )
        await message.channel.send(`🛒 **CURSED SHOP**\n\n${lines.join("\n\n")}\n\nUse \`!balance\` to check your coins.`)
        return true
    }

    if (msgLower.startsWith("!buy ")) {
        const itemId = message.content.slice(5).trim().toLowerCase()
        const item = SHOP[itemId]
        if (!item) { await message.channel.send(`❌ Item not found. Type \`!shop\` to see what's available, genius.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (item.once && user[item.key]) {
            await message.channel.send(`😒 **${senderName}**, you already own **${item.name}**. Can't buy it twice, greedy.`)
            return true
        }
        if (user.coins < item.price) {
            await message.channel.send(`💸 **${senderName}**, you need **${item.price} coins** but only have **${user.coins}**. Go do \`!daily\` first, broke.`)
            return true
        }
        user.coins -= item.price
        if (item.once) user[item.key] = true
        else user[item.key] = (user[item.key] || 0) + item.value
        saveEconomy(data)
        await message.channel.send(`✅ **${senderName}** bought **${item.name}** for **${item.price} coins**! Balance: **${user.coins} coins**. Enjoy it while it lasts. 😏`)
        await announce(message, userId, senderName)
        return true
    }

    return false
}

module.exports = { handle }
