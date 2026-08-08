/**
 * Advanced economy: work, crime, heist, investments, banking, businesses and factories.
 */

const { getUser, saveEconomy, addXP, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeName } = require("../utils/sanitizer")
const {
    economy: economyEmbed,
    statusLine,
    cooldownMessage,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const WORK_JOBS = [
    { name: "Software Developer", min: 80, max: 200 },
    { name: "Pizza Delivery", min: 40, max: 100 },
    { name: "Street Performer", min: 20, max: 150 },
    { name: "Meme Creator", min: 50, max: 180 },
    { name: "Discord Moderator", min: 10, max: 50 },
    { name: "Crypto Trader", min: 0, max: 300 },
    { name: "Twitch Streamer", min: 30, max: 250 },
    { name: "Bot Developer", min: 100, max: 220 },
]

const CRIME_OUTCOMES = [
    { name: "pickpocketing", successRate: 0.6, reward: [50, 150], penalty: [30, 80] },
    { name: "hacking", successRate: 0.4, reward: [100, 300], penalty: [50, 150] },
    { name: "art forgery", successRate: 0.5, reward: [80, 200], penalty: [40, 100] },
    { name: "smuggling memes", successRate: 0.7, reward: [40, 120], penalty: [20, 60] },
    { name: "casino cheating", successRate: 0.35, reward: [150, 400], penalty: [80, 200] },
]

function formatCoins(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("en-US")
}

function randomBetween([min, max]) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function remainingText(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const secs = total % 60
    if (hours) return `${hours}h ${minutes}m`
    if (minutes) return `${minutes}m ${secs}s`
    return `${secs}s`
}

function economyResult(title, fields, description = null) {
    return economyEmbed(title, description, { fields })
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower === "!work") {
        const cd = checkCooldown(userId, "work", 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!work"))
            return true
        }

        const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)]
        const earned = randomBetween([job.min, job.max])
        const xpEarned = Math.floor(earned / 10)
        const { data, user } = getUser(userId, senderName)
        user.coins += earned
        user.stats = user.stats || {}
        user.stats.workCount = (user.stats.workCount || 0) + 1
        saveEconomy(data)
        addXP(userId, senderName, xpEarned)
        incrementStat(userId, senderName, "work")

        await sendEmbed(message, economyResult("Work complete", [
            { name: "Job", value: job.name, inline: true },
            { name: "Coins", value: `+${earned}`, inline: true },
            { name: "XP", value: `+${xpEarned}`, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower === "!crime") {
        const cd = checkCooldown(userId, "crime", 30 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!crime"))
            return true
        }

        const crime = CRIME_OUTCOMES[Math.floor(Math.random() * CRIME_OUTCOMES.length)]
        const success = Math.random() < crime.successRate
        const { data, user } = getUser(userId, senderName)
        user.stats = user.stats || {}

        let delta
        if (success) {
            delta = randomBetween(crime.reward)
            user.coins += delta
            user.stats.crimeSuccess = (user.stats.crimeSuccess || 0) + 1
        } else {
            const penalty = randomBetween(crime.penalty)
            delta = -Math.min(penalty, user.coins)
            user.coins = Math.max(0, user.coins + delta)
            user.stats.crimeFail = (user.stats.crimeFail || 0) + 1
        }
        saveEconomy(data)

        await sendEmbed(message, economyResult("Crime result", [
            { name: "Attempt", value: crime.name, inline: true },
            { name: "Outcome", value: success ? "Success" : "Caught", inline: true },
            { name: "Coins", value: `${delta >= 0 ? "+" : ""}${delta}`, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower === "!heist") {
        const cd = checkCooldown(userId, "heist", 2 * 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!heist"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        const minBalance = 50
        if (user.coins < minBalance) {
            await sendSafe(message, statusLine("error", `You need at least **${minBalance} coins** to start a heist.`))
            return true
        }

        const cost = Math.floor(user.coins * 0.1)
        const success = Math.random() < 0.45
        user.stats = user.stats || {}
        let reward = 0
        let multiplier = null
        if (success) {
            multiplier = 2 + Math.random() * 3
            reward = Math.floor(cost * multiplier)
            user.coins = user.coins - cost + reward
            user.stats.heistSuccess = (user.stats.heistSuccess || 0) + 1
        } else {
            user.coins = Math.max(0, user.coins - cost)
            user.stats.heistFail = (user.stats.heistFail || 0) + 1
        }
        saveEconomy(data)

        await sendEmbed(message, economyResult("Heist result", [
            { name: "Outcome", value: success ? "Success" : "Failed", inline: true },
            { name: "Entry cost", value: `${cost} coins`, inline: true },
            { name: "Return", value: success ? `${reward} coins · ${multiplier.toFixed(1)}×` : "0 coins", inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!invest")) {
        const amount = parseInt(message.content.split(" ")[1], 10)
        if (!amount || amount < 10) {
            await sendSafe(message, invalidUsage("!invest [amount]"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }
        if (user.investment && user.investment.maturesAt > Date.now()) {
            const seconds = Math.ceil((user.investment.maturesAt - Date.now()) / 1000)
            await sendEmbed(message, economyResult("Active investment", [
                { name: "Principal", value: `${formatCoins(user.investment.amount)} coins`, inline: true },
                { name: "Matures in", value: remainingText(seconds), inline: true },
            ], "Use `!collect` when the investment matures."))
            return true
        }

        user.coins -= amount
        user.investment = {
            amount,
            investedAt: Date.now(),
            maturesAt: Date.now() + 6 * 60 * 60 * 1000,
            multiplier: 0.8 + Math.random() * 0.8,
        }
        saveEconomy(data)
        await sendEmbed(message, economyResult("Investment opened", [
            { name: "Principal", value: `${formatCoins(amount)} coins`, inline: true },
            { name: "Maturity", value: "6 hours", inline: true },
            { name: "Possible return", value: "0.8× to 1.6×", inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ], "This is an in-bot game mechanic, not a real financial product."))
        return true
    }

    if (msgLower === "!collect") {
        const { data, user } = getUser(userId, senderName)
        if (!user.investment) {
            await sendSafe(message, statusLine("warning", "You do not have an active investment. Use `!invest [amount]` to start one."))
            return true
        }
        if (user.investment.maturesAt > Date.now()) {
            const seconds = Math.ceil((user.investment.maturesAt - Date.now()) / 1000)
            await sendSafe(message, statusLine("cooldown", `Investment matures in **${remainingText(seconds)}**.`))
            return true
        }

        const principal = user.investment.amount
        const returns = Math.floor(principal * user.investment.multiplier)
        const profit = returns - principal
        user.coins += returns
        user.stats = user.stats || {}
        user.stats.investmentsClaimed = (user.stats.investmentsClaimed || 0) + 1
        delete user.investment
        saveEconomy(data)

        await sendEmbed(message, economyResult("Investment collected", [
            { name: "Principal", value: `${formatCoins(principal)} coins`, inline: true },
            { name: "Returned", value: `${formatCoins(returns)} coins`, inline: true },
            { name: "Profit / loss", value: `${profit >= 0 ? "+" : ""}${profit} coins`, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!bank")) {
        const parts = message.content.split(" ")
        const action = parts[1]?.toLowerCase()
        const amount = parseInt(parts[2], 10)
        const { data, user } = getUser(userId, senderName)
        user.bank = user.bank || 0

        if (!action || action === "balance") {
            await sendEmbed(message, economyResult(`${senderName}'s bank`, [
                { name: "Wallet", value: `${formatCoins(user.coins)} coins`, inline: true },
                { name: "Bank", value: `${formatCoins(user.bank)} coins`, inline: true },
                { name: "Total", value: `${formatCoins(user.coins + user.bank)} coins`, inline: true },
            ], "Use `!bank deposit [amount]` or `!bank withdraw [amount]`."))
            return true
        }

        if (action === "deposit") {
            if (!amount || amount < 1) {
                await sendSafe(message, invalidUsage("!bank deposit [amount]"))
                return true
            }
            if (user.coins < amount) {
                await sendSafe(message, statusLine("error", `Wallet balance is **${formatCoins(user.coins)} coins**.`))
                return true
            }
            user.coins -= amount
            user.bank += amount
            saveEconomy(data)
            await sendEmbed(message, economyResult("Bank deposit", [
                { name: "Deposited", value: `${formatCoins(amount)} coins`, inline: true },
                { name: "Wallet", value: `${formatCoins(user.coins)} coins`, inline: true },
                { name: "Bank", value: `${formatCoins(user.bank)} coins`, inline: true },
            ]))
            return true
        }

        if (action === "withdraw") {
            if (!amount || amount < 1) {
                await sendSafe(message, invalidUsage("!bank withdraw [amount]"))
                return true
            }
            if (user.bank < amount) {
                await sendSafe(message, statusLine("error", `Bank balance is **${formatCoins(user.bank)} coins**.`))
                return true
            }
            user.bank -= amount
            user.coins += amount
            saveEconomy(data)
            await sendEmbed(message, economyResult("Bank withdrawal", [
                { name: "Withdrawn", value: `${formatCoins(amount)} coins`, inline: true },
                { name: "Wallet", value: `${formatCoins(user.coins)} coins`, inline: true },
                { name: "Bank", value: `${formatCoins(user.bank)} coins`, inline: true },
            ]))
            return true
        }

        await sendSafe(message, invalidUsage("!bank [deposit|withdraw] [amount]"))
        return true
    }

    if (msgLower === "!interest") {
        const cd = checkCooldown(userId, "interest", 24 * 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!interest"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        user.bank = user.bank || 0
        if (user.bank < 100) {
            await sendSafe(message, statusLine("warning", "Keep at least **100 coins** in the bank to claim daily interest."))
            return true
        }

        const balanceBefore = user.bank
        const interest = Math.floor(balanceBefore * 0.02)
        user.bank += interest
        saveEconomy(data)
        await sendEmbed(message, economyResult("Daily bank interest", [
            { name: "Rate", value: "2%", inline: true },
            { name: "Interest", value: `+${formatCoins(interest)} coins`, inline: true },
            { name: "Bank balance", value: `${formatCoins(user.bank)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!business")) {
        const action = message.content.split(" ")[1]?.toLowerCase()
        const { data, user } = getUser(userId, senderName)

        if (!action || action === "status") {
            if (!user.business) {
                await sendEmbed(message, economyResult("Business", [
                    { name: "Status", value: "Not owned", inline: true },
                    { name: "Start cost", value: "500 coins", inline: true },
                    { name: "Command", value: "`!business start`", inline: false },
                ], "Businesses generate collectible income every 12 hours."))
                return true
            }
            const nextCollect = user.business.lastCollect + 12 * 60 * 60 * 1000
            const ready = Date.now() >= nextCollect
            const remainingSeconds = ready ? 0 : Math.ceil((nextCollect - Date.now()) / 1000)
            await sendEmbed(message, economyResult(user.business.name, [
                { name: "Level", value: String(user.business.level), inline: true },
                { name: "Total earned", value: `${formatCoins(user.business.totalEarned)} coins`, inline: true },
                { name: "Collection", value: ready ? "Ready" : remainingText(remainingSeconds), inline: true },
            ], "Use `!business collect` or `!business upgrade`."))
            return true
        }

        if (action === "start") {
            if (user.business) {
                await sendSafe(message, statusLine("warning", `You already own **${user.business.name}**.`))
                return true
            }
            const cost = 500
            if (user.coins < cost) {
                await sendSafe(message, statusLine("error", `Starting a business costs **${cost} coins**. You have **${formatCoins(user.coins)}**.`))
                return true
            }
            const names = ["Cursed Café", "Meme Factory", "Chaos Corp", "Shadow Enterprises", "Void Industries"]
            user.coins -= cost
            user.business = {
                name: names[Math.floor(Math.random() * names.length)],
                level: 1,
                lastCollect: Date.now(),
                totalEarned: 0,
            }
            saveEconomy(data)
            await sendEmbed(message, economyResult("Business started", [
                { name: "Business", value: user.business.name, inline: true },
                { name: "Cost", value: `${cost} coins`, inline: true },
                { name: "Collection interval", value: "12 hours", inline: true },
            ]))
            return true
        }

        if (action === "collect") {
            if (!user.business) {
                await sendSafe(message, statusLine("warning", "Start a business first with `!business start`."))
                return true
            }
            const nextCollect = user.business.lastCollect + 12 * 60 * 60 * 1000
            if (Date.now() < nextCollect) {
                await sendSafe(message, statusLine("cooldown", `Business income is ready in **${remainingText(Math.ceil((nextCollect - Date.now()) / 1000))}**.`))
                return true
            }
            const base = 50 * user.business.level
            const earned = Math.floor(base + Math.random() * base)
            user.coins += earned
            user.business.lastCollect = Date.now()
            user.business.totalEarned += earned
            saveEconomy(data)
            await sendEmbed(message, economyResult("Business income", [
                { name: "Business", value: user.business.name, inline: true },
                { name: "Collected", value: `+${earned} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ]))
            return true
        }

        if (action === "upgrade") {
            if (!user.business) {
                await sendSafe(message, statusLine("warning", "Start a business first with `!business start`."))
                return true
            }
            const upgradeCost = user.business.level * 300
            if (user.coins < upgradeCost) {
                await sendSafe(message, statusLine("error", `Upgrade cost is **${upgradeCost} coins**. You have **${formatCoins(user.coins)}**.`))
                return true
            }
            user.coins -= upgradeCost
            user.business.level++
            saveEconomy(data)
            await sendEmbed(message, economyResult("Business upgraded", [
                { name: "Business", value: user.business.name, inline: true },
                { name: "Level", value: String(user.business.level), inline: true },
                { name: "Cost", value: `${upgradeCost} coins`, inline: true },
            ]))
            return true
        }

        await sendSafe(message, invalidUsage("!business [status|start|collect|upgrade]"))
        return true
    }

    if (msgLower.startsWith("!factory")) {
        const action = message.content.split(" ")[1]?.toLowerCase()
        const { data, user } = getUser(userId, senderName)

        if (!action || action === "status") {
            if (!user.factory) {
                await sendEmbed(message, economyResult("Factory", [
                    { name: "Status", value: "Not owned", inline: true },
                    { name: "Build cost", value: "1,000 coins", inline: true },
                    { name: "Command", value: "`!factory build`", inline: false },
                ], "Factories produce sellable stock every 8 hours."))
                return true
            }
            const nextProduction = user.factory.lastProduced + 8 * 60 * 60 * 1000
            const ready = Date.now() >= nextProduction
            await sendEmbed(message, economyResult(`${senderName}'s factory`, [
                { name: "Level", value: String(user.factory.level), inline: true },
                { name: "Stock", value: `${user.factory.stock} units`, inline: true },
                { name: "Production", value: ready ? "Ready" : remainingText(Math.ceil((nextProduction - Date.now()) / 1000)), inline: true },
                { name: "Total sold", value: `${user.factory.totalSold || 0} units`, inline: true },
            ], "Use `!factory produce` and `!factory sell`."))
            return true
        }

        if (action === "build") {
            if (user.factory) {
                await sendSafe(message, statusLine("warning", "You already own a factory."))
                return true
            }
            const cost = 1000
            if (user.coins < cost) {
                await sendSafe(message, statusLine("error", `Building a factory costs **${cost} coins**. You have **${formatCoins(user.coins)}**.`))
                return true
            }
            user.coins -= cost
            user.factory = { level: 1, stock: 0, lastProduced: 0, totalSold: 0 }
            saveEconomy(data)
            await sendEmbed(message, economyResult("Factory built", [
                { name: "Level", value: "1", inline: true },
                { name: "Cost", value: `${cost} coins`, inline: true },
                { name: "Production interval", value: "8 hours", inline: true },
            ]))
            return true
        }

        if (action === "produce") {
            if (!user.factory) {
                await sendSafe(message, statusLine("warning", "Build a factory first with `!factory build`."))
                return true
            }
            const nextProduction = user.factory.lastProduced + 8 * 60 * 60 * 1000
            if (Date.now() < nextProduction) {
                await sendSafe(message, statusLine("cooldown", `Production completes in **${remainingText(Math.ceil((nextProduction - Date.now()) / 1000))}**.`))
                return true
            }
            const produced = 5 * user.factory.level + Math.floor(Math.random() * 5)
            user.factory.stock += produced
            user.factory.lastProduced = Date.now()
            saveEconomy(data)
            await sendEmbed(message, economyResult("Factory production", [
                { name: "Produced", value: `${produced} units`, inline: true },
                { name: "Stock", value: `${user.factory.stock} units`, inline: true },
            ]))
            return true
        }

        if (action === "sell") {
            if (!user.factory) {
                await sendSafe(message, statusLine("warning", "Build a factory first with `!factory build`."))
                return true
            }
            if (user.factory.stock <= 0) {
                await sendSafe(message, statusLine("warning", "No factory stock is available. Use `!factory produce` first."))
                return true
            }
            const stock = user.factory.stock
            const pricePerUnit = 15 + user.factory.level * 5
            const earned = stock * pricePerUnit
            user.coins += earned
            user.factory.totalSold += stock
            user.factory.stock = 0
            saveEconomy(data)
            await sendEmbed(message, economyResult("Factory sale", [
                { name: "Units sold", value: String(stock), inline: true },
                { name: "Price per unit", value: `${pricePerUnit} coins`, inline: true },
                { name: "Earned", value: `+${earned} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ]))
            return true
        }

        await sendSafe(message, invalidUsage("!factory [status|build|produce|sell]"))
        return true
    }

    return false
}

module.exports = { handle }
