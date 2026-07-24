const { getServerConfig, saveConfig } = require("../utils/serverConfig")
const {
    isBotOwnerId,
    getUserPlan,
    getPlanLimits,
    getPaymentSettings,
    updatePaymentSettings,
    grantPremiumUser,
    revokePremiumUser,
    listPremiumUsers,
} = require("../utils/premium")

const PLATFORMS = {
    kofi: { name: "Ko-fi", emoji: "☕" },
    patreon: { name: "Patreon", emoji: "🎨" },
    bmc: { name: "Buy Me a Coffee", emoji: "☕" },
    checkout: { name: "Checkout", emoji: "💳" },
}
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

function isAdmin(member) {
    return member?.permissions.has("Administrator") || member?.permissions.has("ManageGuild")
}

function ownerOnly(message) {
    return isBotOwnerId(message.author.id)
}

async function reply(message, content) {
    return message.channel.send({ content, allowedMentions: SAFE_MENTIONS })
}

function premiumSummary(userId) {
    const plan = getUserPlan(userId)
    const limits = getPlanLimits(userId)
    return {
        plan,
        text: plan === "premium"
            ? `💎 **Your plan: CURSED Premium**\nUnlimited AI messages with **no reply cooldown**, larger memory, **${limits.imageUserDaily} images/day**, **${limits.memeUserDaily} memes/day**, and faster command cooldowns.`
            : `🆓 **Your plan: CURSED Free**\nUnlimited AI messages with a **5-second per-user reply cooldown**, short memory, **${limits.imageUserDaily} images/day**, and **${limits.memeUserDaily} memes/day**.`,
    }
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const userId = message.author.id
    const guildId = message.guild?.id
    if (!guildId) return false

    if (msgLower === "!premium" || msgLower === "!premiumstatus") {
        const summary = premiumSummary(userId)
        const payment = getPaymentSettings()
        let content = `${summary.text}\n\n`
        if (summary.plan === "premium") {
            content += "Your Premium entitlement follows your Discord account across CURSED servers."
        } else if (payment.enabled) {
            content += `**${payment.headline}**\nPrice: **${payment.currency} ${payment.monthlyPrice}/month**\n${payment.instructions}\n`
            if (payment.links.checkout) content += `💳 Checkout: ${payment.links.checkout}\n`
            if (payment.links.kofi) content += `☕ Ko-fi: ${payment.links.kofi}\n`
            if (payment.links.patreon) content += `🎨 Patreon: ${payment.links.patreon}\n`
            if (payment.links.bmc) content += `☕ Buy Me a Coffee: ${payment.links.bmc}\n`
        } else {
            content += "Premium payments are not open yet."
        }
        await reply(message, content)
        return true
    }

    if (msgLower.startsWith("!setpremiumrole")) {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can configure the Premium role.")
            return true
        }
        const role = message.mentions.roles.first()
        if (!role) {
            await reply(message, "Usage: `!setpremiumrole @role`")
            return true
        }
        if (!role.editable) {
            await reply(message, "❌ Move CURSED's bot role above that role before selecting it.")
            return true
        }
        const { data, config } = getServerConfig(guildId)
        config.premiumRoleId = role.id
        saveConfig(data)
        await reply(message, `✅ Premium badge role set to **${role.name}**. Only the bot owner or verified payment flow can assign it.`)
        return true
    }

    if (msgLower.startsWith("!setpayment ")) {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can change payment settings.")
            return true
        }
        const parts = message.content.trim().split(/\s+/)
        const platform = parts[1]?.toLowerCase()
        const url = parts.slice(2).join(" ").trim()
        if (!PLATFORMS[platform] || !url) {
            await reply(message, "Usage: `!setpayment [kofi/patreon/bmc/checkout] [url]`")
            return true
        }
        const current = getPaymentSettings()
        const settings = await updatePaymentSettings({
            enabled: true,
            links: { ...current.links, [platform]: url },
        }, userId)
        if (!settings.links[platform]) {
            await reply(message, "❌ Enter a valid `http://` or `https://` payment URL.")
            return true
        }
        await reply(message, `✅ ${PLATFORMS[platform].emoji} **${PLATFORMS[platform].name}** payment link updated globally.`)
        return true
    }

    if (msgLower === "!paymenton" || msgLower === "!paymentoff") {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can change payment settings.")
            return true
        }
        const enabled = msgLower === "!paymenton"
        await updatePaymentSettings({ enabled }, userId)
        await reply(message, enabled ? "✅ Premium payments are now visible." : "✅ Premium payments are now hidden.")
        return true
    }

    if (msgLower.startsWith("!givepremium")) {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can grant Premium.")
            return true
        }
        const target = message.mentions.users.first()
        if (!target) {
            await reply(message, "Usage: `!givepremium @user [days]`")
            return true
        }
        const pieces = message.content.trim().split(/\s+/)
        const days = pieces[2] ? Number(pieces[2]) : null
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
            await reply(message, "❌ Days must be a whole number from 1 to 3650, or omit it for no expiry.")
            return true
        }
        const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null
        const result = await grantPremiumUser(target.id, {
            client: message.client,
            grantedBy: userId,
            source: "bot-owner-command",
            note: `Granted in ${message.guild.name}`,
            expiresAt,
        })
        const roleWarnings = result.roleResults.filter(item => !item.ok).length
        await reply(message,
            `💎 **${target.username}** now has CURSED Premium${days ? ` for **${days} days**` : " with no expiry"}.` +
            (roleWarnings ? `\n⚠️ ${roleWarnings} server role assignment(s) need permission or hierarchy fixes.` : ""))
        return true
    }

    if (msgLower.startsWith("!revokepremium")) {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can revoke Premium.")
            return true
        }
        const target = message.mentions.users.first()
        if (!target) {
            await reply(message, "Usage: `!revokepremium @user`")
            return true
        }
        await revokePremiumUser(target.id, { client: message.client })
        await reply(message, `✅ CURSED Premium revoked from **${target.username}** and synced roles were removed.`)
        return true
    }

    if (msgLower === "!premiumusers") {
        if (!ownerOnly(message)) {
            await reply(message, "🔒 Only the **CURSED bot owner** can view Premium accounts.")
            return true
        }
        const users = listPremiumUsers()
        const lines = users.slice(0, 100).map((entry, index) =>
            `${index + 1}. \`${entry.userId}\` — ${entry.source}${entry.expiresAt ? ` — expires ${entry.expiresAt.slice(0, 10)}` : ""}`)
        const content = `💎 **Active CURSED Premium accounts: ${users.length}**\n\n${lines.join("\n") || "No paid accounts yet."}`
        const sent = await message.author.send({ content: content.slice(0, 1900), allowedMentions: SAFE_MENTIONS }).then(() => true).catch(() => false)
        await reply(message, sent ? "✅ I sent the Premium account list to your DMs." : "❌ I couldn't DM you. Enable direct messages and try again.")
        return true
    }

    if (msgLower === "!addchannel") {
        if (!isAdmin(message.member)) { await reply(message, "❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        if (!config.allowedChannels) config.allowedChannels = []
        config.channelRestrictionEnabled = true
        if (!config.allowedChannels.includes(message.channel.id)) config.allowedChannels.push(message.channel.id)
        saveConfig(data)
        await reply(message, `✅ **#${message.channel.name}** added to CURSED's allowed channels.`)
        return true
    }

    if (msgLower === "!removechannel") {
        if (!isAdmin(message.member)) { await reply(message, "❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        config.channelRestrictionEnabled = true
        config.allowedChannels = channels.filter(id => id !== message.channel.id)
        saveConfig(data)
        await reply(message, `✅ **#${message.channel.name}** removed from CURSED's allowed channels.`)
        return true
    }

    if (msgLower === "!allchannels") {
        if (!isAdmin(message.member)) { await reply(message, "❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        config.channelRestrictionEnabled = false
        config.allowedChannels = []
        saveConfig(data)
        await reply(message, "✅ Channel restriction disabled. CURSED will respond in **all channels** again.")
        return true
    }

    if (msgLower === "!channels") {
        const { config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        const restricted = config.channelRestrictionEnabled === true || channels.length > 0
        if (!restricted) await reply(message, "📢 CURSED responds in **all channels** on this server.")
        else if (!channels.length) await reply(message, "🔒 CURSED is blocked in all regular channels. Use `!addchannel` in a channel to allow it.")
        else await reply(message, `📢 CURSED active in: ${channels.map(id => `<#${id}>`).join(", ")}`)
        return true
    }

    return false
}

module.exports = { handle }
