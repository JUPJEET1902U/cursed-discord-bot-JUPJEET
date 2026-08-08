const {
    CURRENCY,
    MEDALS,
    SHOP,
    loadEconomy,
    saveEconomy,
    getUser,
    calcLevel,
    xpToNextLevel,
    addCoins,
    incrementStat,
    updateQuestProgress,
} = require("../utils/economy")
const {
    economy: economyEmbed,
    statusLine,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

function formatCoins(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("en-US")
}

function progressBar(current, target, size = 10) {
    const ratio = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0
    const filled = Math.round(ratio * size)
    return `${"█".repeat(filled)}${"░".repeat(size - filled)}`
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower === "!daily") {
        const { data, user } = getUser(userId, senderName)
        const today = new Date().toDateString()
        if (user.lastDaily === today) {
            await sendSafe(message, statusLine("cooldown", "Daily reward already claimed. Try again tomorrow."))
            return true
        }

        let coinsEarned = Math.floor(Math.random() * 251) + 50
        const xpEarned = 50
        const boosted = (user.dailyBoost || 0) > 0
        if (boosted) {
            coinsEarned *= 2
            user.dailyBoost--
        }
        user.coins += coinsEarned
        user.xp += xpEarned
        user.level = calcLevel(user.xp)
        user.lastDaily = today
        user.stats = user.stats || {}
        user.stats.dailyClaimed = (user.stats.dailyClaimed || 0) + 1
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "dailyClaimed")

        await sendEmbed(message, economyEmbed("Daily reward", boosted ? "Daily Boost applied." : "Reward claimed.", {
            fields: [
                { name: "Coins", value: `+${formatCoins(coinsEarned)} ${CURRENCY}`, inline: true },
                { name: "XP", value: `+${xpEarned}`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
                { name: "Level", value: String(user.level), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!balance" || msgLower === "!bal") {
        const { user } = getUser(userId, senderName)
        const nextLevelXP = xpToNextLevel(user.level)
        const badges = [user.prestige ? "Prestige" : null, user.badge ? "Cursed Badge" : null, user.vip ? "VIP" : null].filter(Boolean)
        const perks = [
            (user.roastShield || 0) > 0 ? `Roast Shield ×${user.roastShield}` : null,
            (user.xpBoost || 0) > 0 ? `XP Boost ×${user.xpBoost}` : null,
            (user.dailyBoost || 0) > 0 ? "Daily Boost ready" : null,
        ].filter(Boolean)

        const fields = [
            { name: "Coins", value: formatCoins(user.coins), inline: true },
            { name: "Level", value: String(user.level), inline: true },
            { name: "XP", value: `${formatCoins(user.xp)} / ${formatCoins(Math.floor(nextLevelXP))}\n\`${progressBar(user.xp, nextLevelXP)}\``, inline: false },
        ]
        if (badges.length) fields.push({ name: "Items", value: badges.join(" · "), inline: false })
        if (perks.length) fields.push({ name: "Active perks", value: perks.join(" · "), inline: false })

        await sendEmbed(message, economyEmbed(`${senderName}'s balance`, null, { fields }))
        return true
    }

    if (msgLower === "!rank") {
        const { user } = getUser(userId, senderName)
        const allUsers = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp)
        const rank = allUsers.findIndex(entry => entry.name === senderName) + 1
        const nextLevelXP = xpToNextLevel(user.level)
        await sendEmbed(message, economyEmbed(`${senderName}'s rank`, null, {
            fields: [
                { name: "Server rank", value: rank > 0 ? `#${rank}` : "Unranked", inline: true },
                { name: "Level", value: String(user.level), inline: true },
                { name: "XP", value: `${formatCoins(user.xp)} / ${formatCoins(Math.floor(nextLevelXP))}`, inline: true },
                { name: "Coins", value: formatCoins(user.coins), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!give" || msgLower.startsWith("!give ")) {
        const mentioned = message.mentions.users.first()
        const parts = message.content.split(" ")
        const amount = parseInt(parts[parts.length - 1], 10)
        if (!mentioned || Number.isNaN(amount) || amount <= 0) {
            await sendSafe(message, invalidUsage("!give @user [amount]"))
            return true
        }
        if (mentioned.id === userId) {
            await sendSafe(message, statusLine("warning", "You cannot transfer coins to yourself."))
            return true
        }

        const { user: sender } = getUser(userId, senderName)
        if (sender.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(sender.coins)} coins**.`))
            return true
        }

        const targetName = message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username
        addCoins(userId, senderName, -amount)
        addCoins(mentioned.id, targetName, amount)
        incrementStat(userId, senderName, "give")
        updateQuestProgress(userId, senderName, "give")
        await sendEmbed(message, economyEmbed("Transfer complete", null, {
            fields: [
                { name: "From", value: senderName, inline: true },
                { name: "To", value: targetName, inline: true },
                { name: "Amount", value: `${formatCoins(amount)} ${CURRENCY}`, inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!richlist") {
        const sorted = Object.values(loadEconomy()).sort((a, b) => b.coins - a.coins).slice(0, 10)
        if (!sorted.length) {
            await sendSafe(message, "No economy activity yet. Use `!daily` to get started.")
            return true
        }
        const lines = sorted.map((user, index) => `${MEDALS[index] || `#${index + 1}`} **${user.name}** · ${formatCoins(user.coins)} coins`)
        await sendEmbed(message, economyEmbed("Rich list", lines.join("\n"), { timestamp: false }))
        return true
    }

    if (msgLower === "!levels") {
        const sorted = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp).slice(0, 10)
        if (!sorted.length) {
            await sendSafe(message, "No XP activity yet. Start chatting to earn XP.")
            return true
        }
        const lines = sorted.map((user, index) => `${MEDALS[index] || `#${index + 1}`} **${user.name}** · Level ${user.level} · ${formatCoins(user.xp)} XP`)
        await sendEmbed(message, economyEmbed("Level leaderboard", lines.join("\n"), { timestamp: false }))
        return true
    }

    if (msgLower === "!shop") {
        const lines = Object.entries(SHOP).map(([id, item]) => `**${item.name}** · ${formatCoins(item.price)} coins\n\`${`!buy ${id}`}\` · ${item.desc}`)
        await sendEmbed(message, economyEmbed("Shop", lines.join("\n\n"), { timestamp: false }))
        return true
    }

    if (msgLower.startsWith("!buy ")) {
        const itemId = message.content.slice(5).trim().toLowerCase()
        const item = SHOP[itemId]
        if (!item) {
            await sendSafe(message, statusLine("error", "Item not found. Use `!shop` to view available items."))
            return true
        }
        const { data, user } = getUser(userId, senderName)
        if (item.once && user[item.key]) {
            await sendSafe(message, statusLine("warning", `You already own **${item.name}**.`))
            return true
        }
        if (user.coins < item.price) {
            await sendSafe(message, statusLine("error", `You need **${formatCoins(item.price)} coins** and have **${formatCoins(user.coins)}**.`))
            return true
        }

        user.coins -= item.price
        if (item.once) user[item.key] = true
        else user[item.key] = (user[item.key] || 0) + item.value
        saveEconomy(data)
        await sendEmbed(message, economyEmbed("Purchase complete", null, {
            fields: [
                { name: "Item", value: item.name, inline: true },
                { name: "Cost", value: `${formatCoins(item.price)} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = { handle }
