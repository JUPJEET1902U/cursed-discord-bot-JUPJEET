const { getServerConfig, saveConfig } = require("../utils/serverConfig")
const { createCode, useCode } = require("../utils/premium")

const PLATFORMS = {
    kofi:    { name: "Ko-fi",            emoji: "☕" },
    patreon: { name: "Patreon",          emoji: "🎨" },
    bmc:     { name: "Buy Me a Coffee",  emoji: "☕" },
}

function isAdmin(member) {
    return member?.permissions.has("Administrator") || member?.permissions.has("ManageGuild")
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = message.member?.displayName || message.author.username
    const userId = message.author.id
    const guildId = message.guild?.id
    if (!guildId) return false

    if (msgLower === "!premium") {
        const { config } = getServerConfig(guildId)
        const links = config.paymentLinks || {}
        const hasLinks = Object.values(links).some(Boolean)
        let msg = `💎 **CURSED PREMIUM**\n\nUnlock **Premium** benefits:\n✨ Custom AI personality (persists forever)\n🛡️ Priority AI responses\n🌟 Exclusive **Premium** server role\n🎁 Bonus daily coins & XP\n\n`
        if (hasLinks) {
            msg += `**Support & get Premium here:**\n`
            if (links.kofi)    msg += `☕ Ko-fi: ${links.kofi}\n`
            if (links.patreon) msg += `🎨 Patreon: ${links.patreon}\n`
            if (links.bmc)     msg += `☕ Buy Me a Coffee: ${links.bmc}\n`
            msg += `\nAfter donating, put your **Discord ID** (\`${userId}\`) in the donation message for auto-grant.\nOr use \`!verify [code]\` if an admin gave you a code.`
        } else {
            msg += `*No payment links set up yet. Ask a server admin to use \`!setpayment\`.*\n\nAdmins can also manually grant Premium with \`!givepremium @user\`.`
        }
        await message.channel.send(msg)
        return true
    }

    if (msgLower.startsWith("!verify ")) {
        const code = message.content.slice(8).trim().toUpperCase()
        const { config } = getServerConfig(guildId)
        if (!config.premiumRoleId) {
            await message.channel.send("❌ No Premium role configured on this server yet. Ask an admin to use `!setpremiumrole @role`.")
            return true
        }
        const result = useCode(code, userId)
        if (!result.ok) {
            const reason = result.reason === "used" ? "That code has already been used." : "Invalid code — double-check it and try again."
            await message.channel.send(`❌ **${senderName}**, ${reason}`)
            return true
        }
        try {
            await message.member.roles.add(config.premiumRoleId)
            await message.channel.send(`💎 **${senderName}** has been granted **Premium**! Welcome to the club. 🎉 Enjoy your perks!`)
        } catch (err) {
            await message.channel.send(`❌ Code accepted but couldn't assign the role — check bot permissions above the Premium role.`)
            console.error("Role assign error:", err.message)
        }
        return true
    }

    if (msgLower.startsWith("!setpremiumrole")) {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const role = message.mentions.roles.first()
        if (!role) { await message.channel.send("Usage: `!setpremiumrole @role`"); return true }
        const { data, config } = getServerConfig(guildId)
        config.premiumRoleId = role.id
        saveConfig(data)
        await message.channel.send(`✅ Premium role set to **${role.name}**! Users who verify will now receive this role.`)
        return true
    }

    if (msgLower.startsWith("!setpayment ")) {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const parts = message.content.split(" ")
        const platform = parts[1]?.toLowerCase()
        const url = parts[2]
        if (!PLATFORMS[platform] || !url) {
            await message.channel.send("Usage: `!setpayment [kofi/patreon/bmc] [url]`\nExample: `!setpayment kofi https://ko-fi.com/yourusername`")
            return true
        }
        const { data, config } = getServerConfig(guildId)
        if (!config.paymentLinks) config.paymentLinks = {}
        config.paymentLinks[platform] = url
        saveConfig(data)
        await message.channel.send(`✅ **${PLATFORMS[platform].name}** ${PLATFORMS[platform].emoji} link set! Users can see it with \`!premium\`.`)
        return true
    }

    if (msgLower === "!gencode") {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const code = createCode(userId)
        try {
            await message.author.send(`🔑 **Generated Premium Code:** \`${code}\`\n\nShare this with the user who paid. It's **one-time use only**.\nThey activate it with \`!verify ${code}\``)
            await message.channel.send("✅ Premium code generated and sent to your DMs! 📬")
        } catch {
            await message.channel.send(`✅ Generated: \`${code}\` *(couldn't DM you — check your DM settings)*`)
        }
        return true
    }

    if (msgLower.startsWith("!givepremium")) {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const target = message.mentions.members.first()
        if (!target) { await message.channel.send("Usage: `!givepremium @user`"); return true }
        const { config } = getServerConfig(guildId)
        if (!config.premiumRoleId) { await message.channel.send("❌ No Premium role configured. Use `!setpremiumrole @role` first."); return true }
        try {
            await target.roles.add(config.premiumRoleId)
            await message.channel.send(`💎 **${target.displayName}** has been granted **Premium** by **${senderName}**! 🌟`)
        } catch (err) {
            await message.channel.send(`❌ Couldn't assign role — make sure the bot's role is above the Premium role in server settings.`)
        }
        return true
    }

    if (msgLower === "!addchannel") {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        if (!config.allowedChannels) config.allowedChannels = []
        config.channelRestrictionEnabled = true
        if (config.allowedChannels.includes(message.channel.id)) {
            saveConfig(data)
            await message.channel.send("✅ This channel is already in CURSED's allowed list.")
            return true
        }
        config.allowedChannels.push(message.channel.id)
        saveConfig(data)
        await message.channel.send(`✅ **#${message.channel.name}** added! CURSED will respond here now.`)
        return true
    }

    if (msgLower === "!removechannel") {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        const restrictionEnabled = typeof config.channelRestrictionEnabled === "boolean"
            ? config.channelRestrictionEnabled
            : channels.length > 0

        if (!restrictionEnabled) {
            await message.channel.send(
                "ℹ️ CURSED currently responds in **all channels**. Use `!addchannel` inside each channel where CURSED should be allowed; that enables restricted mode."
            )
            return true
        }

        const wasAllowed = channels.includes(message.channel.id)
        config.channelRestrictionEnabled = true
        config.allowedChannels = channels.filter(id => id !== message.channel.id)
        saveConfig(data)

        if (!wasAllowed) {
            await message.channel.send(`✅ **#${message.channel.name}** is already blocked for normal CURSED responses.`)
        } else if (config.allowedChannels.length === 0) {
            await message.channel.send(
                `✅ **#${message.channel.name}** removed. CURSED is now blocked in **all regular channels**. Use \`!addchannel\` anywhere to allow a channel again.`
            )
        } else {
            await message.channel.send(`✅ **#${message.channel.name}** removed from CURSED's allowed channels.`)
        }
        return true
    }

    if (msgLower === "!allchannels") {
        if (!isAdmin(message.member)) { await message.channel.send("❌ You need **Administrator** or **Manage Server** permission."); return true }
        const { data, config } = getServerConfig(guildId)
        config.channelRestrictionEnabled = false
        config.allowedChannels = []
        saveConfig(data)
        await message.channel.send("✅ Channel restriction disabled. CURSED will respond in **all channels** again.")
        return true
    }

    if (msgLower === "!channels") {
        const { config } = getServerConfig(guildId)
        const channels = Array.isArray(config.allowedChannels) ? config.allowedChannels : []
        const restrictionEnabled = typeof config.channelRestrictionEnabled === "boolean"
            ? config.channelRestrictionEnabled
            : channels.length > 0

        if (!restrictionEnabled) {
            await message.channel.send("📢 CURSED responds in **all channels** on this server.\nUse `!addchannel` to enable restricted mode.")
        } else if (channels.length === 0) {
            await message.channel.send("🔒 CURSED is blocked in **all regular channels**.\nUse `!addchannel` in a channel to allow it, or `!allchannels` to respond everywhere.")
        } else {
            const names = channels.map(id => `<#${id}>`).join(", ")
            await message.channel.send(`📢 CURSED active in: ${names}\nUse \`!addchannel\` / \`!removechannel\` to manage, or \`!allchannels\` to remove the restriction.`)
        }
        return true
    }

    return false
}

module.exports = { handle }
