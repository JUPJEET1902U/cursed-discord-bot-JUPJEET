const { getUser, ACHIEVEMENTS } = require("../utils/economy")
const logger = require("../utils/logger")
const log = logger.child("Achievements")

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower === "!achievements" || msgLower === "!ach") {
        try {
            const { user } = getUser(userId, senderName)
            const unlocked = new Set(user.achievements || [])
            const lines = ACHIEVEMENTS.map(a => {
                const done = unlocked.has(a.id)
                return `${done ? "✅" : "🔒"} **${a.name}** — ${a.desc}${done ? "" : ` *(+${a.xp} XP, +${a.coins} coins)*`}`
            })
            const count = unlocked.size
            const total = ACHIEVEMENTS.length
            const header = `🏆 **${senderName}'s Achievements** — ${count}/${total}\n\n`

            // Discord limit is 2000 chars — send in chunks to avoid the limit
            const LIMIT = 1900
            const chunks = []
            let current = header
            for (const line of lines) {
                if (current.length + line.length + 1 > LIMIT) {
                    chunks.push(current)
                    current = line + "\n"
                } else {
                    current += line + "\n"
                }
            }
            if (current.trim()) chunks.push(current)

            for (const chunk of chunks) {
                await message.channel.send(chunk)
            }
        } catch (err) {
            log.error(`!achievements failed for ${userId}: ${err.message}`, { stack: err.stack })
            await message.channel.send("⚠️ Could not load achievements. Please try again.")
        }
        return true
    }

    return false
}

module.exports = { handle }
