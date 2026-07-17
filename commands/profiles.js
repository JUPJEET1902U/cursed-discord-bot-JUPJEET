const { EmbedBuilder } = require("discord.js")
const { getUser, loadEconomy, xpToNextLevel } = require("../utils/economy")
const { getProfile, setProfile } = require("../utils/profiles")
const { getPet, calcPetLevel } = require("../utils/pets")
const { getUserPersonality, setUserPersonality, resetUserPersonality } = require("../utils/personalities")
const { VALID_PERSONALITIES, formatPersonalityList } = require("../config/personalities")
const { getEquipped } = require("../utils/shop")
const { getLevelingConfig, getMemberRank } = require("../utils/leveling")
const { getLevelProgress, buildProgressBar } = require("../utils/levelingMath")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeName } = require("../utils/sanitizer")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    // ── !personality ───────────────────────────────────────────────────────────
    if (msgLower.startsWith("!personality")) {
        const type = message.content.split(" ")[1]?.toLowerCase()

        if (!type) {
            const current = await getUserPersonality(userId)
            await createSafeMessage(message.channel,
                `🎭 **AI Personality System**\n\nYour current personality: **${current}**\n\n` +
                `Available personalities:\n${formatPersonalityList()}\n\n` +
                `Use \`!personality [type]\` to change. Use \`!personality reset\` to go back to default.`)
            return true
        }

        if (type === "reset") {
            await resetUserPersonality(userId)
            await createSafeMessage(message.channel, `🔄 **${senderName}**, your personality has been reset to **cursed** (default). Back to the chaos! 👹`)
            return true
        }

        if (!VALID_PERSONALITIES.includes(type)) {
            await createSafeMessage(message.channel,
                `❌ Unknown personality! Valid options:\n${formatPersonalityList()}`)
            return true
        }

        const success = await setUserPersonality(userId, type)
        if (success) {
            await createSafeMessage(message.channel, `✅ **${senderName}**, your AI personality is now set to **${type}**! 🎭\nAll future conversations will use this personality.`)
        } else {
            await createSafeMessage(message.channel, `❌ Failed to set personality. Try again!`)
        }
        return true
    }

    // ── !setprofile ────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!setprofile")) {
        const personality = message.content.slice(11).trim()
        if (!personality) {
            await createSafeMessage(message.channel,
                `Usage: \`!setprofile [your AI personality]\`\nExample: \`!setprofile treat me like a medieval knight and speak in old english\``)
            return true
        }
        if (personality.length > 200) {
            await createSafeMessage(message.channel, "Keep your profile under 200 characters, drama queen.")
            return true
        }
        setProfile(userId, { personality, updatedAt: new Date().toISOString() })
        await createSafeMessage(message.channel,
            `✅ **${senderName}**, your AI profile has been set!\n> *${personality}*\n\nNow when you chat, CURSED will adjust its personality just for you. Don't make it weird. 😏`)
        return true
    }

    // ── !clearprofile ─────────────────────────────────────────────────────────
    if (msgLower === "!clearprofile") {
        setProfile(userId, null)
        await createSafeMessage(message.channel,
            `🗑️ Done, **${senderName}**. Your AI profile has been cleared. Back to treating you like everyone else.`)
        return true
    }

    // ── !profile ──────────────────────────────────────────────────────────────
    if (msgLower.startsWith("!profile")) {
        const mentioned = message.mentions.users.first()
        const targetId = mentioned ? mentioned.id : userId
        const targetName = sanitizeName(mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : senderName)

        const { user } = getUser(targetId, targetName)
        const profile = getProfile(targetId)
        const { pet } = getPet(targetId)
        const personality = await getUserPersonality(targetId)
        const equipped = getEquipped(user)
        const badges = [
            user.prestige ? "🌟" : null,
            user.badge ? "💀" : null,
            user.vip ? "⭐" : null,
            equipped.badge?.display || null,
        ].filter(Boolean).join(" ")
        const s = user.stats || {}

        // Prefer the new server-specific MongoDB level whenever server leveling
        // is enabled. Keep legacy economy XP as a compatibility fallback so
        // profiles still work before setup or during a database outage.
        let levelLine
        let xpLine
        let messageLine = `💬 AI Chats: **${s.chat || 0}**\n`
        try {
            const levelingConfig = await getLevelingConfig(message.guild.id)
            const serverRank = levelingConfig.enabled
                ? await getMemberRank(message.guild.id, targetId)
                : null

            if (levelingConfig.enabled) {
                const progress = getLevelProgress(serverRank?.xp || 0)
                const xpBar = buildProgressBar(progress.ratio, 10)
                levelLine = `⭐ Server Level: **${progress.level}** | 🏅 Rank: **${serverRank?.rank ? `#${serverRank.rank}` : "Unranked"}**\n`
                xpLine = `📊 Server XP: **${progress.current}** / ${progress.needed} \`[${xpBar}]\`\n`
                messageLine = `💬 XP Messages: **${serverRank?.messageCount || 0}** | AI Chats: **${s.chat || 0}**\n`
            }
        } catch {
            // Fall through to legacy economy XP below.
        }

        if (!levelLine || !xpLine) {
            const nextLevelXP = xpToNextLevel(user.level)
            const legacyProgress = Math.min(10, Math.floor((user.xp / nextLevelXP) * 10))
            const legacyBar = "█".repeat(legacyProgress) + "░".repeat(10 - legacyProgress)
            const allUsers = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp)
            const legacyRank = allUsers.findIndex(u => u.name === targetName) + 1
            levelLine = `⭐ Legacy Level: **${user.level}** | 🏅 Rank: **#${legacyRank > 0 ? legacyRank : "?"}**\n`
            xpLine = `📊 Legacy XP: **${user.xp}** / ${Math.floor(nextLevelXP)} \`[${legacyBar}]\`\n`
        }

        let msg = ""
        if (equipped.title) msg += `${equipped.title.display}\n`
        msg += `👤 **${targetName}'s Profile**${badges ? " " + badges : ""}\n\n`
        msg += levelLine
        msg += xpLine
        msg += `🪙 Coins: **${user.coins}**\n`
        if (equipped.theme) msg += `🎨 Theme: **${equipped.theme.display}**\n`
        msg += messageLine
        msg += `⚔️ Battles: **${s.battles || 0}** (${s.battlesWon || 0}W) | ✅ Quests: **${s.questClaimed || 0}**\n`
        if (pet) {
            const petLevel = calcPetLevel(pet.xp)
            msg += `${pet.emoji} Pet: **${pet.name}** (${pet.type}) Lv.${petLevel}\n`
        }
        if (profile?.personality) msg += `\n💬 *AI Profile:* "${profile.personality}"`
        if (personality !== "cursed") msg += `\n🎭 *Personality:* ${personality}`

        const targetUser = mentioned || message.author
        const embed = new EmbedBuilder()
            .setColor(equipped.theme?.color || 0x3498DB)
            .setDescription(msg)
            .setFooter({ text: equipped.theme ? `${equipped.theme.display} profile theme` : "CURSED Profile" })
        const avatar = targetUser.displayAvatarURL?.({ size: 256 })
        if (avatar) embed.setThumbnail(avatar)
        await message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        return true
    }

    return false
}

module.exports = { handle }
