const { getUser, saveEconomy, calcLevel, getOrCreateDailyQuests, checkAndGrantAchievements, CURRENCY } = require("../utils/economy")

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

    if (msgLower === "!quests" || msgLower === "!dailyquests") {
        const { user } = getUser(userId, senderName)
        const qp = getOrCreateDailyQuests(user)
        const lines = qp.quests.map((q, i) => {
            const done = q.progress >= q.goal
            const bar = done ? "✅" : `${q.progress}/${q.goal}`
            return `${done ? "✅" : "🔲"} **Quest ${i + 1}:** ${q.desc}\n   Progress: \`[${bar}]\` | Reward: **${q.reward.coins} coins** + **${q.reward.xp} XP**`
        })
        const allDone = qp.quests.every(q => q.progress >= q.goal)
        const footer = qp.claimed
            ? "\n\n✅ Quests already claimed today! Come back tomorrow."
            : allDone
            ? "\n\n🎉 All quests complete! Type `!claimquests` to collect your rewards!"
            : "\n\nComplete all 3 to claim your rewards with `!claimquests`."
        await message.channel.send(`📋 **DAILY QUESTS** — ${new Date().toDateString()}\n\n${lines.join("\n\n")}${footer}`)
        return true
    }

    if (msgLower === "!claimquests" || msgLower === "!claimquest") {
        const { data, user } = getUser(userId, senderName)
        const qp = getOrCreateDailyQuests(user)
        if (qp.claimed) {
            await message.channel.send(`😒 **${senderName}**, you already claimed today's quests. Come back tomorrow, you greedy thing.`)
            return true
        }
        const allDone = qp.quests.every(q => q.progress >= q.goal)
        if (!allDone) {
            const incomplete = qp.quests.filter(q => q.progress < q.goal)
            const lines = incomplete.map(q => `• ${q.desc} (${q.progress}/${q.goal})`)
            await message.channel.send(`❌ **${senderName}**, you haven't finished all quests yet!\n\nStill need:\n${lines.join("\n")}`)
            return true
        }
        let totalCoins = 0
        let totalXP = 0
        for (const q of qp.quests) {
            totalCoins += q.reward.coins
            totalXP += q.reward.xp
        }
        user.coins += totalCoins
        user.xp += totalXP
        user.level = calcLevel(user.xp)
        user.stats = user.stats || {}
        user.stats.questClaimed = (user.stats.questClaimed || 0) + 1
        qp.claimed = true
        saveEconomy(data)
        await message.channel.send(`🎉 **${senderName}** claimed all daily quest rewards!\n\n💰 **+${totalCoins} coins** | ⭐ **+${totalXP} XP**\nTotal balance: **${user.coins} coins** | Level: **${user.level}**\n\nNew quests tomorrow. Don't slack off. 😤`)
        await announce(message, userId, senderName)
        return true
    }

    return false
}

module.exports = { handle }
