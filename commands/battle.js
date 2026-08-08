const { getUser, saveEconomy, addXP } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeName } = require("../utils/sanitizer")
const {
    games: gamesEmbed,
    statusLine,
    cooldownMessage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

const BOSSES = [
    { name: "The Void Titan", hp: 500, emoji: "🌑", reward: { coins: 500, xp: 200 } },
    { name: "Chaos Dragon", hp: 400, emoji: "🐉", reward: { coins: 400, xp: 150 } },
    { name: "Shadow Demon", hp: 350, emoji: "👿", reward: { coins: 350, xp: 120 } },
    { name: "Cursed Golem", hp: 300, emoji: "🗿", reward: { coins: 300, xp: 100 } },
    { name: "Plague Witch", hp: 280, emoji: "🧙", reward: { coins: 280, xp: 90 } },
]

const ABILITIES = [
    { name: "Power Strike", damage: [30, 60] },
    { name: "Magic Blast", damage: [25, 55] },
    { name: "Cursed Slash", damage: [35, 65] },
    { name: "Thunder Smash", damage: [20, 70] },
    { name: "Shadow Claw", damage: [28, 52] },
    { name: "Fire Breath", damage: [40, 80] },
]

function randomAbility() {
    return ABILITIES[Math.floor(Math.random() * ABILITIES.length)]
}

function rollDamage(ability) {
    const [min, max] = ability.damage
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function calcPlayerHP(user) {
    return 100 + (user.level || 0) * 5
}

function attackLine(round, attacker, defender, ability, damage, defenderHP) {
    return `**R${round}** · ${attacker} used **${ability.name}** → ${damage} damage · ${defender} ${defenderHP} HP`
}

function battleEmbed(title, summary, rounds, fields = []) {
    const roundText = rounds.slice(-10).join("\n")
    const description = [summary, roundText ? `\n${roundText}` : null].filter(Boolean).join("\n")
    return gamesEmbed(title, description, { fields })
}

function recordBattle(user, won = false) {
    user.stats = user.stats || {}
    user.stats.battles = (user.stats.battles || 0) + 1
    if (won) user.stats.battlesWon = (user.stats.battlesWon || 0) + 1
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower.startsWith("!battle") && !msgLower.startsWith("!battleai") && !msgLower.startsWith("!battlestats")) {
        const mentioned = message.mentions.users.first()
        if (!mentioned) {
            await sendEmbed(message, gamesEmbed("Battle Arena", "Choose a battle mode.", {
                fields: [
                    { name: "PvP", value: "`!battle @user`", inline: true },
                    { name: "AI opponent", value: "`!battleai`", inline: true },
                    { name: "Boss", value: "`!bossfight`", inline: true },
                    { name: "Stats", value: "`!battlestats`", inline: true },
                ],
            }))
            return true
        }
        if (mentioned.id === userId) {
            await sendSafe(message, statusLine("warning", "You cannot battle yourself."))
            return true
        }
        if (mentioned.bot) {
            await sendSafe(message, statusLine("warning", "Bots cannot join PvP battles. Use `!battleai` instead."))
            return true
        }

        const cooldown = checkCooldown(userId, "battle", 60 * 1000)
        if (!cooldown.ok) {
            await sendSafe(message, cooldownMessage(senderName, cooldown.remaining, "!battle"))
            return true
        }

        const targetName = sanitizeName(message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
        const { user: playerOne } = getUser(userId, senderName)
        const { user: playerTwo } = getUser(mentioned.id, targetName)
        let p1HP = calcPlayerHP(playerOne)
        let p2HP = calcPlayerHP(playerTwo)
        const rounds = []
        let round = 1
        let playerOneTurn = true

        while (p1HP > 0 && p2HP > 0 && round <= 10) {
            const ability = randomAbility()
            const damage = rollDamage(ability)
            if (playerOneTurn) {
                p2HP = Math.max(0, p2HP - damage)
                rounds.push(attackLine(round, senderName, targetName, ability, damage, p2HP))
            } else {
                p1HP = Math.max(0, p1HP - damage)
                rounds.push(attackLine(round, targetName, senderName, ability, damage, p1HP))
            }
            if (p1HP <= 0 || p2HP <= 0) break
            playerOneTurn = !playerOneTurn
            round += 1
        }

        const playerOneWins = p2HP <= 0 || (p1HP > 0 && p1HP >= p2HP)
        const winnerId = playerOneWins ? userId : mentioned.id
        const winnerName = playerOneWins ? senderName : targetName
        const loserId = playerOneWins ? mentioned.id : userId
        const loserName = playerOneWins ? targetName : senderName
        const coinsReward = Math.floor(Math.random() * 100) + 50
        const xpReward = Math.floor(Math.random() * 50) + 25

        const { data: winnerData, user: winner } = getUser(winnerId, winnerName)
        winner.coins += coinsReward
        recordBattle(winner, true)
        saveEconomy(winnerData)
        addXP(winnerId, winnerName, xpReward)

        const { data: loserData, user: loser } = getUser(loserId, loserName)
        recordBattle(loser, false)
        saveEconomy(loserData)

        await sendEmbed(message, battleEmbed(
            `Battle • ${senderName} vs ${targetName}`,
            `**${winnerName}** won.`,
            rounds,
            [
                { name: senderName, value: `${p1HP} HP`, inline: true },
                { name: targetName, value: `${p2HP} HP`, inline: true },
                { name: "Reward", value: `${coinsReward} coins · ${xpReward} XP`, inline: true },
            ]
        ))
        return true
    }

    if (msgLower === "!battleai") {
        const cooldown = checkCooldown(userId, "battleai", 45 * 1000)
        if (!cooldown.ok) {
            await sendSafe(message, cooldownMessage(senderName, cooldown.remaining, "!battleai"))
            return true
        }

        const { user } = getUser(userId, senderName)
        const aiNames = ["Shadow Bot", "Chaos Engine", "Void Walker", "Cursed AI", "Glitch Demon"]
        const aiName = aiNames[Math.floor(Math.random() * aiNames.length)]
        const aiLevel = Math.max(1, (user.level || 1) + Math.floor(Math.random() * 5) - 2)
        let playerHP = calcPlayerHP(user)
        let aiHP = 100 + aiLevel * 5
        const rounds = []
        let round = 1
        let playerTurn = true

        while (playerHP > 0 && aiHP > 0 && round <= 8) {
            const ability = randomAbility()
            const damage = rollDamage(ability)
            if (playerTurn) {
                aiHP = Math.max(0, aiHP - damage)
                rounds.push(attackLine(round, senderName, aiName, ability, damage, aiHP))
            } else {
                playerHP = Math.max(0, playerHP - damage)
                rounds.push(attackLine(round, aiName, senderName, ability, damage, playerHP))
            }
            if (aiHP <= 0 || playerHP <= 0) break
            playerTurn = !playerTurn
            round += 1
        }

        const playerWon = playerHP > 0 && (aiHP <= 0 || playerHP >= aiHP)
        const coinsReward = playerWon ? Math.floor(Math.random() * 80) + 30 : 10
        const xpReward = playerWon ? Math.floor(Math.random() * 40) + 20 : 5
        const { data, user: freshUser } = getUser(userId, senderName)
        freshUser.coins += coinsReward
        recordBattle(freshUser, playerWon)
        saveEconomy(data)
        addXP(userId, senderName, xpReward)

        await sendEmbed(message, battleEmbed(
            `Battle • ${senderName} vs ${aiName}`,
            playerWon ? `**${senderName}** won.` : `**${aiName}** won.`,
            rounds,
            [
                { name: senderName, value: `${playerHP} HP`, inline: true },
                { name: `${aiName} · Lv.${aiLevel}`, value: `${aiHP} HP`, inline: true },
                { name: "Reward", value: `${coinsReward} coins · ${xpReward} XP`, inline: true },
            ]
        ))
        return true
    }

    if (msgLower === "!bossfight") {
        const cooldown = checkCooldown(userId, "bossfight", 5 * 60 * 1000)
        if (!cooldown.ok) {
            await sendSafe(message, cooldownMessage(senderName, cooldown.remaining, "!bossfight"))
            return true
        }

        const boss = BOSSES[Math.floor(Math.random() * BOSSES.length)]
        const { user } = getUser(userId, senderName)
        let playerHP = calcPlayerHP(user)
        let bossHP = boss.hp
        const rounds = []
        let round = 1
        let playerTurn = true

        while (playerHP > 0 && bossHP > 0 && round <= 12) {
            if (playerTurn) {
                const ability = randomAbility()
                const damage = rollDamage(ability)
                bossHP = Math.max(0, bossHP - damage)
                rounds.push(attackLine(round, senderName, boss.name, ability, damage, bossHP))
            } else {
                const damage = Math.floor(Math.random() * 60) + 20
                playerHP = Math.max(0, playerHP - damage)
                rounds.push(attackLine(round, boss.name, senderName, { name: "Rage Strike" }, damage, playerHP))
            }
            if (bossHP <= 0 || playerHP <= 0) break
            playerTurn = !playerTurn
            round += 1
        }

        const playerWon = bossHP <= 0 || (playerHP > 0 && playerHP > bossHP / 2)
        const reward = playerWon ? boss.reward : { coins: 20, xp: 10 }
        const { data, user: freshUser } = getUser(userId, senderName)
        freshUser.coins += reward.coins
        recordBattle(freshUser, playerWon)
        freshUser.stats.bossKills = (freshUser.stats.bossKills || 0) + (playerWon ? 1 : 0)
        saveEconomy(data)
        addXP(userId, senderName, reward.xp)

        await sendEmbed(message, battleEmbed(
            `Boss fight • ${boss.emoji} ${boss.name}`,
            playerWon ? `**${senderName}** defeated the boss.` : `**${boss.name}** won.`,
            rounds,
            [
                { name: senderName, value: `${playerHP} HP`, inline: true },
                { name: boss.name, value: `${bossHP} HP`, inline: true },
                { name: "Reward", value: `${reward.coins} coins · ${reward.xp} XP`, inline: true },
            ]
        ))
        return true
    }

    if (msgLower === "!battlestats") {
        const { user } = getUser(userId, senderName)
        const stats = user.stats || {}
        const battles = stats.battles || 0
        const wins = stats.battlesWon || 0
        const losses = Math.max(0, battles - wins)
        const winRate = battles > 0 ? Math.floor((wins / battles) * 100) : 0
        await sendEmbed(message, gamesEmbed(`${senderName}'s battle stats`, null, {
            fields: [
                { name: "Wins", value: String(wins), inline: true },
                { name: "Losses", value: String(losses), inline: true },
                { name: "Win rate", value: `${winRate}%`, inline: true },
                { name: "Battles", value: String(battles), inline: true },
                { name: "Boss kills", value: String(stats.bossKills || 0), inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = {
    handle,
    __testing: process.env.NODE_ENV === "test" ? { randomAbility, rollDamage, calcPlayerHP, attackLine } : undefined,
}
