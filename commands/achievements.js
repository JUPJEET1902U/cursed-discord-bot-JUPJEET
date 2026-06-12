const { getUser, ACHIEVEMENTS } = require("../utils/economy")

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower === "!achievements" || msgLower === "!ach") {
        const { user } = getUser(userId, senderName)
        const unlocked = new Set(user.achievements || [])
        const lines = ACHIEVEMENTS.map(a => {
            const done = unlocked.has(a.id)
            return `${done ? "✅" : "🔒"} **${a.name}** — ${a.desc}${done ? "" : ` *(+${a.xp} XP, +${a.coins} coins)*`}`
        })
        const count = unlocked.size
        const total = ACHIEVEMENTS.length
        await message.channel.send(`🏆 **${senderName}'s Achievements** — ${count}/${total}\n\n${lines.join("\n")}`)
        return true
    }

    return false
}

module.exports = { handle }
