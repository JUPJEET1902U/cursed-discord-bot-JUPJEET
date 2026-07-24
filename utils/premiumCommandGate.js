const {
    consumeFeatureUsage,
    getPlanLimits,
    getUserPlan,
} = require("./premium")

const FUN_AI_COMMANDS = new Set(["roast", "trivia", "story", "roleplay", "challenge", "fortune"])
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

function quotaMessage(feature, result, plan) {
    const label = feature === "image"
        ? "image generations"
        : feature === "meme"
            ? "meme generations"
            : "Fun AI commands"
    const scope = result.scope === "guild" ? "This server" : "You"
    const upgrade = plan === "free"
        ? " Premium has higher daily limits."
        : " The daily limit resets at 00:00 UTC."
    return `⏳ **${scope} reached the daily ${label} limit (${result.limit}).**${upgrade}`
}

async function checkCommandPlan(message, commandName) {
    const userId = message.author.id
    const guildId = message.guild?.id || "dm"
    const plan = getUserPlan(userId)
    const limits = getPlanLimits(userId)

    if (commandName === "imagine") {
        const content = String(message.content || "").toLowerCase()
        const asksForVariation = /^!imagine\s+(variation|variations)\b/i.test(message.content)
        const usesAvatar = Boolean(message.mentions?.users?.first?.())
        if (asksForVariation && !limits.imageVariations) {
            await message.channel.send({
                content: "💎 Image variations are a **CURSED Premium** feature. Free image generation is still available with a new prompt.",
                allowedMentions: SAFE_MENTIONS,
            })
            return { ok: false }
        }
        if (usesAvatar && !limits.imageAvatarReference) {
            await message.channel.send({
                content: "💎 Avatar-reference image generation is a **CURSED Premium** feature. Free users can still generate images from text prompts.",
                allowedMentions: SAFE_MENTIONS,
            })
            return { ok: false }
        }
        const units = content.includes("variations") ? 2 : 1
        const usage = consumeFeatureUsage("image", { userId, guildId, units })
        if (!usage.ok) {
            await message.channel.send({ content: quotaMessage("image", usage, plan), allowedMentions: SAFE_MENTIONS })
            return { ok: false }
        }
    }

    if (commandName === "meme") {
        const usage = consumeFeatureUsage("meme", { userId, guildId })
        if (!usage.ok) {
            await message.channel.send({ content: quotaMessage("meme", usage, plan), allowedMentions: SAFE_MENTIONS })
            return { ok: false }
        }
    }

    if (FUN_AI_COMMANDS.has(commandName)) {
        const usage = consumeFeatureUsage("fun", { userId, guildId })
        if (!usage.ok) {
            await message.channel.send({ content: quotaMessage("fun", usage, plan), allowedMentions: SAFE_MENTIONS })
            return { ok: false }
        }
    }

    return { ok: true }
}

module.exports = { FUN_AI_COMMANDS, checkCommandPlan }
