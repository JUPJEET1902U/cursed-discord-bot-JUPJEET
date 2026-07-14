/**
 * commands/economy-advanced.js
 * Advanced economy features: work, crime, heist, invest, business, factory, bank (Phase 6)
 */

const { getUser, saveEconomy, addXP, incrementStat, updateQuestProgress } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeName } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const log = logger.child("EconomyAdvanced")

const WORK_JOBS = [
    { name: "Software Developer", emoji: "💻", min: 80,  max: 200 },
    { name: "Pizza Delivery",     emoji: "🍕", min: 40,  max: 100 },
    { name: "Street Performer",   emoji: "🎸", min: 20,  max: 150 },
    { name: "Meme Creator",       emoji: "😂", min: 50,  max: 180 },
    { name: "Discord Moderator",  emoji: "🛡️", min: 10,  max: 50  },
    { name: "Crypto Trader",      emoji: "📈", min: 0,   max: 300 },
    { name: "Twitch Streamer",    emoji: "🎮", min: 30,  max: 250 },
    { name: "Bot Developer",      emoji: "🤖", min: 100, max: 220 },
]

const CRIME_OUTCOMES = [
    { name: "pickpocketing",    successRate: 0.6, reward: [50, 150],  penalty: [30, 80]  },
    { name: "hacking",          successRate: 0.4, reward: [100, 300], penalty: [50, 150] },
    { name: "art forgery",      successRate: 0.5, reward: [80, 200],  penalty: [40, 100] },
    { name: "smuggling memes",  successRate: 0.7, reward: [40, 120],  penalty: [20, 60]  },
    { name: "casino cheating",  successRate: 0.35,reward: [150, 400], penalty: [80, 200] },
]

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── !work ──────────────────────────────────────────────────────────────────
    if (msgLower === "!work") {
        const cd = checkCooldown(userId, "work", 60 * 60 * 1000) // 1 hour
        if (!cd.ok) {
            const mins = Math.floor(cd.remaining / 60)
            const secs = cd.remaining % 60
            await createSafeMessage(message.channel, `⏳ **${senderName}**, you're still recovering from work! Come back in **${mins}m ${secs}s**.`)
            return true
        }

        const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)]
        const earned = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min
        const xpEarned = Math.floor(earned / 10)

        const { data, user } = getUser(userId, senderName)
        user.coins += earned
        user.stats = user.stats || {}
        user.stats.workCount = (user.stats.workCount || 0) + 1
        saveEconomy(data)
        addXP(userId, senderName, xpEarned)
        incrementStat(userId, senderName, "work")

        await createSafeMessage(message.channel,
            `${job.emoji} **${senderName}** worked as a **${job.name}** and earned **${earned} coins**! (+${xpEarned} XP)\n` +
            `💰 Balance: **${user.coins} coins** | Come back in 1 hour for more work.`)
        return true
    }

    // ── !crime ─────────────────────────────────────────────────────────────────
    if (msgLower === "!crime") {
        const cd = checkCooldown(userId, "crime", 30 * 60 * 1000) // 30 min
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ Lay low for **${Math.floor(cd.remaining / 60)}m** — the cops are still looking for you.`)
            return true
        }

        const crime = CRIME_OUTCOMES[Math.floor(Math.random() * CRIME_OUTCOMES.length)]
        const success = Math.random() < crime.successRate
        const { data, user } = getUser(userId, senderName)

        if (success) {
            const reward = Math.floor(Math.random() * (crime.reward[1] - crime.reward[0] + 1)) + crime.reward[0]
            user.coins += reward
            user.stats = user.stats || {}
            user.stats.crimeSuccess = (user.stats.crimeSuccess || 0) + 1
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `🦹 **${senderName}** attempted **${crime.name}** and got away with it!\n` +
                `💰 Earned **${reward} coins**! Balance: **${user.coins}**\n*The police are none the wiser... for now.*`)
        } else {
            const penalty = Math.floor(Math.random() * (crime.penalty[1] - crime.penalty[0] + 1)) + crime.penalty[0]
            const actualPenalty = Math.min(penalty, user.coins)
            user.coins = Math.max(0, user.coins - actualPenalty)
            user.stats = user.stats || {}
            user.stats.crimeFail = (user.stats.crimeFail || 0) + 1
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `🚔 **${senderName}** tried **${crime.name}** and got CAUGHT!\n` +
                `💸 Fined **${actualPenalty} coins**! Balance: **${user.coins}**\n*Maybe stick to honest work next time.*`)
        }
        return true
    }

    // ── !heist ─────────────────────────────────────────────────────────────────
    if (msgLower === "!heist") {
        const cd = checkCooldown(userId, "heist", 2 * 60 * 60 * 1000) // 2 hours
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ The vault needs time to restock. Wait **${Math.floor(cd.remaining / 60)}m**.`)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        const minBet = 50
        if (user.coins < minBet) {
            await createSafeMessage(message.channel, `💸 You need at least **${minBet} coins** to fund a heist. Go earn some first!`)
            return true
        }

        const heistCost = Math.floor(user.coins * 0.1) // 10% of balance as entry fee
        const successRate = 0.45
        const success = Math.random() < successRate

        if (success) {
            const multiplier = 2 + Math.random() * 3 // 2x to 5x
            const reward = Math.floor(heistCost * multiplier)
            user.coins = user.coins - heistCost + reward
            user.stats = user.stats || {}
            user.stats.heistSuccess = (user.stats.heistSuccess || 0) + 1
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `🏦 **HEIST SUCCESS!** **${senderName}** and the crew cracked the vault!\n` +
                `💰 Invested **${heistCost}** → Earned **${reward} coins** (${multiplier.toFixed(1)}x)!\n` +
                `Balance: **${user.coins} coins** 🎉`)
        } else {
            user.coins = Math.max(0, user.coins - heistCost)
            user.stats = user.stats || {}
            user.stats.heistFail = (user.stats.heistFail || 0) + 1
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `🚨 **HEIST FAILED!** The alarm went off and **${senderName}** barely escaped!\n` +
                `💸 Lost **${heistCost} coins** in the chaos. Balance: **${user.coins}**\n*The crew is not happy.*`)
        }
        return true
    }

    // ── !invest ────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!invest")) {
        const parts = message.content.split(" ")
        const amount = parseInt(parts[1])
        if (!amount || amount < 10) {
            await createSafeMessage(message.channel, `📈 Usage: \`!invest [amount]\` (min 10 coins)\nInvestments mature in 6 hours with 20-80% returns (or losses).`)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await createSafeMessage(message.channel, `💸 You only have **${user.coins} coins**. Can't invest what you don't have!`)
            return true
        }

        // Check if already has active investment
        if (user.investment && user.investment.maturesAt > Date.now()) {
            const remaining = Math.ceil((user.investment.maturesAt - Date.now()) / 1000 / 60)
            await createSafeMessage(message.channel, `📊 You already have an active investment of **${user.investment.amount} coins** maturing in **${remaining}m**. Use \`!collect\` when ready!`)
            return true
        }

        user.coins -= amount
        user.investment = {
            amount,
            investedAt: Date.now(),
            maturesAt: Date.now() + 6 * 60 * 60 * 1000, // 6 hours
            multiplier: 0.8 + Math.random() * 0.8, // 0.8x to 1.6x
        }
        saveEconomy(data)

        await createSafeMessage(message.channel,
            `📈 **${senderName}** invested **${amount} coins**!\n` +
            `⏰ Your investment matures in **6 hours**. Use \`!collect\` to claim returns.\n` +
            `*Market conditions may vary. CURSED is not a licensed financial advisor.*`)
        return true
    }

    // ── !collect ───────────────────────────────────────────────────────────────
    if (msgLower === "!collect") {
        const { data, user } = getUser(userId, senderName)

        if (!user.investment) {
            await createSafeMessage(message.channel, `📊 You don't have any active investments. Use \`!invest [amount]\` to start one!`)
            return true
        }

        if (user.investment.maturesAt > Date.now()) {
            const remaining = Math.ceil((user.investment.maturesAt - Date.now()) / 1000 / 60)
            await createSafeMessage(message.channel, `⏳ Your investment isn't ready yet! **${remaining}m** remaining.`)
            return true
        }

        const returns = Math.floor(user.investment.amount * user.investment.multiplier)
        const profit = returns - user.investment.amount
        user.coins += returns
        user.stats = user.stats || {}
        user.stats.investmentsClaimed = (user.stats.investmentsClaimed || 0) + 1
        delete user.investment
        saveEconomy(data)

        const profitText = profit >= 0 ? `+${profit}` : `${profit}`
        await createSafeMessage(message.channel,
            `📊 **Investment Matured!** **${senderName}** collected **${returns} coins** (${profitText} profit)!\n` +
            `💰 Balance: **${user.coins} coins**`)
        return true
    }

    // ── !bank ──────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!bank")) {
        const parts = message.content.split(" ")
        const action = parts[1]?.toLowerCase()
        const amount = parseInt(parts[2])

        const { data, user } = getUser(userId, senderName)
        user.bank = user.bank || 0

        if (!action || action === "balance") {
            await createSafeMessage(message.channel,
                `🏦 **${senderName}'s Bank**\n\n` +
                `💰 Wallet: **${user.coins} coins**\n` +
                `🏦 Bank: **${user.bank} coins**\n` +
                `📊 Total: **${user.coins + user.bank} coins**\n\n` +
                `Use \`!bank deposit [amount]\` or \`!bank withdraw [amount]\``)
            return true
        }

        if (action === "deposit") {
            if (!amount || amount < 1) { await createSafeMessage(message.channel, "Usage: `!bank deposit [amount]`"); return true }
            if (user.coins < amount) { await createSafeMessage(message.channel, `💸 You only have **${user.coins} coins** in your wallet!`); return true }
            user.coins -= amount
            user.bank += amount
            saveEconomy(data)
            await createSafeMessage(message.channel, `🏦 Deposited **${amount} coins** into the bank!\n💰 Wallet: **${user.coins}** | 🏦 Bank: **${user.bank}**`)
            return true
        }

        if (action === "withdraw") {
            if (!amount || amount < 1) { await createSafeMessage(message.channel, "Usage: `!bank withdraw [amount]`"); return true }
            if (user.bank < amount) { await createSafeMessage(message.channel, `🏦 You only have **${user.bank} coins** in the bank!`); return true }
            user.bank -= amount
            user.coins += amount
            saveEconomy(data)
            await createSafeMessage(message.channel, `💰 Withdrew **${amount} coins** from the bank!\n💰 Wallet: **${user.coins}** | 🏦 Bank: **${user.bank}**`)
            return true
        }

        await createSafeMessage(message.channel, `🏦 Usage: \`!bank\` | \`!bank deposit [amount]\` | \`!bank withdraw [amount]\``)
        return true
    }

    // ── !interest ──────────────────────────────────────────────────────────────
    if (msgLower === "!interest") {
        const cd = checkCooldown(userId, "interest", 24 * 60 * 60 * 1000) // 24 hours
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ Interest is paid daily. Come back in **${Math.floor(cd.remaining / 3600)}h**.`)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        user.bank = user.bank || 0

        if (user.bank < 100) {
            await createSafeMessage(message.channel, `🏦 You need at least **100 coins** in the bank to earn interest. Deposit more!`)
            return true
        }

        const interestRate = 0.02 // 2% daily
        const interest = Math.floor(user.bank * interestRate)
        user.bank += interest
        saveEconomy(data)

        await createSafeMessage(message.channel,
            `💹 **Daily Interest Earned!** **${senderName}** earned **${interest} coins** (2% of ${user.bank - interest})!\n` +
            `🏦 Bank Balance: **${user.bank} coins**`)
        return true
    }

    // ── !business ──────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!business")) {
        const parts = message.content.split(" ")
        const action = parts[1]?.toLowerCase()
        const { data, user } = getUser(userId, senderName)

        if (!action || action === "status") {
            if (!user.business) {
                await createSafeMessage(message.channel,
                    `🏢 **Business System**\n\nYou don't own a business yet!\n` +
                    `Use \`!business start\` to invest **500 coins** and start earning passive income.\n` +
                    `Use \`!business collect\` to collect earnings every 12 hours.`)
            } else {
                const nextCollect = user.business.lastCollect + 12 * 60 * 60 * 1000
                const ready = Date.now() >= nextCollect
                const remaining = ready ? 0 : Math.ceil((nextCollect - Date.now()) / 1000 / 60)
                await createSafeMessage(message.channel,
                    `🏢 **${senderName}'s Business: ${user.business.name}**\n\n` +
                    `📊 Level: **${user.business.level}** | Total Earned: **${user.business.totalEarned} coins**\n` +
                    `${ready ? "✅ Ready to collect!" : `⏳ Next collection in **${remaining}m**`}\n` +
                    `Use \`!business collect\` to claim earnings | \`!business upgrade\` to level up`)
            }
            return true
        }

        if (action === "start") {
            if (user.business) { await createSafeMessage(message.channel, `🏢 You already own **${user.business.name}**!`); return true }
            const cost = 500
            if (user.coins < cost) { await createSafeMessage(message.channel, `💸 Starting a business costs **${cost} coins**. You have **${user.coins}**.`); return true }
            const bizNames = ["Cursed Café", "Meme Factory", "Chaos Corp", "Shadow Enterprises", "Void Industries"]
            user.coins -= cost
            user.business = {
                name: bizNames[Math.floor(Math.random() * bizNames.length)],
                level: 1,
                lastCollect: Date.now(),
                totalEarned: 0,
            }
            saveEconomy(data)
            await createSafeMessage(message.channel, `🏢 **${senderName}** started **${user.business.name}**! Collect earnings every 12 hours with \`!business collect\`.`)
            return true
        }

        if (action === "collect") {
            if (!user.business) { await createSafeMessage(message.channel, `🏢 You don't have a business! Use \`!business start\`.`); return true }
            const nextCollect = user.business.lastCollect + 12 * 60 * 60 * 1000
            if (Date.now() < nextCollect) {
                const remaining = Math.ceil((nextCollect - Date.now()) / 1000 / 60)
                await createSafeMessage(message.channel, `⏳ Your business needs **${remaining}m** more to generate earnings.`)
                return true
            }
            const baseEarning = 50 * user.business.level
            const earned = Math.floor(baseEarning + Math.random() * baseEarning)
            user.coins += earned
            user.business.lastCollect = Date.now()
            user.business.totalEarned += earned
            saveEconomy(data)
            await createSafeMessage(message.channel, `🏢 **${senderName}** collected **${earned} coins** from **${user.business.name}**!\n💰 Balance: **${user.coins}**`)
            return true
        }

        if (action === "upgrade") {
            if (!user.business) { await createSafeMessage(message.channel, `🏢 You don't have a business! Use \`!business start\`.`); return true }
            const upgradeCost = user.business.level * 300
            if (user.coins < upgradeCost) { await createSafeMessage(message.channel, `💸 Upgrading to level ${user.business.level + 1} costs **${upgradeCost} coins**. You have **${user.coins}**.`); return true }
            user.coins -= upgradeCost
            user.business.level++
            saveEconomy(data)
            await createSafeMessage(message.channel, `📈 **${user.business.name}** upgraded to **Level ${user.business.level}**! Earnings increased!`)
            return true
        }

        return true
    }

    // ── !factory ───────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!factory")) {
        const parts = message.content.split(" ")
        const action = parts[1]?.toLowerCase()
        const { data, user } = getUser(userId, senderName)

        if (!action || action === "status") {
            if (!user.factory) {
                await createSafeMessage(message.channel,
                    `🏭 **Factory System**\n\nNo factory yet! Use \`!factory build\` (cost: 1000 coins) to build one.\n` +
                    `Factories produce items every 8 hours that you can sell with \`!factory sell\`.`)
            } else {
                const nextProd = user.factory.lastProduced + 8 * 60 * 60 * 1000
                const ready = Date.now() >= nextProd
                const remaining = ready ? 0 : Math.ceil((nextProd - Date.now()) / 1000 / 60)
                await createSafeMessage(message.channel,
                    `🏭 **${senderName}'s Factory** (Level ${user.factory.level})\n\n` +
                    `📦 Stock: **${user.factory.stock} units**\n` +
                    `${ready ? "✅ Production ready! Use `!factory produce`" : `⏳ Next production in **${remaining}m**`}\n` +
                    `Use \`!factory sell\` to sell stock for coins.`)
            }
            return true
        }

        if (action === "build") {
            if (user.factory) { await createSafeMessage(message.channel, `🏭 You already have a factory!`); return true }
            const cost = 1000
            if (user.coins < cost) { await createSafeMessage(message.channel, `💸 Building a factory costs **${cost} coins**. You have **${user.coins}**.`); return true }
            user.coins -= cost
            user.factory = { level: 1, stock: 0, lastProduced: 0, totalSold: 0 }
            saveEconomy(data)
            await createSafeMessage(message.channel, `🏭 **${senderName}** built a factory! Use \`!factory produce\` every 8 hours and \`!factory sell\` to earn coins.`)
            return true
        }

        if (action === "produce") {
            if (!user.factory) { await createSafeMessage(message.channel, `🏭 Build a factory first with \`!factory build\`!`); return true }
            const nextProd = user.factory.lastProduced + 8 * 60 * 60 * 1000
            if (Date.now() < nextProd) {
                const remaining = Math.ceil((nextProd - Date.now()) / 1000 / 60)
                await createSafeMessage(message.channel, `⏳ Factory is still running. **${remaining}m** until production completes.`)
                return true
            }
            const produced = 5 * user.factory.level + Math.floor(Math.random() * 5)
            user.factory.stock += produced
            user.factory.lastProduced = Date.now()
            saveEconomy(data)
            await createSafeMessage(message.channel, `🏭 Factory produced **${produced} units**! Total stock: **${user.factory.stock}**. Use \`!factory sell\` to cash out.`)
            return true
        }

        if (action === "sell") {
            if (!user.factory) { await createSafeMessage(message.channel, `🏭 Build a factory first!`); return true }
            if (user.factory.stock <= 0) { await createSafeMessage(message.channel, `📦 No stock to sell! Use \`!factory produce\` first.`); return true }
            const pricePerUnit = 15 + user.factory.level * 5
            const earned = user.factory.stock * pricePerUnit
            user.coins += earned
            user.factory.totalSold += user.factory.stock
            user.factory.stock = 0
            saveEconomy(data)
            await createSafeMessage(message.channel, `💰 Sold all factory stock for **${earned} coins**! Balance: **${user.coins}**`)
            return true
        }

        return true
    }

    return false
}

module.exports = { handle }
