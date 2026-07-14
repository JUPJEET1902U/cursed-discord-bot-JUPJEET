const { getUser, saveEconomy, updateQuestProgress, CURRENCY } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")

const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "🎰", "⭐"]

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower.startsWith("!gamble")) {
        const amount = parseInt(message.content.split(" ")[1])
        if (!amount || amount <= 0) { await message.channel.send("Usage: `!gamble [amount]` — e.g. `!gamble 100`"); return true }
        const cd = checkCooldown(userId, "gamble", 20 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before gambling again.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) { await message.channel.send(`💸 **${senderName}**, you only have **${user.coins} coins**. Can't gamble what you don't have!`); return true }
        if (amount < 1) { await message.channel.send("Minimum bet is 1 coin!"); return true }
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        const win = Math.random() < 0.5
        if (win) {
            user.coins += amount
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
            saveEconomy(data)
            updateQuestProgress(userId, senderName, "gamble")
            await message.channel.send(`🎲 **${senderName}** gambled **${amount} coins** and **WON** 🎉! Balance: **${user.coins} coins**. Don't get too cocky.`)
        } else {
            user.coins -= amount
            user.coins = Math.max(0, user.coins)
            saveEconomy(data)
            updateQuestProgress(userId, senderName, "gamble")
            await message.channel.send(`🎲 **${senderName}** gambled **${amount} coins** and **LOST** 💀. Balance: **${user.coins} coins**. Get absolutely rekt.`)
        }
        return true
    }

    if (msgLower.startsWith("!coinflip")) {
        const parts = message.content.toLowerCase().split(" ")
        const amount = parseInt(parts[1])
        const guess = parts[2]
        if (!amount || amount <= 0 || !["heads", "tails"].includes(guess)) {
            await message.channel.send("Usage: `!coinflip [amount] [heads/tails]` — e.g. `!coinflip 50 heads`")
            return true
        }
        const cd = checkCooldown(userId, "coinflip", 15 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before flipping again.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) { await message.channel.send(`💸 Not enough coins! You have **${user.coins}**.`); return true }
        const result = Math.random() < 0.5 ? "heads" : "tails"
        const coin = result === "heads" ? "🟡" : "⚪"
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        if (result === guess) {
            const winnings = Math.floor(amount * 1.8)
            user.coins += winnings
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
            saveEconomy(data)
            await message.channel.send(`${coin} It's **${result}**! **${senderName}** guessed right and won **${winnings} coins**! 🎉 Balance: **${user.coins}**`)
        } else {
            user.coins -= amount
            user.coins = Math.max(0, user.coins)
            saveEconomy(data)
            await message.channel.send(`${coin} It's **${result}**! **${senderName}** guessed ${guess} and LOST **${amount} coins** 💀. Balance: **${user.coins}**`)
        }
        updateQuestProgress(userId, senderName, "gamble")
        return true
    }

    if (msgLower.startsWith("!slots")) {
        const amount = parseInt(message.content.split(" ")[1])
        if (!amount || amount <= 0) { await message.channel.send("Usage: `!slots [amount]` — e.g. `!slots 50`"); return true }
        const cd = checkCooldown(userId, "slots", 20 * 1000)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before spinning again.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) { await message.channel.send(`💸 Not enough coins! You have **${user.coins}**.`); return true }
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        user.stats.slots = (user.stats.slots || 0) + 1
        const spin = [
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        ]
        let result = ""
        let payout = 0
        const jackpot = spin[0] === "💎" && spin[1] === "💎" && spin[2] === "💎"
        const allSame = spin[0] === spin[1] && spin[1] === spin[2]
        const twoSame = spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]
        if (jackpot) {
            payout = amount * 10
            result = `💥 **JACKPOT!!!** Triple 💎! You win **${payout} coins**!!!`
            user.stats.slotsJackpot = (user.stats.slotsJackpot || 0) + 1
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (allSame) {
            payout = amount * 5
            result = `🎉 **THREE OF A KIND!** You win **${payout} coins**!`
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (twoSame) {
            payout = Math.floor(amount * 1.5)
            result = `👌 **Two of a kind!** You win **${payout} coins**!`
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else {
            user.coins -= amount
            user.coins = Math.max(0, user.coins)
            result = `💀 No match. You lost **${amount} coins**. Try again, loser.`
        }
        if (payout > 0) {
            user.coins = user.coins - amount + payout
        }
        saveEconomy(data)
        updateQuestProgress(userId, senderName, "gamble")
        updateQuestProgress(userId, senderName, "slots")
        await message.channel.send(`🎰 **SLOTS** | ${spin.join(" | ")}\n\n${result}\n💰 Balance: **${user.coins} coins**`)
        return true
    }

    return false
}

module.exports = { handle }
