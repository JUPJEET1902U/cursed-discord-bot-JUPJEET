const { getUser, loadEconomy, xpToNextLevel } = require("../utils/economy")
const { getProfile, setProfile } = require("../utils/profiles")
const { getPet, calcPetLevel } = require("../utils/pets")
const { getUserPersonality, setUserPersonality, resetUserPersonality } = require("../utils/personalities")
const { VALID_PERSONALITIES, formatPersonalityList } = require("../config/personalities")
const { getEquipped } = require("../utils/shop")
const { getLevelingConfig, getMemberRank } = require("../utils/leveling")
const { getLevelProgress, buildProgressBar } = require("../utils/levelingMath")
const { sanitizeName } = require("../utils/sanitizer")
const {
    profile: profileEmbed,
    info,
    statusLine,
    invalidUsage,
    sendEmbed,
    sendSafe,
} = require("../utils/responseBuilder")

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (msgLower.startsWith("!personality")) {
        const type = message.content.split(" ")[1]?.toLowerCase()

        if (!type) {
            const current = await getUserPersonality(userId)
            await sendEmbed(message, info(null, {
                title: "AI personality",
                fields: [
                    { name: "Current", value: current, inline: true },
                    { name: "Available", value: formatPersonalityList().slice(0, 1024), inline: false },
                    { name: "Usage", value: "`!personality [type]` · `!personality reset`", inline: false },
                ],
                footer: "CURSED • AI",
            }))
            return true
        }

        if (type === "reset") {
            await resetUserPersonality(userId)
            await sendSafe(message, statusLine("success", "AI personality reset to **cursed**."))
            return true
        }

        if (!VALID_PERSONALITIES.includes(type)) {
            await sendEmbed(message, info("Choose one of the available personality modes.", {
                title: "Unknown personality",
                fields: [{ name: "Available", value: formatPersonalityList().slice(0, 1024), inline: false }],
                footer: "CURSED • AI",
            }))
            return true
        }

        const updated = await setUserPersonality(userId, type)
        await sendSafe(message, updated
            ? statusLine("success", `AI personality set to **${type}**.`)
            : statusLine("error", "Could not update your AI personality."))
        return true
    }

    if (msgLower.startsWith("!setprofile")) {
        const personality = message.content.slice(11).trim()
        if (!personality) {
            await sendSafe(message, invalidUsage("!setprofile [your AI preference]"))
            return true
        }
        if (personality.length > 200) {
            await sendSafe(message, statusLine("warning", "AI profile text must be 200 characters or fewer."))
            return true
        }
        setProfile(userId, { personality, updatedAt: new Date().toISOString() })
        await sendEmbed(message, profileEmbed("AI profile updated", personality, {
            fields: [{ name: "Effect", value: "CURSED will use this preference in future AI conversations.", inline: false }],
        }))
        return true
    }

    if (msgLower === "!clearprofile") {
        setProfile(userId, null)
        await sendSafe(message, statusLine("success", "AI profile cleared."))
        return true
    }

    if (msgLower.startsWith("!profile")) {
        const mentioned = message.mentions.users.first()
        const targetId = mentioned ? mentioned.id : userId
        const targetName = sanitizeName(mentioned
            ? (message.guild.members.cache.get(mentioned.id)?.displayName || mentioned.username)
            : senderName)

        const { user } = getUser(targetId, targetName)
        const savedProfile = getProfile(targetId)
        const { pet } = getPet(targetId)
        const personality = await getUserPersonality(targetId)
        const equipped = getEquipped(user)
        const stats = user.stats || {}

        const badges = [
            user.prestige ? "Prestige" : null,
            user.badge ? "Cursed Badge" : null,
            user.vip ? "VIP" : null,
            equipped.badge?.display || null,
        ].filter(Boolean)

        let levelValue
        let xpValue
        let activityValue = `AI chats: ${stats.chat || 0}`
        try {
            const levelingConfig = await getLevelingConfig(message.guild.id)
            const serverRank = levelingConfig.enabled
                ? await getMemberRank(message.guild.id, targetId)
                : null

            if (levelingConfig.enabled) {
                const progress = getLevelProgress(serverRank?.xp || 0)
                const xpBar = buildProgressBar(progress.ratio, 10)
                levelValue = `Level ${progress.level}${serverRank?.rank ? ` · Rank #${serverRank.rank}` : " · Unranked"}`
                xpValue = `${progress.current} / ${progress.needed}\n\`${xpBar}\``
                activityValue = `XP messages: ${serverRank?.messageCount || 0} · AI chats: ${stats.chat || 0}`
            }
        } catch {
            // Fall back to legacy economy XP if server leveling is unavailable.
        }

        if (!levelValue || !xpValue) {
            const nextLevelXP = xpToNextLevel(user.level)
            const legacyProgress = Math.min(10, Math.max(0, Math.floor((user.xp / nextLevelXP) * 10)))
            const legacyBar = "█".repeat(legacyProgress) + "░".repeat(10 - legacyProgress)
            const allUsers = Object.values(loadEconomy()).sort((a, b) => b.xp - a.xp)
            const legacyRank = allUsers.findIndex(entry => entry.name === targetName) + 1
            levelValue = `Level ${user.level}${legacyRank > 0 ? ` · Rank #${legacyRank}` : ""}`
            xpValue = `${user.xp} / ${Math.floor(nextLevelXP)}\n\`${legacyBar}\``
        }

        const fields = [
            { name: "Level", value: levelValue, inline: true },
            { name: "Coins", value: Number(user.coins || 0).toLocaleString("en-US"), inline: true },
            { name: "XP", value: xpValue, inline: false },
            { name: "Activity", value: activityValue, inline: false },
            { name: "Games", value: `Battles: ${stats.battles || 0} · Wins: ${stats.battlesWon || 0} · Quests: ${stats.questClaimed || 0}`, inline: false },
        ]

        if (pet) fields.push({
            name: "Pet",
            value: `${pet.emoji || ""} ${pet.name} · ${pet.type} · Level ${calcPetLevel(pet.xp)}`.trim(),
            inline: false,
        })
        if (badges.length) fields.push({ name: "Badges", value: badges.join(" · "), inline: false })
        if (equipped.theme) fields.push({ name: "Theme", value: equipped.theme.display, inline: true })
        if (personality !== "cursed") fields.push({ name: "AI personality", value: personality, inline: true })
        if (savedProfile?.personality) fields.push({ name: "AI profile", value: savedProfile.personality, inline: false })

        const targetUser = mentioned || message.author
        const embed = profileEmbed(`${targetName}'s profile`, null, {
            fields,
            thumbnail: targetUser.displayAvatarURL?.({ size: 256 }) || null,
            footer: equipped.theme ? `CURSED • ${equipped.theme.display}` : "CURSED • Profile",
        })
        if (equipped.theme?.color) embed.setColor(equipped.theme.color)
        await sendEmbed(message, embed)
        return true
    }

    return false
}

module.exports = { handle }
