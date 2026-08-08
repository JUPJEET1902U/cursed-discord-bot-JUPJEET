const { getUser, saveEconomy, addXP, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeName, validateAmount } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const {
    games: gamesEmbed,
    statusLine,
    cooldownMessage,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const log = logger.child("Games")
const activeGuessGames = new Map()
const activeBlackjack = new Map()

const CARD_VALUES = { A: 11, K: 10, Q: 10, J: 10, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 }
const CARD_SUITS = ["♠", "♥", "♦", "♣"]
const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

function buildDeck() {
    const deck = []
    for (const suit of CARD_SUITS) {
        for (const rank of CARD_RANKS) deck.push({ rank, suit })
    }
    // Existing game uses pseudo-random shuffling; preserve behavior while making
    // the rest of the session lifecycle predictable.
    return deck.sort(() => Math.random() - 0.5)
}

function handValue(hand) {
    let total = hand.reduce((sum, card) => sum + CARD_VALUES[card.rank], 0)
    let aces = hand.filter(card => card.rank === "A").length
    while (total > 21 && aces > 0) {
        total -= 10
        aces--
    }
    return total
}

function formatHand(hand) {
    return hand.map(card => `${card.rank}${card.suit}`).join(" ")
}

function formatCoins(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("en-US")
}

function expireMapEntry(map, key, expectedValue, ms) {
    const timer = setTimeout(() => {
        if (map.get(key) === expectedValue) map.delete(key)
    }, ms)
    timer.unref?.()
}

function gameResult(title, description, fields = []) {
    return gamesEmbed(title, description, { fields })
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower === "!dailygame") {
        const cd = checkCooldown(userId, "dailygame", 24 * 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!dailygame"))
            return true
        }
        const games = ["!guess 50", "!rps rock", "!blackjack 30"]
        const suggestion = games[Math.floor(Math.random() * games.length)]
        const bonus = Math.floor(Math.random() * 50) + 25
        const { data, user } = getUser(userId, senderName)
        user.coins += bonus
        saveEconomy(data)
        await sendEmbed(message, gameResult("Daily game", "Daily participation reward claimed.", [
            { name: "Reward", value: `+${bonus} coins`, inline: true },
            { name: "Featured game", value: `\`${suggestion}\``, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!guess")) {
        const active = activeGuessGames.get(message.channel.id)
        if (active) {
            const guess = parseInt(msgLower.replace("!guess", "").trim(), 10)
            if (Number.isNaN(guess)) return false
            if (active.userId !== userId) {
                await sendSafe(message, statusLine("warning", "A number game is already active for another member in this channel."))
                return true
            }

            activeGuessGames.delete(message.channel.id)
            if (guess === active.answer) {
                const reward = active.bet * 2
                const { data, user } = getUser(userId, senderName)
                user.coins += reward
                saveEconomy(data)
                addXP(userId, senderName, 20)
                incrementStat(userId, senderName, "gamesWon")
                await sendEmbed(message, gameResult("Number guess", "Correct answer.", [
                    { name: "Number", value: String(active.answer), inline: true },
                    { name: "Reward", value: `+${formatCoins(reward)} coins`, inline: true },
                    { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
                ]))
            } else {
                await sendEmbed(message, gameResult("Number guess", "Incorrect answer.", [
                    { name: "Your guess", value: String(guess), inline: true },
                    { name: "Answer", value: String(active.answer), inline: true },
                    { name: "Bet lost", value: `${formatCoins(active.bet)} coins`, inline: true },
                ]))
            }
            return true
        }

        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 10000)
        if (!valid) {
            await sendSafe(message, invalidUsage("!guess [bet]"))
            return true
        }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        user.coins -= amount
        saveEconomy(data)
        const game = { answer: Math.floor(Math.random() * 100) + 1, userId, bet: amount }
        activeGuessGames.set(message.channel.id, game)
        expireMapEntry(activeGuessGames, message.channel.id, game, 30_000)
        await sendEmbed(message, gameResult("Number guess", "Guess a number from **1 to 100** within 30 seconds.", [
            { name: "Bet", value: `${formatCoins(amount)} coins`, inline: true },
            { name: "Winning payout", value: `${formatCoins(amount * 2)} coins`, inline: true },
            { name: "Reply", value: "`!guess [number]`", inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!rps")) {
        const choice = message.content.split(" ")[1]?.toLowerCase()
        const validChoices = ["rock", "paper", "scissors"]
        if (!validChoices.includes(choice)) {
            await sendSafe(message, invalidUsage("!rps [rock/paper/scissors]"))
            return true
        }
        const cd = checkCooldown(userId, "rps", 10 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!rps"))
            return true
        }

        const botChoice = validChoices[Math.floor(Math.random() * validChoices.length)]
        const wins = { rock: "scissors", paper: "rock", scissors: "paper" }
        const { data, user } = getUser(userId, senderName)
        let outcome = "Tie"
        let change = 0
        if (choice !== botChoice && wins[choice] === botChoice) {
            outcome = "Win"
            change = 30
            user.coins += change
            incrementStat(userId, senderName, "gamesWon")
        } else if (choice !== botChoice) {
            outcome = "Loss"
            change = -20
            user.coins = Math.max(0, user.coins + change)
        }
        saveEconomy(data)

        await sendEmbed(message, gameResult("Rock Paper Scissors", null, [
            { name: "You", value: choice, inline: true },
            { name: "CURSED", value: botChoice, inline: true },
            { name: "Outcome", value: outcome, inline: true },
            { name: "Coins", value: change === 0 ? "No change" : `${change > 0 ? "+" : ""}${change}`, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!blackjack")) {
        const active = activeBlackjack.get(userId)
        if (active) {
            const action = message.content.split(" ")[1]?.toLowerCase()
            if (action === "hit") {
                active.playerHand.push(active.deck.pop())
                const playerValue = handValue(active.playerHand)
                if (playerValue > 21) {
                    activeBlackjack.delete(userId)
                    const { data, user } = getUser(userId, senderName)
                    user.coins = Math.max(0, user.coins - active.bet)
                    saveEconomy(data)
                    await sendEmbed(message, gameResult("Blackjack", "Bust.", [
                        { name: "Hand", value: `${formatHand(active.playerHand)} · ${playerValue}`, inline: false },
                        { name: "Loss", value: `${formatCoins(active.bet)} coins`, inline: true },
                        { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
                    ]))
                } else {
                    await sendEmbed(message, gameResult("Blackjack", "Game in progress.", [
                        { name: "Hand", value: `${formatHand(active.playerHand)} · ${playerValue}`, inline: false },
                        { name: "Next action", value: "`!blackjack hit` or `!blackjack stand`", inline: false },
                    ]))
                }
                return true
            }

            if (action === "stand") {
                activeBlackjack.delete(userId)
                const playerValue = handValue(active.playerHand)
                while (handValue(active.dealerHand) < 17) active.dealerHand.push(active.deck.pop())
                const dealerValue = handValue(active.dealerHand)
                const { data, user } = getUser(userId, senderName)
                let outcome
                let coinText
                if (dealerValue > 21 || playerValue > dealerValue) {
                    const reward = active.bet * 2
                    user.coins += reward
                    incrementStat(userId, senderName, "gamesWon")
                    outcome = "Win"
                    coinText = `+${formatCoins(reward)} coins`
                } else if (playerValue === dealerValue) {
                    user.coins += active.bet
                    outcome = "Push"
                    coinText = `${formatCoins(active.bet)} coins returned`
                } else {
                    user.coins = Math.max(0, user.coins - active.bet)
                    outcome = "Loss"
                    coinText = `-${formatCoins(active.bet)} coins`
                }
                saveEconomy(data)
                await sendEmbed(message, gameResult("Blackjack", outcome, [
                    { name: "Your hand", value: `${formatHand(active.playerHand)} · ${playerValue}`, inline: false },
                    { name: "Dealer", value: `${formatHand(active.dealerHand)} · ${dealerValue}`, inline: false },
                    { name: "Coins", value: coinText, inline: true },
                    { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
                ]))
                return true
            }

            await sendSafe(message, statusLine("warning", "Blackjack is already active. Use `!blackjack hit` or `!blackjack stand`."))
            return true
        }

        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 5000)
        if (!valid) {
            await sendSafe(message, invalidUsage("!blackjack [bet]"))
            return true
        }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        const deck = buildDeck()
        const playerHand = [deck.pop(), deck.pop()]
        const dealerHand = [deck.pop(), deck.pop()]
        const playerValue = handValue(playerHand)
        const game = { playerHand, dealerHand, bet: amount, deck }
        activeBlackjack.set(userId, game)
        expireMapEntry(activeBlackjack, userId, game, 120_000)

        if (playerValue === 21) {
            activeBlackjack.delete(userId)
            const reward = Math.floor(amount * 2.5)
            user.coins += reward
            saveEconomy(data)
            incrementStat(userId, senderName, "gamesWon")
            await sendEmbed(message, gameResult("Blackjack", "Natural blackjack.", [
                { name: "Hand", value: `${formatHand(playerHand)} · 21`, inline: false },
                { name: "Reward", value: `+${formatCoins(reward)} coins`, inline: true },
                { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
            ]))
        } else {
            await sendEmbed(message, gameResult("Blackjack", "Game started.", [
                { name: "Bet", value: `${formatCoins(amount)} coins`, inline: true },
                { name: "Your hand", value: `${formatHand(playerHand)} · ${playerValue}`, inline: false },
                { name: "Dealer shows", value: `${dealerHand[0].rank}${dealerHand[0].suit} + hidden`, inline: false },
                { name: "Next action", value: "`!blackjack hit` or `!blackjack stand`", inline: false },
            ]))
        }
        return true
    }

    if (msgLower.startsWith("!mines")) {
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 2000)
        if (!valid) {
            await sendSafe(message, invalidUsage("!mines [bet]"))
            return true
        }
        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await sendSafe(message, statusLine("error", `Insufficient balance. You have **${formatCoins(user.coins)} coins**.`))
            return true
        }

        const grid = Array(9).fill("safe")
        const minePositions = new Set()
        while (minePositions.size < 3) minePositions.add(Math.floor(Math.random() * 9))
        for (const position of minePositions) grid[position] = "mine"
        const playerPick = Math.floor(Math.random() * 9)
        const hit = grid[playerPick] === "mine"
        const displayGrid = grid.map((cell, index) => {
            if (index === playerPick) return cell === "mine" ? "💥" : "✅"
            if (minePositions.has(index)) return "💣"
            return "⬜"
        })
        const board = [
            displayGrid.slice(0, 3).join(" "),
            displayGrid.slice(3, 6).join(" "),
            displayGrid.slice(6, 9).join(" "),
        ].join("\n")

        let outcome
        let coinText
        if (hit) {
            user.coins = Math.max(0, user.coins - amount)
            outcome = "Mine hit"
            coinText = `-${formatCoins(amount)} coins`
        } else {
            const reward = Math.floor(amount * 1.8)
            user.coins += reward
            incrementStat(userId, senderName, "gamesWon")
            outcome = "Safe tile"
            coinText = `+${formatCoins(reward)} coins`
        }
        saveEconomy(data)
        await sendEmbed(message, gameResult("Mines", board, [
            { name: "Outcome", value: outcome, inline: true },
            { name: "Result", value: coinText, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    if (msgLower.startsWith("!duel")) {
        const mentioned = message.mentions.users.first()
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[parts.length - 1], 10, 5000)
        if (!mentioned || !valid) {
            await sendSafe(message, invalidUsage("!duel @user [bet]"))
            return true
        }
        if (mentioned.id === userId) {
            await sendSafe(message, statusLine("warning", "You cannot duel yourself."))
            return true
        }
        if (mentioned.bot) {
            await sendSafe(message, statusLine("warning", "Bots cannot participate in coin duels."))
            return true
        }

        const { user: challenger } = getUser(userId, senderName)
        if (challenger.coins < amount) {
            await sendSafe(message, statusLine("error", `You need **${formatCoins(amount)} coins** to duel.`))
            return true
        }
        const targetName = sanitizeName(message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
        const { user: challenged } = getUser(mentioned.id, targetName)
        if (challenged.coins < amount) {
            await sendSafe(message, statusLine("error", `**${targetName}** does not have enough coins for this duel.`))
            return true
        }

        const p1Score = Math.random() * 100 + (challenger.level || 0) * 2
        const p2Score = Math.random() * 100 + (challenged.level || 0) * 2
        const p1Wins = p1Score > p2Score
        const winnerId = p1Wins ? userId : mentioned.id
        const winnerName = p1Wins ? senderName : targetName
        const loserId = p1Wins ? mentioned.id : userId
        const loserName = p1Wins ? targetName : senderName
        const { data: winnerData, user: winner } = getUser(winnerId, winnerName)
        const { data: loserData, user: loser } = getUser(loserId, loserName)
        winner.coins += amount
        loser.coins = Math.max(0, loser.coins - amount)
        winner.stats = winner.stats || {}
        winner.stats.duelsWon = (winner.stats.duelsWon || 0) + 1
        saveEconomy(winnerData)
        saveEconomy(loserData)

        await sendEmbed(message, gameResult("Duel", `${winnerName} won the duel.`, [
            { name: senderName, value: `${Math.floor(p1Score)} points`, inline: true },
            { name: targetName, value: `${Math.floor(p2Score)} points`, inline: true },
            { name: "Transfer", value: `${formatCoins(amount)} coins from ${loserName} to ${winnerName}`, inline: false },
        ]))
        return true
    }

    if (msgLower === "!treasure") {
        const cd = checkCooldown(userId, "treasure", 4 * 60 * 60 * 1000)
        if (!cd.ok) {
            await sendSafe(message, cooldownMessage(senderName, cd.remaining, "!treasure"))
            return true
        }

        const outcomes = [
            { name: "Diamond Cache", coins: 500, xp: 100, chance: 0.05 },
            { name: "Gold Chest", coins: 200, xp: 60, chance: 0.15 },
            { name: "Silver Pouch", coins: 100, xp: 30, chance: 0.30 },
            { name: "Empty Cave", coins: 10, xp: 5, chance: 0.50 },
        ]
        const roll = Math.random()
        let cumulative = 0
        let found = outcomes[outcomes.length - 1]
        for (const outcome of outcomes) {
            cumulative += outcome.chance
            if (roll < cumulative) {
                found = outcome
                break
            }
        }

        const { data, user } = getUser(userId, senderName)
        user.coins += found.coins
        saveEconomy(data)
        addXP(userId, senderName, found.xp)
        await sendEmbed(message, gameResult("Treasure hunt", found.name, [
            { name: "Coins", value: `+${formatCoins(found.coins)}`, inline: true },
            { name: "XP", value: `+${found.xp}`, inline: true },
            { name: "Balance", value: `${formatCoins(user.coins)} coins`, inline: true },
        ]))
        return true
    }

    return false
}

module.exports = {
    handle,
    __testing: process.env.NODE_ENV === "test" ? { activeGuessGames, activeBlackjack, handValue, buildDeck } : undefined,
}
