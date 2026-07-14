/**
 * commands/battle.js
 * AI Battle Arena — PvP, vs AI, and boss fights (Phase 5)
 */

const { callAI } = require("../utils/ai")
const { getUser, saveEconomy, addXP, incrementStat } = require("../utils/economy")
const { checkCooldown } = require("../utils/cooldowns")
const { sanitizeAIOutput, sanitizeName } = require("../utils/sanitizer")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const logger = require("../utils/logger")
const log = logger.child("Battle")

const BOSSES = [
    { name: "The Void Titan", hp: 500, emoji: "🌑", reward: { coins: 500, xp: 200 } },
    { name: "Chaos Dragon",   hp: 400, emoji: "🐉", reward: { coins: 400, xp: 150 } },
    { name: "Shadow Demon",   hp: 350, emoji: "👿", reward: { coins: 350, xp: 120 } },
    { name: "Cursed Golem",   hp: 300, emoji: "🗿", reward: { coins: 300, xp: 100 } },
    { name: "Plague Witch",   hp: 280, emoji: "🧙", reward: { coins: 280, xp: 90  } },
]

const ABILITIES = [
    { name: "Power Strike",   damage: [30, 60],  emoji: "⚔️"  },
    { name: "Magic Blast",    damage: [25, 55],  emoji: "✨"  },
    { name: "Cursed Slash",   damage: [35, 65],  emoji: "💀"  },
    { name: "Thunder Smash",  damage: [20, 70],  emoji: "⚡"  },
    { name: "Shadow Claw",    damage: [28, 52],  emoji: "🌑"  },
    { name: "Fire Breath",    damage: [40, 80],  emoji: "🔥"  },
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

async function generateBattleNarrative(attacker, defender, ability, damage, attackerHP, defenderHP) {
    try {
        const result = await callAI([
            {
                role: "system",
                content: "You are a dramatic battle narrator for a Discord bot. Write ONE short, exciting sentence (max 20 words) describing this attack. Be dramatic and funny. No mentions or IDs."
            },
            {
                role: "user",
                content: `${attacker} used ${ability.name} on ${defender} for ${damage} damage! ${defender} has ${defenderHP} HP left.`
            }
        ], { maxTokens: 80 })
        return sanitizeAIOutput(result.content)
    } catch {
        return `${attacker} used ${ability.emoji} **${ability.name}** for **${damage}** damage!`
    }
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── !battle @user ──────────────────────────────────────────────────────────
    if (msgLower.startsWith("!battle") && !msgLower.startsWith("!battleai") && !msgLower.startsWith("!bossfight")) {
        const mentioned = message.mentions.users.first()
        if (!mentioned) {
            await createSafeMessage(message.channel,
                `⚔️ **Battle Commands:**\n\`!battle @user\` — Challenge someone to a PvP battle\n\`!battleai\` — Fight an AI opponent\n\`!bossfight\` — Take on a powerful boss\n\`!battlestats\` — View your battle record`)
            return true
        }
        if (mentioned.id === userId) {
            await createSafeMessage(message.channel, `😂 **${senderName}**, you can't battle yourself. That's just sad.`)
            return true
        }
        if (mentioned.bot) {
            await createSafeMessage(message.channel, `🤖 You can't battle a bot! Use \`!battleai\` to fight an AI opponent.`)
            return true
        }

        const cd = checkCooldown(userId, "battle", 60 * 1000)
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ **${senderName}**, you need to recover! Wait **${cd.remaining}s** before battling again.`)
            return true
        }

        const targetName = sanitizeName(message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
        const { user: p1 } = getUser(userId, senderName)
        const { user: p2 } = getUser(mentioned.id, targetName)

        let p1HP = calcPlayerHP(p1)
        let p2HP = calcPlayerHP(p2)
        const maxP1HP = p1HP
        const maxP2HP = p2HP

        let narrative = `⚔️ **BATTLE: ${senderName} vs ${targetName}!**\n\n`
        narrative += `${senderName}: ❤️ ${p1HP} HP | ${targetName}: ❤️ ${p2HP} HP\n\n`

        let round = 1
        let currentAttacker = userId
        let winner = null
        let winnerName = null

        while (p1HP > 0 && p2HP > 0 && round <= 10) {
            const ability = randomAbility()
            const damage = rollDamage(ability)

            let attackerName, defenderName
            if (currentAttacker === userId) {
                attackerName = senderName
                defenderName = targetName
                p2HP = Math.max(0, p2HP - damage)
            } else {
                attackerName = targetName
                defenderName = senderName
                p1HP = Math.max(0, p1HP - damage)
            }

            const line = await generateBattleNarrative(attackerName, defenderName, ability, damage, currentAttacker === userId ? p1HP : p2HP, currentAttacker === userId ? p2HP : p1HP)
            narrative += `**Round ${round}:** ${line}\n`
            narrative += `  ${senderName}: ❤️ ${p1HP} | ${targetName}: ❤️ ${p2HP}\n\n`

            if (p1HP <= 0) { winner = mentioned.id; winnerName = targetName; break }
            if (p2HP <= 0) { winner = userId; winnerName = senderName; break }

            currentAttacker = currentAttacker === userId ? mentioned.id : userId
            round++
        }

        // Tiebreaker if both still alive after 10 rounds
        if (!winner) {
            winner = p1HP >= p2HP ? userId : mentioned.id
            winnerName = p1HP >= p2HP ? senderName : targetName
        }

        const loserName = winnerName === senderName ? targetName : senderName
        const loserId = winnerName === senderName ? mentioned.id : userId
        const coinsReward = Math.floor(Math.random() * 100) + 50
        const xpReward = Math.floor(Math.random() * 50) + 25

        const { data: winData, user: winUser } = getUser(winner, winnerName)
        winUser.coins += coinsReward
        winUser.stats = winUser.stats || {}
        winUser.stats.battlesWon = (winUser.stats.battlesWon || 0) + 1
        winUser.stats.battles = (winUser.stats.battles || 0) + 1
        saveEconomy(winData)
        addXP(winner, winnerName, xpReward)

        const { data: loseData, user: loseUser } = getUser(loserId, loserName)
        loseUser.stats = loseUser.stats || {}
        loseUser.stats.battles = (loseUser.stats.battles || 0) + 1
        saveEconomy(loseData)

        narrative += `🏆 **${winnerName} WINS!** +${coinsReward} coins | +${xpReward} XP\n💀 **${loserName}** has been defeated!`

        await createSafeMessage(message.channel, narrative)
        return true
    }

    // ── !battleai ──────────────────────────────────────────────────────────────
    if (msgLower === "!battleai") {
        const cd = checkCooldown(userId, "battleai", 45 * 1000)
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ Wait **${cd.remaining}s** before battling again.`)
            return true
        }

        const { user } = getUser(userId, senderName)
        const aiNames = ["Shadow Bot", "Chaos Engine", "Void Walker", "Cursed AI", "Glitch Demon"]
        const aiName = aiNames[Math.floor(Math.random() * aiNames.length)]
        const aiLevel = Math.max(1, (user.level || 1) + Math.floor(Math.random() * 5) - 2)

        let playerHP = calcPlayerHP(user)
        let aiHP = 100 + aiLevel * 5

        let narrative = `🤖 **BATTLE: ${senderName} vs ${aiName} (AI Lv.${aiLevel})!**\n\n`
        narrative += `${senderName}: ❤️ ${playerHP} HP | ${aiName}: ❤️ ${aiHP} HP\n\n`

        let round = 1
        let playerTurn = true

        while (playerHP > 0 && aiHP > 0 && round <= 8) {
            const ability = randomAbility()
            const damage = rollDamage(ability)

            if (playerTurn) {
                aiHP = Math.max(0, aiHP - damage)
                narrative += `**Round ${round}:** ${senderName} used ${ability.emoji} **${ability.name}** for **${damage}** dmg! ${aiName}: ❤️ ${aiHP}\n`
            } else {
                playerHP = Math.max(0, playerHP - damage)
                narrative += `**Round ${round}:** ${aiName} used ${ability.emoji} **${ability.name}** for **${damage}** dmg! ${senderName}: ❤️ ${playerHP}\n`
            }

            if (aiHP <= 0 || playerHP <= 0) break
            playerTurn = !playerTurn
            round++
        }

        const playerWon = playerHP > 0 && (aiHP <= 0 || playerHP >= aiHP)
        const coinsReward = playerWon ? Math.floor(Math.random() * 80) + 30 : 10
        const xpReward = playerWon ? Math.floor(Math.random() * 40) + 20 : 5

        const { data, user: freshUser } = getUser(userId, senderName)
        freshUser.coins += coinsReward
        freshUser.stats = freshUser.stats || {}
        freshUser.stats.battles = (freshUser.stats.battles || 0) + 1
        if (playerWon) freshUser.stats.battlesWon = (freshUser.stats.battlesWon || 0) + 1
        saveEconomy(data)
        addXP(userId, senderName, xpReward)

        narrative += `\n${playerWon
            ? `🏆 **${senderName} WINS!** +${coinsReward} coins | +${xpReward} XP`
            : `💀 **${aiName} wins!** Better luck next time, ${senderName}. (+${coinsReward} coins consolation)`
        }`

        await createSafeMessage(message.channel, narrative)
        return true
    }

    // ── !bossfight ─────────────────────────────────────────────────────────────
    if (msgLower === "!bossfight") {
        const cd = checkCooldown(userId, "bossfight", 5 * 60 * 1000)
        if (!cd.ok) {
            await createSafeMessage(message.channel, `⏳ The boss needs to recover! Wait **${Math.floor(cd.remaining / 60)}m ${cd.remaining % 60}s**.`)
            return true
        }

        const boss = BOSSES[Math.floor(Math.random() * BOSSES.length)]
        const { user } = getUser(userId, senderName)
        let playerHP = calcPlayerHP(user)
        let bossHP = boss.hp

        let narrative = `👹 **BOSS FIGHT: ${senderName} vs ${boss.emoji} ${boss.name}!**\n\n`
        narrative += `${senderName}: ❤️ ${playerHP} HP | ${boss.name}: ❤️ ${bossHP} HP\n\n`

        let round = 1
        let playerTurn = true

        while (playerHP > 0 && bossHP > 0 && round <= 12) {
            const ability = randomAbility()
            const playerDmg = rollDamage(ability)
            const bossDmg = Math.floor(Math.random() * 60) + 20

            if (playerTurn) {
                bossHP = Math.max(0, bossHP - playerDmg)
                narrative += `**R${round}:** ${senderName} ${ability.emoji} **${ability.name}** → ${playerDmg} dmg! Boss: ❤️ ${bossHP}\n`
            } else {
                playerHP = Math.max(0, playerHP - bossDmg)
                narrative += `**R${round}:** ${boss.name} 💥 **Rage Strike** → ${bossDmg} dmg! ${senderName}: ❤️ ${playerHP}\n`
            }

            if (bossHP <= 0 || playerHP <= 0) break
            playerTurn = !playerTurn
            round++
        }

        const playerWon = bossHP <= 0 || (playerHP > 0 && playerHP > bossHP / 2)
        const reward = playerWon ? boss.reward : { coins: 20, xp: 10 }

        const { data, user: freshUser } = getUser(userId, senderName)
        freshUser.coins += reward.coins
        freshUser.stats = freshUser.stats || {}
        freshUser.stats.battles = (freshUser.stats.battles || 0) + 1
        freshUser.stats.bossKills = (freshUser.stats.bossKills || 0) + (playerWon ? 1 : 0)
        saveEconomy(data)
        addXP(userId, senderName, reward.xp)

        narrative += `\n${playerWon
            ? `🏆 **${senderName} DEFEATED ${boss.name}!** +${reward.coins} coins | +${reward.xp} XP 🎉`
            : `💀 **${boss.name} wins!** You put up a fight though. (+${reward.coins} coins consolation)`
        }`

        await createSafeMessage(message.channel, narrative)
        return true
    }

    // ── !battlestats ───────────────────────────────────────────────────────────
    if (msgLower === "!battlestats") {
        const { user } = getUser(userId, senderName)
        const s = user.stats || {}
        const battles = s.battles || 0
        const wins = s.battlesWon || 0
        const losses = Math.max(0, battles - wins)
        const winRate = battles > 0 ? Math.floor((wins / battles) * 100) : 0
        const bossKills = s.bossKills || 0

        await createSafeMessage(message.channel,
            `⚔️ **${senderName}'s Battle Stats**\n\n` +
            `🏆 Wins: **${wins}** | 💀 Losses: **${losses}**\n` +
            `📊 Win Rate: **${winRate}%** | Total Battles: **${battles}**\n` +
            `👹 Boss Kills: **${bossKills}**`)
        return true
    }

    return false
}

module.exports = { handle }
