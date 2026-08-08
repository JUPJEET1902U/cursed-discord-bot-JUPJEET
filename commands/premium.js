const { getServerConfig, saveConfig } = require("../utils/serverConfig")
const {
    isBotOwnerId,
    isPremiumUser,
    isGuildPremium,
    isServerPremium,
    getServerPremiumAccount,
    getUserPlan,
    getPlanLimits,
    getPaymentSettings,
    updatePaymentSettings,
    grantPremiumUser,
    revokePremiumUser,
    listPremiumUsers,
    grantServerPremium,
    revokeServerPremium,
    listServerPremiumAccounts,
} = require("../utils/premium")
const {
    premium: premiumEmbed,
    admin: adminEmbed,
    statusLine,
    permissionDenied,
    invalidUsage,
    sendEmbed,
    sendSafe,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")

const PLATFORMS = Object.freeze({
    kofi: { name: "Ko-fi" },
    patreon: { name: "Patreon" },
    bmc: { name: "Buy Me a Coffee" },
    checkout: { name: "Checkout" },
})

function isAdmin(member) {
    return member?.permissions.has("Administrator") || member?.permissions.has("ManageGuild")
}

function ownerOnly(message) {
    return isBotOwnerId(message.author.id)
}

function premiumSummary(userId) {
    const plan = getUserPlan(userId)
    const limits = getPlanLimits(userId)
    return {
        plan,
        limits,
        label: plan === "premium" ? "Premium" : "Free",
    }
}

function serverPremiumSummary(guild) {
    const direct = isServerPremium(guild.id) ? getServerPremiumAccount(guild.id) : null
    if (direct) {
        return {
            plan: "Premium",
            source: "Direct server grant",
            expiry: direct.expiresAt ? direct.expiresAt.slice(0, 10) : "No expiry",
        }
    }
    if (isPremiumUser(guild.ownerId)) {
        return { plan: "Premium", source: "Server owner entitlement", expiry: "Account-based" }
    }
    return { plan: "Free", source: "No active server entitlement", expiry: "—" }
}

function paymentFields(payment) {
    const fields = []
    if (!payment.enabled) return fields
    fields.push({ name: "Price", value: `${payment.currency} ${payment.monthlyPrice}/month`, inline: true })
    if (payment.links.checkout) fields.push({ name: "Checkout", value: payment.links.checkout, inline: false })
    if (payment.links.kofi) fields.push({ name: "Ko-fi", value: payment.links.kofi, inline: false })
    if (payment.links.patreon) fields.push({ name: "Patreon", value: payment.links.patreon, inline: false })
    if (payment.links.bmc) fields.push({ name: "Buy Me a Coffee", value: payment.links.bmc, inline: false })
    return fields
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const userId = message.author.id
    const guildId = message.guild?.id
    if (!guildId) return false

    if (msgLower === "!premium" || msgLower === "!premiumstatus") {
        const summary = premiumSummary(userId)
        const payment = getPaymentSettings()
        const fields = [
            { name: "Plan", value: summary.label, inline: true },
            { name: "AI cooldown", value: summary.plan === "premium" ? "None" : "5 seconds", inline: true },
            { name: "Images", value: `${summary.limits.imageUserDaily}/day`, inline: true },
            { name: "Memes", value: `${summary.limits.memeUserDaily}/day`, inline: true },
        ]
        if (summary.plan !== "premium") fields.push(...paymentFields(payment))
        const description = summary.plan === "premium"
            ? "Your Premium entitlement follows your Discord account across CURSED servers."
            : payment.enabled
                ? `${payment.headline}\n${payment.instructions}`
                : "Premium payments are not currently open."
        await sendEmbed(message, premiumEmbed("CURSED Premium", description, { fields }))
        return true
    }

    if (msgLower === "!serverpremium" || msgLower === "!serverpremiumstatus") {
        const summary = serverPremiumSummary(message.guild)
        await sendEmbed(message, premiumEmbed("Server Premium", null, {
            fields: [
                { name: "Plan", value: summary.plan, inline: true },
                { name: "Source", value: summary.source, inline: true },
                { name: "Expiry", value: summary.expiry, inline: true },
            ],
        }))
        return true
    }

    if (msgLower.startsWith("!giveserverpremium")) {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const pieces = message.content.trim().split(/\s+/)
        const days = pieces[1] ? Number(pieces[1]) : null
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
            await sendSafe(message, statusLine("warning", "Days must be a whole number from 1 to 3650, or omit the value for no expiry."))
            return true
        }
        await grantServerPremium(guildId, {
            grantedBy: userId,
            source: "bot-owner-command",
            note: `Granted in ${message.guild.name}`,
            expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
        })
        await sendSafe(message, statusLine("success", `Server Premium granted${days ? ` for **${days} days**` : " with no expiry"}.`))
        return true
    }

    if (msgLower === "!revokeserverpremium") {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        await revokeServerPremium(guildId)
        const stillPremium = isGuildPremium(message.guild)
        await sendSafe(message, statusLine("success", stillPremium
            ? "Direct Server Premium revoked. The server remains Premium through its owner entitlement."
            : "Server Premium revoked."))
        return true
    }

    if (msgLower === "!premiumservers") {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const accounts = listServerPremiumAccounts()
        const lines = accounts.slice(0, 100).map((entry, index) => {
            const guild = message.client.guilds.cache.get(entry.guildId)
            return `${index + 1}. **${guild?.name || "Unknown server"}** \`${entry.guildId}\`${entry.expiresAt ? ` · expires ${entry.expiresAt.slice(0, 10)}` : " · no expiry"}`
        })
        const content = `Direct Server Premium grants: **${accounts.length}**\n\n${lines.join("\n") || "No direct server grants."}`
        const sent = await message.author.send({ content: content.slice(0, 1900), allowedMentions: SAFE_MENTIONS }).then(() => true).catch(() => false)
        await sendSafe(message, sent
            ? statusLine("success", "Server Premium list sent by DM.")
            : statusLine("error", "I could not DM you. Enable direct messages and try again."))
        return true
    }

    if (msgLower.startsWith("!setpremiumrole")) {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const role = message.mentions.roles.first()
        if (!role) {
            await sendSafe(message, invalidUsage("!setpremiumrole @role"))
            return true
        }
        if (!role.editable) {
            await sendSafe(message, statusLine("error", "Move CURSED's role above that role before selecting it."))
            return true
        }
        const { data, config } = getServerConfig(guildId)
        config.premiumRoleId = role.id
        saveConfig(data)
        await sendSafe(message, statusLine("success", `Premium badge role set to **${role.name}**.`))
        return true
    }

    if (msgLower.startsWith("!setpayment ")) {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const parts = message.content.trim().split(/\s+/)
        const platform = parts[1]?.toLowerCase()
        const url = parts.slice(2).join(" ").trim()
        if (!PLATFORMS[platform] || !url) {
            await sendSafe(message, invalidUsage("!setpayment [kofi/patreon/bmc/checkout] [url]"))
            return true
        }
        const current = getPaymentSettings()
        const settings = await updatePaymentSettings({
            enabled: true,
            links: { ...current.links, [platform]: url },
        }, userId)
        if (!settings.links[platform]) {
            await sendSafe(message, statusLine("error", "Enter a valid http:// or https:// payment URL."))
            return true
        }
        await sendSafe(message, statusLine("success", `${PLATFORMS[platform].name} payment link updated.`))
        return true
    }

    if (msgLower === "!paymenton" || msgLower === "!paymentoff") {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const enabled = msgLower === "!paymenton"
        await updatePaymentSettings({ enabled }, userId)
        await sendSafe(message, statusLine("success", enabled ? "Premium payments are visible." : "Premium payments are hidden."))
        return true
    }

    if (msgLower.startsWith("!givepremium")) {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const target = message.mentions.users.first()
        if (!target) {
            await sendSafe(message, invalidUsage("!givepremium @user [days]"))
            return true
        }
        const pieces = message.content.trim().split(/\s+/)
        const days = pieces[2] ? Number(pieces[2]) : null
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
            await sendSafe(message, statusLine("warning", "Days must be a whole number from 1 to 3650, or omit the value for no expiry."))
            return true
        }
        const result = await grantPremiumUser(target.id, {
            client: message.client,
            grantedBy: userId,
            source: "bot-owner-command",
            note: `Granted in ${message.guild.name}`,
            expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
        })
        const roleWarnings = result.roleResults.filter(item => !item.ok).length
        await sendEmbed(message, adminEmbed("Premium granted", null, {
            fields: [
                { name: "User", value: target.username, inline: true },
                { name: "Duration", value: days ? `${days} days` : "No expiry", inline: true },
                { name: "Role sync", value: roleWarnings ? `${roleWarnings} assignment warning(s)` : "Complete", inline: true },
            ],
        }))
        return true
    }

    if (msgLower.startsWith("!revokepremium")) {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const target = message.mentions.users.first()
        if (!target) {
            await sendSafe(message, invalidUsage("!revokepremium @user"))
            return true
        }
        await revokePremiumUser(target.id, { client: message.client })
        await sendSafe(message, statusLine("success", `Premium revoked from **${target.username}** and synced roles removed.`))
        return true
    }

    if (msgLower === "!premiumusers") {
        if (!ownerOnly(message)) {
            await sendSafe(message, permissionDenied("CURSED bot owner"))
            return true
        }
        const users = listPremiumUsers()
        const lines = users.slice(0, 100).map((entry, index) =>
            `${index + 1}. \`${entry.userId}\` · ${entry.source}${entry.expiresAt ? ` · expires ${entry.expiresAt.slice(0, 10)}` : ""}`)
        const content = `Active Premium accounts: **${users.length}**\n\n${lines.join("\n") || "No Premium accounts."}`
        const sent = await message.author.send({ content: content.slice(0, 1900), allowedMentions: SAFE_MENTIONS }).then(() => true).catch(() => false)
        await sendSafe(message, sent
            ? statusLine("success", "Premium account list sent by DM.")
            : statusLine("error", "I could not DM you. Enable direct messages and try again."))
        return true
    }

    if (msgLower === "!addchannel") {
        if (!isAdmin(message.member)) {
            await sendSafe(message, permissionDenied("Administrator or Manage Server"))
            return true
        }
        const { data, config } = getServerConfig(guildId)
        if (!config.allowedChannels) config.allowedChannels = []
        config.channelRestrictionEnabled = true
        if (!config.allowedChannels.includes(message.channel.id)) config.allowedChannels.push(message.channel.id)
        saveConfig(data)
        await sendSafe(message, statusLine("success", `#${message.channel.name} added to allowed channels.`))
        return true
    }

    if (msgLower === "!removechannel") {
        if (!isAdmin(message.member)) {
            await sendSafe(message, permissionDenied("Administrator or Manage Server"))
            return true
        }
        const { data, config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        config.channelRestrictionEnabled = true
        config.allowedChannels = channels.filter(id => id !== message.channel.id)
        saveConfig(data)
        await sendSafe(message, statusLine("success", `#${message.channel.name} removed from allowed channels.`))
        return true
    }

    if (msgLower === "!allchannels") {
        if (!isAdmin(message.member)) {
            await sendSafe(message, permissionDenied("Administrator or Manage Server"))
            return true
        }
        const { data, config } = getServerConfig(guildId)
        config.channelRestrictionEnabled = false
        config.allowedChannels = []
        saveConfig(data)
        await sendSafe(message, statusLine("success", "Channel restriction disabled. CURSED can respond in all channels."))
        return true
    }

    if (msgLower === "!channels") {
        const { config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        const restricted = config.channelRestrictionEnabled === true || channels.length > 0
        if (!restricted) {
            await sendEmbed(message, adminEmbed("Channel access", "CURSED can respond in all channels."))
        } else if (!channels.length) {
            await sendEmbed(message, adminEmbed("Channel access", "CURSED is blocked in regular channels. Use `!addchannel` to allow the current channel."))
        } else {
            await sendEmbed(message, adminEmbed("Channel access", channels.map(id => `<#${id}>`).join(" · ")))
        }
        return true
    }

    return false
}

module.exports = { handle }
