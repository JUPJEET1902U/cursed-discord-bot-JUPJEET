const { getUser, saveEconomy, updateQuestProgress, CURRENCY } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const {
    gambling: gamblingEmbed,
    statusLine,
    cooldownMessage,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "🎰", "⭐"]

function formatCoins(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("en-US")
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower.startsWith("!gamble")) {
        const amount = parseInt(message.content.split(" ")[1], 10)
        if (!amount || amount <= 0) {
            await sendSafe(message, invalidUsage("!gamble [amount]"))
            return true
        }
        const cd = checkCooldown(userId, "gamble", 20 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!gamble"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        const win = Math.random() < 0.5
        user.coins += win ? amount : -amount
        user.coins = Math.max(0, user.coins)
        if (win) user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "gamble")

        await sendEmbed(message, gamblingEmbed("Gamble result", win ? "You won the bet." : "You lost the bet.", {
            fields: [
                { name: "Bet", value: `${formatCoins(amount)} ${CURRENCY}`, inline: true },
                { name: "Result", value: win ? `+${formatCoins(amount)} coins` : `-${formatCoins(amount)} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ],
        }))
        return true
    }

    if (msgLower.startsWith("!coinflip")) {
        const parts = message.content.toLowerCase().split(" ")
        const amount = parseInt(parts[1], 10)
        const guess = parts[2]
        if (!amount || amount <= 0 || !["heads", "tails"].includes(guess)) {
            await sendSafe(message, invalidUsage("!coinflip [amount] [heads/tails]"))
            return true
        }
        const cd = checkCooldown(userId, "coinflip", 15 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!coinflip"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        const result = Math.random() < 0.5 ? "heads" : "tails"
        const won = result === guess
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        if (won) {
            const winnings = Math.floor(amount * 1.8)
            user.coins += winnings
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else {
            user.coins -= amount
            user.coins = Math.max(0, user.coins)
        }
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "gamble")

        await sendEmbed(message, gamblingEmbed("Coin flip", `The coin landed on **${result}**.`, {
            fields: [
                { name: "Your pick", value: guess, inline: true },
                { name: "Outcome", value: won ? "Win" : "Loss", inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ],
        }))
        return true
    }

    if (msgLower.startsWith("!slots")) {
        const amount = parseInt(message.content.split(" ")[1], 10)
        if (!amount || amount <= 0) {
            await sendSafe(message, invalidUsage("!slots [amount]"))
            return true
        }
        const cd = checkCooldown(userId, "slots", 20 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!slots"))
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        user.stats.slots = (user.stats.slots || 0) + 1
        const spin = [
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        ]

        let payout = 0
        let outcome = "No match"
        const jackpot = spin.every(symbol => symbol === "💎")
        const allSame = spin[0] === spin[1] && spin[1] === spin[2]
        const twoSame = spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]
        if (jackpot) {
            payout = amount * 10
            outcome = "Jackpot · 10× payout"
            user.stats.slotsJackpot = (user.stats.slotsJackpot || 0) + 1
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (allSame) {
            payout = amount * 5
            outcome = "Three of a kind · 5× payout"
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (twoSame) {
            payout = Math.floor(amount * 1.5)
            outcome = "Two of a kind · 1.5× payout"
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        }

        user.coins = Math.max(0, user.coins - amount + payout)
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "gamble")
        updateQuestProgress(userId, senderName, "slots")

        await sendEmbed(message, gamblingEmbed("Slots", spin.join("   "), {
            fields: [
                { name: "Outcome", value: outcome, inline: false },
                { name: "Bet", value: `${formatCoins(amount)} coins`, inline: true },
                { name: "Payout", value: `${formatCoins(payout)} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = { handle }
