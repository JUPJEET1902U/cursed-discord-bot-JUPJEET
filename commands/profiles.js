const { getUser, loadEconomy, xpToNextLevel } = require("../utils/economy")
const { getProfile, setProfile } = require("../utils/profiles")
const { getPet } = require("../utils/pets")

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id

    if (msgLower.startsWith("!setprofile")) {
        const personality = message.content.slice(11).trim()
        if (!personality) {
            await message.channel.send(`Usage: \`!setprofile [your AI personality]\`\nExample: \`!setprofile treat me like a medieval knight and speak in old english\``)
            return true
        }
        if (personality.length > 200) {
            await message.channel.send("Keep your profile under 200 characters, drama queen.")
            return true
        }
        setProfile(userId, { personality, updatedAt: new Date().toISOString() })
        await message.channel.send(`✅ **${senderName}**, your AI profile has been set!\n> *${personality}*\n\nNow when you chat, CURSED will adjust its personality just for you. Don't make it weird. 😏`)
        return true
    }

    if (msgLower === "!clearprofile") {
        setProfile(userId, null)
        await message.channel.send(`🗑️ Done, **${senderName}**. Your AI profile has been cleared. Back to treating you like everyone else.`)
        return true
    }

    if (msgLower.startsWith("!profile")) {
        const mentioned = message.mentions.users.first()
        const targetId = mentioned ? mentioned.id : userId
        const targetName = mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : senderName

        const { user } = getUser(targetId, targetName)
        const profile = getProfile(targetId)
        const { pet } = getPet(targetId)
        const nextLevelXP = xpToNextLevel(user.level)
        const progress = Math.floor((user.xp / nextLevelXP) * 10)
        const xpBar = "█".repeat(progress) + "░".repeat(10 - progress)
        const badges = [user.prestige ? "🌟" : null, user.badge ? "💀" : null, user.vip ? "⭐" : null].filter(Boolean).join(" ")
        const achCount = (user.achievements || []).length

        const allUsers = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp)
        const rank = allUsers.findIndex(u => u.name === targetName) + 1

        let msg = `👤 **${targetName}'s Profile**${badges ? " " + badges : ""}\n\n`
        msg += `⭐ Level: **${user.level}** | 🏅 Rank: **#${rank}**\n`
        msg += `📊 XP: **${user.xp}** / ${Math.floor(nextLevelXP)} \`[${xpBar}]\`\n`
        msg += `🪙 Coins: **${user.coins}**\n`
        msg += `🏆 Achievements: **${achCount}**\n`
        if (pet) msg += `${pet.emoji} Pet: **${pet.name}** (${pet.type})\n`
        if (profile?.personality) msg += `\n💬 *AI Profile:* "${profile.personality}"`

        await message.channel.send(msg)
        return true
    }

    return false
}

module.exports = { handle }
