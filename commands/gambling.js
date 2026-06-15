const { getUser, saveEconomy, checkAndGrantAchievements, updateQuestProgress, CURRENCY } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { validateAmount } = require("../utils/inputValidator")
const { COOLDOWNS, SLOTS, GAMBLING } = require("../config/constants")

const SLOT_SYMBOLS = SLOTS.SYMBOLS

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

    if (msgLower.startsWith("!gamble")) {
        const amountValidation = validateAmount(message.content.split(" ")[1])
        if (!amountValidation.ok) { await message.channel.send(`❌ ${amountValidation.error} Usage: \`!gamble [amount]\``); return true }
        const amount = amountValidation.value
        const cd = checkCooldown(userId, "gamble", COOLDOWNS.GAMBLE)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before gambling again.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) { await message.channel.send(`💸 **${senderName}**, you only have **${user.coins} coins**. Can't gamble what you don't have!`); return true }
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        const win = Math.random() < GAMBLING.WIN_CHANCE
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
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower.startsWith("!coinflip")) {
        const parts = message.content.toLowerCase().split(" ")
        const amountValidation = validateAmount(parts[1])
        const guess = parts[2]
        if (!amountValidation.ok || !["heads", "tails"].includes(guess)) {
            await message.channel.send("Usage: `!coinflip [amount] [heads/tails]` — e.g. `!coinflip 50 heads`")
            return true
        }
        const amount = amountValidation.value
        const cd = checkCooldown(userId, "coinflip", COOLDOWNS.COINFLIP)
        if (!cd.ok) { await message.channel.send(`⏳ Wait **${cd.remaining}s** before flipping again.`); return true }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) { await message.channel.send(`💸 Not enough coins! You have **${user.coins}**.`); return true }
        const result = Math.random() < 0.5 ? "heads" : "tails"
        const coin = result === "heads" ? "🟡" : "⚪"
        user.stats = user.stats || {}
        user.stats.gamble = (user.stats.gamble || 0) + 1
        if (result === guess) {
            const winnings = Math.floor(amount * GAMBLING.COINFLIP_MULT)
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
        await announce(message, userId, senderName)
        return true
    }

    if (msgLower.startsWith("!slots")) {
        const amountValidation = validateAmount(message.content.split(" ")[1])
        if (!amountValidation.ok) { await message.channel.send(`❌ ${amountValidation.error} Usage: \`!slots [amount]\``); return true }
        const amount = amountValidation.value
        const cd = checkCooldown(userId, "slots", COOLDOWNS.SLOTS)
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
        const jackpot = spin[0] === SLOTS.JACKPOT_SYMBOL && spin[1] === SLOTS.JACKPOT_SYMBOL && spin[2] === SLOTS.JACKPOT_SYMBOL
        const allSame = spin[0] === spin[1] && spin[1] === spin[2]
        const twoSame = spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]
        if (jackpot) {
            payout = amount * SLOTS.JACKPOT_MULT
            result = `💥 **JACKPOT!!!** Triple 💎! You win **${payout} coins**!!!`
            user.stats.slotsJackpot = (user.stats.slotsJackpot || 0) + 1
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (allSame) {
            payout = amount * SLOTS.THREE_MULT
            result = `🎉 **THREE OF A KIND!** You win **${payout} coins**!`
            user.stats.gambleWin = (user.stats.gambleWin || 0) + 1
        } else if (twoSame) {
            payout = Math.floor(amount * SLOTS.TWO_MULT)
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
        await announce(message, userId, senderName)
        return true
    }

    return false
}

module.exports = { handle }
