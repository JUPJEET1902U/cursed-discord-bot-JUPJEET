const { resolveCommandPrefix } = require("./prefix")
const { getServerConfig } = require("./serverConfig")
const { SAFE_MENTIONS } = require("./responseBuilder")
const {
    matchesRule,
    getResponderRules,
    getReactionRules,
} = require("./automationStore")
const logger = require("./logger")

const log = logger.child("ManagedAutomation")

function shouldSkipAutomation(message) {
    if (!message?.guild || !message?.author || message.author.bot) return true
    if (!message.content || !message.channel?.isTextBased?.()) return true
    const config = getServerConfig(message.guild.id).config
    return Boolean(resolveCommandPrefix(message.content, config))
}

async function applyAutoResponses(message) {
    const rules = await getResponderRules(message.guild.id)
    for (const rule of rules) {
        if (!matchesRule(message.content, rule)) continue
        await message.reply({
            content: String(rule.response).slice(0, 1800),
            allowedMentions: SAFE_MENTIONS,
        }).catch(async () => {
            await message.channel.send({
                content: String(rule.response).slice(0, 1800),
                allowedMentions: SAFE_MENTIONS,
            }).catch(() => {})
        })
        return true
    }
    return false
}

async function applyAutoReactions(message) {
    const rules = await getReactionRules(message.guild.id)
    const matching = rules.filter(rule => matchesRule(message.content, rule)).slice(0, 3)
    let reacted = false
    for (const rule of matching) {
        for (const emoji of (rule.emojis || []).slice(0, 5)) {
            try {
                await message.react(emoji)
                reacted = true
            } catch (error) {
                log.debug(`Could not react with ${emoji}: ${error.message}`)
            }
        }
    }
    return reacted
}

async function processManagedAutomationMessage(message) {
    if (shouldSkipAutomation(message)) return { responded: false, reacted: false }
    const [responded, reacted] = await Promise.all([
        applyAutoResponses(message),
        applyAutoReactions(message),
    ])
    return { responded, reacted }
}

module.exports = {
    shouldSkipAutomation,
    applyAutoResponses,
    applyAutoReactions,
    processManagedAutomationMessage,
}
