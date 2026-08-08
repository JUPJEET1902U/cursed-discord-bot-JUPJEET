const { buildEmbed, COLORS } = require("./responseBuilder")

const DASHBOARD_URL = "https://cursed-discord-bot-dashboard.vercel.app/dashboard/security"

function titleCase(value) {
    return String(value || "Unknown")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase())
}

function cleanAction(value) {
    const normalized = String(value || "Unknown").trim()
    if (!normalized) return "Unknown"
    if (normalized === "neutralized") return "Neutralized"
    if (normalized === "quarantine") return "Quarantined"
    if (normalized === "lockdown") return "Lockdown activated"
    if (normalized === "bot banned") return "Banned"
    if (normalized === "bot kicked") return "Kicked"
    if (normalized === "already removed") return "Already removed"
    return titleCase(normalized)
}

function parseBotAddAlert(message) {
    const text = String(message || "")
    if (text.includes("ANTI_NUKE_ADDED_BOT_REMOVAL")) return { suppress: true }
    if (!text.includes("ANTI_NUKE_BOTADDS")) return null

    const server = text.match(/in \*\*(.+?)\*\*\./)?.[1] || "Unknown server"
    const details = text.match(/Unauthorized bot addition:\s*(.+?) added (.+?) \((\d{17,20})\)\./)
    const botAction = text.match(/Added bot response:\s*(.+?)\./)?.[1] || "Unknown"
    const inviterAction = text.match(/Inviter response:\s*(.+?)\./)?.[1] || "Unknown"

    return {
        suppress: false,
        server,
        inviter: details?.[1] || "Unknown",
        bot: details?.[2] || "Unknown bot",
        botId: details?.[3] || null,
        botAction: cleanAction(botAction),
        inviterAction: cleanAction(inviterAction),
    }
}

function buildBotAddEmbed(parsed) {
    const botValue = parsed.botId
        ? `${parsed.bot}\n\`${parsed.botId}\``
        : parsed.bot

    return buildEmbed({
        color: COLORS.security,
        title: "Security alert • Unauthorized bot blocked",
        description: `An unauthorized bot addition was blocked in **${parsed.server}**.`,
        fields: [
            { name: "Bot", value: botValue.slice(0, 1024), inline: true },
            { name: "Added by", value: parsed.inviter.slice(0, 1024), inline: true },
            { name: "Bot response", value: parsed.botAction.slice(0, 1024), inline: true },
            { name: "Inviter response", value: parsed.inviterAction.slice(0, 1024), inline: true },
        ],
        footer: "CURSED • Server Protection",
        timestamp: true,
    })
}

function buildGenericEmbed(guild, message) {
    return buildEmbed({
        color: COLORS.security,
        title: "Security alert",
        description: String(message || "A critical security incident was detected.").slice(0, 4000),
        fields: [{ name: "Server", value: String(guild?.name || "Unknown server").slice(0, 1024) }],
        footer: "CURSED • Server Protection",
        timestamp: true,
    })
}

function buildOwnerNotification(guild, message) {
    if (message && typeof message === "object" && !Array.isArray(message)) {
        return {
            ...message,
            allowedMentions: { parse: [], ...(message.allowedMentions || {}) },
        }
    }
    const parsed = parseBotAddAlert(message)
    if (parsed?.suppress) return null
    const embed = parsed ? buildBotAddEmbed(parsed) : buildGenericEmbed(guild, message)
    return {
        embeds: [embed],
        components: [],
        allowedMentions: { parse: [] },
    }
}

module.exports = {
    DASHBOARD_URL,
    cleanAction,
    parseBotAddAlert,
    buildOwnerNotification,
}
