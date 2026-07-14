/**
 * commands/games.js
 * Mini-games: guess, mines, blackjack, rps, duel, treasure, dailygame (Phase 7)
 */

const { getUser, saveEconomy, addXP, incrementStat, updateQuestProgress } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeName, validateAmount } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const log = logger.child("Games")

// Active game sessions
const activeGuessGames = new Map()   // channelId → { answer, userId, bet }
const activeBlackjack  = new Map()   // userId → { playerHand, dealerHand, bet, deck }
const activeDuels      = new Map()   // channelId → { challenger, challenged, bet }

const CARD_VALUES = { A: 11, K: 10, Q: 10, J: 10, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 }
const CARD_SUITS  = ["♠", "♥", "♦", "♣"]
const CARD_RANKS  = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

function buildDeck() {
    const deck = []
    for (const suit of CARD_SUITS) for (const rank of CARD_RANKS) deck.push({ rank, suit })
    return deck.sort(() => Math.random() - 0.5)
}

function handValue(hand) {
    let total = hand.reduce((s, c) => s + CARD_VALUES[c.rank], 0)
    let aces = hand.filter(c => c.rank === "A").length
    while (total > 21 && aces > 0) { total -= 10; aces-- }
    return total
}

function formatHand(hand) {
    return hand.map(c => `${c.rank}${c.suit}`).join(" ")
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── !dailygame ─────────────────────────────────────────────────────────────
    if (msgLower === "!dailygame") {
        const cd = checkCooldown(userId, "dailygame", 24 * 60 * 60 * 1000)
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ You already played your daily game! Come back in **${Math.floor(cd.remaining / 3600)}h**.`)
            return true
        }
        const games = ["!guess 50", "!rps rock", "!blackjack 30"]
        const suggestion = games[Math.floor(Math.random() * games.length)]
        const bonus = Math.floor(Math.random() * 50) + 25
        const { data, user } = getUser(userId, senderName)
        user.coins += bonus
        saveEconomy(data)
        await createSafeMessage(message.channel,
            `🎮 **Daily Game Bonus!** **${senderName}** received **${bonus} coins** for showing up!\n` +
            `Try today's featured game: \`${suggestion}\`\n` +
            `Balance: **${user.coins} coins**`)
        return true
    }

    // ── !guess ─────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!guess")) {
        // Check if answering an active game
        if (activeGuessGames.has(message.channel.id)) {
            const game = activeGuessGames.get(message.channel.id)
            const guess = parseInt(msgLower.replace("!guess", "").trim())
            if (isNaN(guess)) return false // not a guess attempt

            if (game.userId !== userId) {
                await createSafeMessage(message.channel, `❌ This isn't your game, **${senderName}**! Wait for your turn.`)
                return true
            }

            activeGuessGames.delete(message.channel.id)

            if (guess === game.answer) {
                const reward = game.bet * 2
                const { data, user } = getUser(userId, senderName)
                user.coins += reward
                saveEconomy(data)
                addXP(userId, senderName, 20)
                incrementStat(userId, senderName, "gamesWon")
                await createSafeMessage(message.channel, `✅ **CORRECT!** The number was **${game.answer}**! **${senderName}** wins **${reward} coins**! 🎉`)
            } else {
                const hint = guess < game.answer ? "📈 Too low!" : "📉 Too high!"
                await createSafeMessage(message.channel, `❌ Wrong! ${hint} The answer was **${game.answer}**. **${senderName}** lost **${game.bet} coins**.`)
            }
            return true
        }

        // Start a new guess game
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 10000)
        if (!valid) {
            await createSafeMessage(message.channel, `🔢 Usage: \`!guess [bet]\` (min 10 coins)\nGuess a number between 1-100 to double your bet!`)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await createSafeMessage(message.channel, `💸 You only have **${user.coins} coins**!`)
            return true
        }

        user.coins -= amount
        saveEconomy(data)

        const answer = Math.floor(Math.random() * 100) + 1
        activeGuessGames.set(message.channel.id, { answer, userId, bet: amount })

        // Auto-expire after 30 seconds
        setTimeout(() => {
            if (activeGuessGames.has(message.channel.id)) {
                activeGuessGames.delete(message.channel.id)
            }
        }, 30000)

        await createSafeMessage(message.channel,
            `🔢 **Number Guessing Game!** **${senderName}** bet **${amount} coins**!\n` +
            `Guess a number between **1-100**! Type \`!guess [number]\` within 30 seconds.\n` +
            `Correct answer = **${amount * 2} coins**!`)
        return true
    }

    // ── !rps ───────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!rps")) {
        const choice = message.content.split(" ")[1]?.toLowerCase()
        const valid = ["rock", "paper", "scissors"]
        if (!valid.includes(choice)) {
            await createSafeMessage(message.channel, `✊ Usage: \`!rps [rock/paper/scissors]\``)
            return true
        }

        const cd = checkCooldown(userId, "rps", 10 * 1000)
        if (!cd.ok) { await createSafeMessage(message.channel, `⏳ Wait **${cd.remaining}s** before playing again.`); return true }

        const botChoice = valid[Math.floor(Math.random() * 3)]
        const emojis = { rock: "✊", paper: "📄", scissors: "✂️" }
        const wins = { rock: "scissors", paper: "rock", scissors: "paper" }

        const { data, user } = getUser(userId, senderName)
        let result, coinsChange = 0

        if (choice === botChoice) {
            result = `🤝 **TIE!** We both chose ${emojis[choice]} ${choice}!`
        } else if (wins[choice] === botChoice) {
            coinsChange = 30
            user.coins += coinsChange
            incrementStat(userId, senderName, "gamesWon")
            result = `🏆 **${senderName} WINS!** ${emojis[choice]} beats ${emojis[botChoice]}! +${coinsChange} coins!`
        } else {
            coinsChange = -20
            user.coins = Math.max(0, user.coins + coinsChange)
            result = `💀 **CURSED WINS!** ${emojis[botChoice]} beats ${emojis[choice]}! -20 coins.`
        }

        saveEconomy(data)
        await createSafeMessage(message.channel, `✊ **Rock Paper Scissors!**\n${senderName}: ${emojis[choice]} | CURSED: ${emojis[botChoice]}\n\n${result}\n💰 Balance: **${user.coins} coins**`)
        return true
    }

    // ── !blackjack ─────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!blackjack")) {
        // Handle hit/stand for active game
        if (activeBlackjack.has(userId)) {
            const game = activeBlackjack.get(userId)
            const action = message.content.split(" ")[1]?.toLowerCase()

            if (action === "hit") {
                game.playerHand.push(game.deck.pop())
                const pv = handValue(game.playerHand)

                if (pv > 21) {
                    activeBlackjack.delete(userId)
                    const { data, user } = getUser(userId, senderName)
                    user.coins = Math.max(0, user.coins - game.bet)
                    saveEconomy(data)
                    await createSafeMessage(message.channel,
                        `🃏 **BUST!** Your hand: ${formatHand(game.playerHand)} = **${pv}**\n` +
                        `💸 Lost **${game.bet} coins**. Balance: **${user.coins}**`)
                } else {
                    await createSafeMessage(message.channel,
                        `🃏 Your hand: ${formatHand(game.playerHand)} = **${pv}**\n` +
                        `Type \`!blackjack hit\` or \`!blackjack stand\``)
                }
                return true
            }

            if (action === "stand") {
                activeBlackjack.delete(userId)
                const pv = handValue(game.playerHand)

                // Dealer draws to 17
                while (handValue(game.dealerHand) < 17) game.dealerHand.push(game.deck.pop())
                const dv = handValue(game.dealerHand)

                const { data, user } = getUser(userId, senderName)
                let resultMsg

                if (dv > 21 || pv > dv) {
                    const reward = game.bet * 2
                    user.coins += reward
                    incrementStat(userId, senderName, "gamesWon")
                    resultMsg = `🏆 **${senderName} WINS!** Your ${pv} beats dealer's ${dv}! +${reward} coins!`
                } else if (pv === dv) {
                    user.coins += game.bet // push — return bet
                    resultMsg = `🤝 **PUSH!** Both ${pv}. Bet returned.`
                } else {
                    user.coins = Math.max(0, user.coins - game.bet)
                    resultMsg = `💀 **Dealer wins!** ${dv} beats your ${pv}. Lost **${game.bet} coins**.`
                }

                saveEconomy(data)
                await createSafeMessage(message.channel,
                    `🃏 **Blackjack Result**\nYour hand: ${formatHand(game.playerHand)} = **${pv}**\n` +
                    `Dealer: ${formatHand(game.dealerHand)} = **${dv}**\n\n${resultMsg}\n💰 Balance: **${user.coins}**`)
                return true
            }

            await createSafeMessage(message.channel, `🃏 You have an active game! Type \`!blackjack hit\` or \`!blackjack stand\``)
            return true
        }

        // Start new blackjack game
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 5000)
        if (!valid) {
            await createSafeMessage(message.channel, `🃏 Usage: \`!blackjack [bet]\` (min 10 coins)\nThen use \`!blackjack hit\` or \`!blackjack stand\``)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await createSafeMessage(message.channel, `💸 You only have **${user.coins} coins**!`)
            return true
        }

        const deck = buildDeck()
        const playerHand = [deck.pop(), deck.pop()]
        const dealerHand = [deck.pop(), deck.pop()]
        const pv = handValue(playerHand)

        activeBlackjack.set(userId, { playerHand, dealerHand, bet: amount, deck })

        // Auto-expire after 2 minutes
        setTimeout(() => activeBlackjack.delete(userId), 120000)

        if (pv === 21) {
            activeBlackjack.delete(userId)
            const reward = Math.floor(amount * 2.5)
            user.coins += reward
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `🃏 **BLACKJACK!** ${formatHand(playerHand)} = **21**!\n` +
                `🏆 **${senderName}** wins **${reward} coins**! 🎉`)
        } else {
            await createSafeMessage(message.channel,
                `🃏 **Blackjack!** Bet: **${amount} coins**\n\n` +
                `Your hand: ${formatHand(playerHand)} = **${pv}**\n` +
                `Dealer shows: ${dealerHand[0].rank}${dealerHand[0].suit} + 🂠\n\n` +
                `Type \`!blackjack hit\` or \`!blackjack stand\``)
        }
        return true
    }

    // ── !mines ─────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!mines")) {
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[1], 10, 2000)
        if (!valid) {
            await createSafeMessage(message.channel, `💣 Usage: \`!mines [bet]\` — Pick a safe tile from a 3x3 grid (3 mines hidden)!`)
            return true
        }

        const { data, user } = getUser(userId, senderName)
        if (user.coins < amount) {
            await createSafeMessage(message.channel, `💸 You only have **${user.coins} coins**!`)
            return true
        }

        // 3x3 grid, 3 mines
        const grid = Array(9).fill("safe")
        const minePositions = new Set()
        while (minePositions.size < 3) minePositions.add(Math.floor(Math.random() * 9))
        for (const pos of minePositions) grid[pos] = "mine"

        const playerPick = Math.floor(Math.random() * 9) // simulate random pick
        const hit = grid[playerPick] === "mine"

        const displayGrid = grid.map((cell, i) => {
            if (i === playerPick) return cell === "mine" ? "💥" : "✅"
            if (minePositions.has(i)) return "💣"
            return "⬜"
        })

        const rows = [
            displayGrid.slice(0, 3).join(" "),
            displayGrid.slice(3, 6).join(" "),
            displayGrid.slice(6, 9).join(" "),
        ]

        if (hit) {
            user.coins = Math.max(0, user.coins - amount)
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `💣 **MINES** — **${senderName}** bet **${amount} coins**\n\n${rows.join("\n")}\n\n💥 **BOOM!** You hit a mine! Lost **${amount} coins**.\nBalance: **${user.coins}**`)
        } else {
            const reward = Math.floor(amount * 1.8)
            user.coins += reward
            incrementStat(userId, senderName, "gamesWon")
            saveEconomy(data)
            await createSafeMessage(message.channel,
                `💣 **MINES** — **${senderName}** bet **${amount} coins**\n\n${rows.join("\n")}\n\n✅ **SAFE!** Won **${reward} coins**!\nBalance: **${user.coins}**`)
        }
        return true
    }

    // ── !duel ──────────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!duel")) {
        const mentioned = message.mentions.users.first()
        const parts = message.content.split(" ")
        const { valid, amount } = validateAmount(parts[parts.length - 1], 10, 5000)

        if (!mentioned || !valid) {
            await createSafeMessage(message.channel, `⚔️ Usage: \`!duel @user [bet]\` — Challenge someone to a coin duel!`)
            return true
        }
        if (mentioned.id === userId) { await createSafeMessage(message.channel, `😂 You can't duel yourself!`); return true }
        if (mentioned.bot) { await createSafeMessage(message.channel, `🤖 Can't duel a bot!`); return true }

        const { user: challenger } = getUser(userId, senderName)
        if (challenger.coins < amount) {
            await createSafeMessage(message.channel, `💸 You need **${amount} coins** to duel but only have **${challenger.coins}**!`)
            return true
        }

        const targetName = sanitizeName(message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
        const { user: challenged } = getUser(mentioned.id, targetName)
        if (challenged.coins < amount) {
            await createSafeMessage(message.channel, `💸 **${targetName}** doesn't have enough coins for this duel!`)
            return true
        }

        // Simple duel — random winner with slight skill factor (level)
        const p1Score = Math.random() * 100 + (challenger.level || 0) * 2
        const p2Score = Math.random() * 100 + (challenged.level || 0) * 2
        const p1Wins = p1Score > p2Score

        const winnerId = p1Wins ? userId : mentioned.id
        const winnerName = p1Wins ? senderName : targetName
        const loserId = p1Wins ? mentioned.id : userId
        const loserName = p1Wins ? targetName : senderName

        const { data: wData, user: wUser } = getUser(winnerId, winnerName)
        const { data: lData, user: lUser } = getUser(loserId, loserName)

        wUser.coins += amount
        lUser.coins = Math.max(0, lUser.coins - amount)
        wUser.stats = wUser.stats || {}
        wUser.stats.duelsWon = (wUser.stats.duelsWon || 0) + 1
        saveEconomy(wData)
        saveEconomy(lData)

        await createSafeMessage(message.channel,
            `⚔️ **DUEL: ${senderName} vs ${targetName}** (${amount} coins)\n\n` +
            `🎲 ${senderName}: ${Math.floor(p1Score)} pts | ${targetName}: ${Math.floor(p2Score)} pts\n\n` +
            `🏆 **${winnerName}** wins **${amount} coins** from **${loserName}**!`)
        return true
    }

    // ── !treasure ──────────────────────────────────────────────────────────────
    if (msgLower === "!treasure") {
        const cd = checkCooldown(userId, "treasure", 4 * 60 * 60 * 1000) // 4 hours
        if (!cd.ok) {
            await createSafeMessage(message.channel, `🗺️ The treasure respawns in **${Math.floor(cd.remaining / 60)}m**. Come back later!`)
            return true
        }

        const outcomes = [
            { emoji: "💎", name: "Diamond Cache",  coins: 500, xp: 100, chance: 0.05 },
            { emoji: "🥇", name: "Gold Chest",     coins: 200, xp: 60,  chance: 0.15 },
            { emoji: "🪙", name: "Silver Pouch",   coins: 100, xp: 30,  chance: 0.30 },
            { emoji: "🪨", name: "Empty Cave",     coins: 10,  xp: 5,   chance: 0.50 },
        ]

        const roll = Math.random()
        let cumulative = 0
        let found = outcomes[outcomes.length - 1]
        for (const o of outcomes) {
            cumulative += o.chance
            if (roll < cumulative) { found = o; break }
        }

        const { data, user } = getUser(userId, senderName)
        user.coins += found.coins
        saveEconomy(data)
        addXP(userId, senderName, found.xp)

        await createSafeMessage(message.channel,
            `🗺️ **${senderName}** went treasure hunting and found...\n\n` +
            `${found.emoji} **${found.name}!** +${found.coins} coins | +${found.xp} XP\n` +
            `💰 Balance: **${user.coins} coins**`)
        return true
    }

    return false
}

module.exports = { handle }
