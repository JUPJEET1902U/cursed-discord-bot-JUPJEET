const { COMMAND_REGISTRY } = require("./helpGenerator")

const BOT_KNOWLEDGE_TRIGGERS = [
    "command", "commands", "prefix", "how do i", "how to", "set up", "setup", "configure",
    "enable", "disable", "cooldown", "permission", "premium", "what can you do", "help menu",
    "welcome", "ticket", "autorole", "balance", "economy", "pet", "profile", "memory",
    "roast", "imagine", "meme", "moderation", "ban", "kick", "mute", "purge",
]

function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
}

function tokens(value) {
    return normalize(value)
        .toLowerCase()
        .split(/[^a-z0-9!/-]+/)
        .filter(token => token.length > 1)
}

function flattenCommands() {
    const commands = []
    for (const [categoryKey, category] of Object.entries(COMMAND_REGISTRY || {})) {
        for (const command of category.commands || []) {
            commands.push({
                ...command,
                categoryKey,
                categoryName: category.name,
            })
        }
    }
    return commands
}

function needsBotKnowledge(input) {
    const text = normalize(input).toLowerCase()
    if (!text) return false
    if (/[!/][a-z][a-z0-9-]*/i.test(text)) return true
    return BOT_KNOWLEDGE_TRIGGERS.some(trigger => text.includes(trigger))
}

function scoreCommand(command, queryTokens, rawQuery) {
    const name = normalize(command.name).toLowerCase()
    const usage = normalize(command.usage).toLowerCase()
    const description = normalize(command.description).toLowerCase()
    const category = normalize(command.categoryName).toLowerCase()
    const aliases = (command.aliases || []).map(alias => normalize(alias).toLowerCase())
    const haystackTokens = new Set(tokens(`${name} ${usage} ${description} ${category} ${aliases.join(" ")}`))
    let score = 0

    if (rawQuery.includes(name)) score += 10
    if (aliases.some(alias => alias && rawQuery.includes(alias))) score += 8
    for (const token of queryTokens) {
        if (haystackTokens.has(token)) score += 2
        if (name.includes(token)) score += 3
        if (category.includes(token)) score += 1
    }
    return score
}

function buildBotKnowledgeContext(input, options = {}) {
    if (!needsBotKnowledge(input)) return ""

    const allCommands = flattenCommands()
    if (!allCommands.length) return ""

    const rawQuery = normalize(input).toLowerCase()
    const queryTokens = tokens(rawQuery)
    const limit = Math.max(3, Math.min(10, Number(options.limit) || 7))
    const ranked = allCommands
        .map((command, index) => ({ command, index, score: scoreCommand(command, queryTokens, rawQuery) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)

    const positive = ranked.filter(item => item.score > 0)
    const selected = (positive.length ? positive : ranked).slice(0, limit).map(item => item.command)
    const helpCommand = allCommands.find(command => command.name.toLowerCase() === "!help")
    if (helpCommand && !selected.some(command => command.name === helpCommand.name)) selected.push(helpCommand)

    const verifiedNames = [...new Set(allCommands.flatMap(command => [command.name, ...(command.aliases || [])]))]
        .filter(Boolean)
        .join(", ")
    const details = selected.map(command => {
        const aliases = command.aliases?.length ? `; aliases: ${command.aliases.join(", ")}` : ""
        return `- ${command.name} — usage: ${command.usage}; ${command.description}; cooldown: ${command.cooldown || "unknown"}${aliases}`
    })

    return `\n\n[CURSED BOT KNOWLEDGE — verified from the command registry]\nVerified command names: ${verifiedNames}\nRelevant command details:\n${details.join("\n")}\nUse command names and usage exactly as written. Do not invent commands, permissions, premium requirements, or configuration steps that are not present in this block. If the requested feature is not verified here, say that it is not confirmed and suggest the verified help command when available.`
}

module.exports = {
    needsBotKnowledge,
    buildBotKnowledgeContext,
    flattenCommands,
    scoreCommand,
}
