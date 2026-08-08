const { loadEconomy, addCoins } = require("../utils/economy")
const { loadPets } = require("../utils/pets")
const { getStatus: getAIStatus } = require("../utils/ai")
const { getMetrics } = require("../utils/runtimeMetrics")
const logger = require("../utils/logger")
const {
    admin: adminEmbed,
    statusLine,
    permissionDenied,
    invalidUsage,
    sendEmbed,
    sendSafe,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")

const log = logger.child("Admin")
const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || "").split(",").map(value => value.trim()).filter(Boolean)
const START_TIME = Date.now()

function isOwner(message) {
    return BOT_OWNER_IDS.includes(message.author.id)
}

function isAdmin(message) {
    return isOwner(message) || Boolean(message.member?.permissions?.has("Administrator"))
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function safeGuildName(name) {
    return String(name || "Unknown Server")
        .replace(/[\r\n]+/g, " ")
        .replace(/@/g, "＠")
        .replace(/`/g, "ˋ")
        .slice(0, 100)
}

function buildPrivateServerListChunks(guilds, botName = "CURSED") {
    const header = `**${botName} server list**\nTotal servers: **${guilds.length}**\n\n`
    const entries = guilds.map((guild, index) => `${index + 1}. **${safeGuildName(guild.name)}**\nID: \`${guild.id}\``)
    if (!entries.length) return [`${header}No servers are currently cached.`]

    const chunks = []
    let current = header
    for (const entry of entries) {
        const addition = `${entry}\n\n`
        if ((current + addition).length > 1850 && current !== header) {
            chunks.push(current.trimEnd())
            current = `**${botName} server list — continued**\n\n${addition}`
        } else {
            current += addition
        }
    }
    if (current.trim()) chunks.push(current.trimEnd())
    return chunks
}

function metricSummary(prefix) {
    const metrics = getMetrics(prefix).slice(0, 8)
    if (!metrics.length) return "No samples yet."
    return metrics.map(metric => `${metric.name} · p50 ${metric.p50Ms}ms · p95 ${metric.p95Ms}ms · n=${metric.count}`).join("\n")
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const userId = message.author.id
    const isGiveCoinsCommand = msgLower === "!givecoins" || msgLower.startsWith("!givecoins ")
    const isServerListCommand = msgLower === "!botservers" || msgLower === "!servers"

    if (!msgLower.startsWith("!botstats")
        && !msgLower.startsWith("!aistats")
        && !msgLower.startsWith("!memorydebug")
        && !msgLower.startsWith("!economystats")
        && !isGiveCoinsCommand
        && !isServerListCommand) {
        return false
    }

    if (isServerListCommand) {
        if (!isOwner(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }

        const guilds = [...message.client.guilds.cache.values()]
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        const chunks = buildPrivateServerListChunks(guilds)
        try {
            for (const content of chunks) {
                await message.author.send({ content, allowedMentions: SAFE_MENTIONS })
            }
            await sendSafe(message, statusLine("success", "Private server list sent by DM."))
        } catch (error) {
            log.warn(`Could not DM private server list to owner ${userId}: ${error.message}`)
            await sendSafe(message, statusLine("error", "I could not DM you. Enable direct messages and try again."))
        }
        return true
    }

    if (isGiveCoinsCommand) {
        if (!isOwner(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }

        const target = message.mentions.users.first()
        const amountText = message.content.trim().split(/\s+/).at(-1)?.replace(/,/g, "") || ""
        if (!target || !/^\d+$/.test(amountText)) {
            await sendSafe(message, invalidUsage("!givecoins @user [amount]"))
            return true
        }

        let amountBigInt
        try {
            amountBigInt = BigInt(amountText)
        } catch {
            await sendSafe(message, statusLine("error", "Enter a valid positive whole number."))
            return true
        }

        if (amountBigInt <= 0n || amountBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
            await sendSafe(message, statusLine("error", `Amount must be between 1 and ${Number.MAX_SAFE_INTEGER.toLocaleString()}.`))
            return true
        }

        const economy = loadEconomy()
        const currentBalance = economy[target.id]?.coins || 0
        if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) {
            log.error(`Unsafe economy balance detected for user ${target.id}`)
            await sendSafe(message, statusLine("error", "That user's stored balance is invalid. No coins were changed."))
            return true
        }

        const amount = Number(amountBigInt)
        if (amount > Number.MAX_SAFE_INTEGER - currentBalance) {
            await sendSafe(message, statusLine("error", "That amount would exceed the safe balance limit."))
            return true
        }

        const targetName = message.guild?.members?.cache?.get(target.id)?.displayName || target.username
        const newBalance = addCoins(target.id, targetName, amount)
        await sendEmbed(message, adminEmbed("Economy adjustment", null, {
            fields: [
                { name: "User", value: targetName, inline: true },
                { name: "Added", value: `${amount.toLocaleString()} Cursed Coins`, inline: true },
                { name: "New balance", value: `${newBalance.toLocaleString()} coins`, inline: true },
            ],
        }))
        return true
    }

    if (!isAdmin(message)) {
        await sendSafe(message, permissionDenied("Administrator"))
        return true
    }

    if (msgLower === "!botstats") {
        const memory = process.memoryUsage()
        const guildCount = message.client?.guilds?.cache?.size || 0
        const userCount = message.client?.users?.cache?.size || 0
        const economyUsers = Object.keys(loadEconomy()).length
        const fields = [
            { name: "Uptime", value: formatUptime(Date.now() - START_TIME), inline: true },
            { name: "Heap", value: `${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`, inline: true },
            { name: "Servers", value: isOwner(message) ? String(guildCount) : "Restricted", inline: true },
            { name: "Cached users", value: String(userCount), inline: true },
            { name: "Economy users", value: String(economyUsers), inline: true },
            { name: "Runtime", value: `${process.version} · ${process.platform}`, inline: true },
            { name: "Command latency", value: metricSummary("command."), inline: false },
            { name: "Security latency", value: metricSummary("security."), inline: false },
        ]
        await sendEmbed(message, adminEmbed("Runtime status", null, { fields }))
        return true
    }

    if (msgLower === "!aistats") {
        const ai = getAIStatus()
        const stats = ai.providerStats || {}
        const fields = [
            { name: "Gemini", value: ai.geminiConfigured ? "Configured" : "Unavailable", inline: true },
            { name: "Groq", value: ai.groqConfigured ? "Configured" : "Unavailable", inline: true },
            { name: "OpenRouter", value: ai.openRouterConfigured ? "Configured" : "Unavailable", inline: true },
            { name: "Last provider", value: String(ai.lastUsed || "none"), inline: true },
            { name: "Provider order", value: (ai.defaultProviderOrder || []).join(" → ") || "Unknown", inline: false },
            { name: "AI latency", value: metricSummary("ai.provider."), inline: false },
        ]
        for (const [name, provider] of Object.entries(stats).slice(0, 3)) {
            fields.push({
                name: `${name} health`,
                value: `${provider.health || "unknown"} · success ${provider.success || 0} · failures ${provider.failure || 0} · 429 ${provider.rateLimits || 0}`,
                inline: false,
            })
        }
        await sendEmbed(message, adminEmbed("AI provider status", null, { fields }))
        return true
    }

    if (msgLower === "!memorydebug") {
        let memoryFileSize = "Not present"
        try {
            const fs = require("fs")
            memoryFileSize = formatBytes(fs.statSync("./memory.json").size)
        } catch {}

        let databaseStatus = "Unavailable"
        try {
            const mongoose = require("mongoose")
            databaseStatus = mongoose.connection.readyState === 1 ? "Connected" : "Fallback / disconnected"
        } catch {}

        await sendEmbed(message, adminEmbed("Memory status", null, {
            fields: [
                { name: "Legacy memory file", value: memoryFileSize, inline: true },
                { name: "MongoDB", value: databaseStatus, inline: true },
                { name: "Process heap", value: formatBytes(process.memoryUsage().heapUsed), inline: true },
            ],
        }))
        return true
    }

    if (msgLower === "!economystats") {
        const data = loadEconomy()
        const users = Object.values(data)
        const totalCoins = users.reduce((sum, user) => sum + (user.coins || 0), 0)
        const totalXP = users.reduce((sum, user) => sum + (user.xp || 0), 0)
        const averageLevel = users.length > 0
            ? (users.reduce((sum, user) => sum + (user.level || 0), 0) / users.length).toFixed(1)
            : "0"
        const totalPets = Object.keys(loadPets()).length

        await sendEmbed(message, adminEmbed("Economy status", null, {
            fields: [
                { name: "Users", value: String(users.length), inline: true },
                { name: "Coins in circulation", value: totalCoins.toLocaleString(), inline: true },
                { name: "XP earned", value: totalXP.toLocaleString(), inline: true },
                { name: "Average level", value: String(averageLevel), inline: true },
                { name: "Pets", value: String(totalPets), inline: true },
            ],
        }))
        return true
    }

    return false
}

module.exports = { handle, buildPrivateServerListChunks }
