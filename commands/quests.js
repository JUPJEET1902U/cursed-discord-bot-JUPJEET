const { getUser, saveEconomy, calcLevel, getOrCreateDailyQuests } = require("../utils/economy")
const {
    economy: economyEmbed,
    statusLine,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower === "!quests" || msgLower === "!dailyquests") {
        const { user } = getUser(userId, senderName)
        const questProgress = getOrCreateDailyQuests(user)
        const fields = questProgress.quests.map((quest, index) => {
            const complete = quest.progress >= quest.goal
            return {
                name: `Quest ${index + 1}${complete ? " · Complete" : ""}`,
                value: `${quest.desc}\nProgress: **${Math.min(quest.progress, quest.goal)}/${quest.goal}** · Reward: **${quest.reward.coins} coins + ${quest.reward.xp} XP**`,
                inline: false,
            }
        })
        const allDone = questProgress.quests.every(quest => quest.progress >= quest.goal)
        const state = questProgress.claimed
            ? "Rewards already claimed today."
            : allDone
                ? "All quests complete. Use `!claimquests` to collect rewards."
                : "Complete all quests, then use `!claimquests`."
        await sendEmbed(message, economyEmbed("Daily quests", state, { fields, timestamp: false }))
        return true
    }

    if (msgLower === "!claimquests" || msgLower === "!claimquest") {
        const { data, user } = getUser(userId, senderName)
        const questProgress = getOrCreateDailyQuests(user)
        if (questProgress.claimed) {
            await sendSafe(message, statusLine("warning", "Today's quest rewards have already been claimed."))
            return true
        }

        const incomplete = questProgress.quests.filter(quest => quest.progress < quest.goal)
        if (incomplete.length) {
            await sendEmbed(message, economyEmbed("Quest rewards", "Some quests are still incomplete.", {
                fields: incomplete.map(quest => ({
                    name: quest.desc,
                    value: `${quest.progress}/${quest.goal}`,
                    inline: false,
                })),
            }))
            return true
        }

        const totals = questProgress.quests.reduce((sum, quest) => ({
            coins: sum.coins + quest.reward.coins,
            xp: sum.xp + quest.reward.xp,
        }), { coins: 0, xp: 0 })
        user.coins += totals.coins
        user.xp += totals.xp
        user.level = calcLevel(user.xp)
        user.stats = user.stats || {}
        user.stats.questClaimed = (user.stats.questClaimed || 0) + 1
        questProgress.claimed = true
        saveEconomy(data)

        await sendEmbed(message, economyEmbed("Quest rewards claimed", null, {
            fields: [
                { name: "Coins", value: `+${totals.coins}`, inline: true },
                { name: "XP", value: `+${totals.xp}`, inline: true },
                { name: "Balance", value: `${user.coins.toLocaleString()} coins`, inline: true },
                { name: "Level", value: String(user.level), inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = { handle }
