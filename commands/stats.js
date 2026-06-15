/**
 * @fileoverview Statistics commands for CURSED Bot.
 *
 * Commands:
 *   !ping    — Bot latency
 *   !uptime  — Bot uptime
 *   !stats   — Bot statistics (servers, users, memory)
 *   !botinfo — Detailed bot information
 *
 * @category Stats
 */

"use strict"

const { EmbedBuilder } = require("discord.js")
const embed            = require("../utils/embedBuilder")
const logger           = require("../utils/logger")
const { formatUptime, formatDuration } = require("../utils/timeFormatter")
const { getAIStatus }  = require("../utils/aiHelper")
const { BOT, COLORS, EMOJIS } = require("../config/constants")

/** @type {{ name: string, description: string, usage: string, category: string }} */
const metadata = {
    name:        "stats",
    description: "Bot statistics and information commands",
    usage:       "!ping | !uptime | !stats | !botinfo",
    category:    "Stats",
}

/**
 * @param {import("discord.js").Message} message
 * @returns {Promise<boolean>}
 */
async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()

    // ── !ping ──────────────────────────────────────────────────────────────────
    if (msgLower === "!ping") {
        const sent = await message.channel.send("🏓 Pinging...")
        const latency = sent.createdTimestamp - message.createdTimestamp
        const wsLatency = message.client.ws.ping

        const pingEmbed = embed.base(COLORS.INFO)
            .setTitle(`${EMOJIS.PING} Pong!`)
            .addFields(
                { name: "📨 Message Latency", value: `\`${latency}ms\``,   inline: true },
                { name: "💓 WebSocket Ping",  value: `\`${wsLatency}ms\``, inline: true },
            )
            .setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot` })
            .setTimestamp()

        await sent.edit({ content: "", embeds: [pingEmbed] })
        return true
    }

    // ── !uptime ────────────────────────────────────────────────────────────────
    if (msgLower === "!uptime") {
        const uptime = formatUptime()

        const uptimeEmbed = embed.base(COLORS.SUCCESS)
            .setTitle(`${EMOJIS.UPTIME} Bot Uptime`)
            .setDescription(`${EMOJIS.CURSED} **${BOT.NAME}** has been running for:\n\n**${uptime}**`)
            .setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot v${BOT.VERSION}` })
            .setTimestamp()

        await message.channel.send({ embeds: [uptimeEmbed] })
        return true
    }

    // ── !stats ─────────────────────────────────────────────────────────────────
    if (msgLower === "!stats") {
        const client     = message.client
        const guildCount = client.guilds.cache.size
        const userCount  = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)
        const channelCount = client.channels.cache.size
        const uptime     = formatUptime()
        const memUsage   = process.memoryUsage()
        const heapMB     = (memUsage.heapUsed / 1024 / 1024).toFixed(1)
        const rssM       = (memUsage.rss / 1024 / 1024).toFixed(1)
        const ai         = getAIStatus()

        const statsEmbed = embed.stats(`${BOT.NAME} Statistics`)
            .addFields(
                { name: `${EMOJIS.SERVER} Servers`,    value: `\`${guildCount}\``,    inline: true },
                { name: `👥 Users`,                    value: `\`${userCount}\``,     inline: true },
                { name: `💬 Channels`,                 value: `\`${channelCount}\``,  inline: true },
                { name: `${EMOJIS.UPTIME} Uptime`,     value: `\`${uptime}\``,        inline: true },
                { name: `${EMOJIS.MEMORY} Heap`,       value: `\`${heapMB} MB\``,     inline: true },
                { name: `${EMOJIS.MEMORY} RSS`,        value: `\`${rssM} MB\``,       inline: true },
                { name: `🤖 AI: Groq`,                 value: ai.groqConfigured   ? "✅ Online" : "❌ Offline", inline: true },
                { name: `🤖 AI: Gemini`,               value: ai.geminiConfigured ? "✅ Online" : "❌ Offline", inline: true },
                { name: `🔄 Last AI Provider`,         value: `\`${ai.lastUsed}\``,   inline: true },
            )
            .setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot v${BOT.VERSION}` })

        await message.channel.send({ embeds: [statsEmbed] })
        return true
    }

    // ── !botinfo ───────────────────────────────────────────────────────────────
    if (msgLower === "!botinfo") {
        const client   = message.client
        const ai       = getAIStatus()
        const nodeVer  = process.version
        const djsVer   = require("discord.js").version
        const uptime   = formatUptime()
        const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${BOT.INVITE_PERMISSIONS}&scope=bot%20applications.commands`

        const infoEmbed = embed.base(COLORS.PRIMARY)
            .setTitle(`${EMOJIS.BOT} ${BOT.NAME} Bot Information`)
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(
                `${EMOJIS.CURSED} **${BOT.NAME}** is an AI-powered Discord bot with a split personality — ` +
                `genuinely helpful but can't resist roasting you. 😈`
            )
            .addFields(
                { name: "📦 Version",       value: `\`${BOT.VERSION}\``,  inline: true },
                { name: "🟢 Node.js",       value: `\`${nodeVer}\``,      inline: true },
                { name: "📘 Discord.js",    value: `\`v${djsVer}\``,      inline: true },
                { name: `${EMOJIS.UPTIME} Uptime`, value: `\`${uptime}\``, inline: true },
                { name: `${EMOJIS.SERVER} Servers`, value: `\`${client.guilds.cache.size}\``, inline: true },
                { name: "🤖 AI Providers",  value: [
                    ai.groqConfigured   ? "✅ Groq"   : "❌ Groq",
                    ai.geminiConfigured ? "✅ Gemini" : "❌ Gemini",
                ].join(" | "), inline: true },
                { name: "🔗 Invite",        value: `[Click here](${inviteLink})`, inline: false },
            )
            .setFooter({ text: `${EMOJIS.CURSED} ${BOT.NAME} Bot v${BOT.VERSION}` })
            .setTimestamp()

        await message.channel.send({ embeds: [infoEmbed] })
        return true
    }

    return false
}

module.exports = { handle, metadata }
