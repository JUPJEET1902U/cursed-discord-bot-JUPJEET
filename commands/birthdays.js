const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require("discord.js")
const {
    DEFAULT_ANNOUNCEMENT_TEMPLATE,
    DEFAULT_DM_TEMPLATE,
    MONTH_NAMES,
    parseBirthdayInput,
    validateTimezone,
    getDateParts,
    birthdayMatchesDate,
    calculateAge,
    formatBirthday,
    parseMonth,
    nextBirthday,
    getBirthdayConfig,
    updateBirthdayConfig,
    upsertBirthday,
    getBirthday,
    listBirthdays,
    removeBirthday,
} = require("../utils/birthdays")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const cooldowns = new Map()

function isOwner(userId) {
    return String(process.env.BOT_OWNER_IDS || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
        .includes(String(userId || ""))
}

function canManage(message) {
    return isOwner(message.author.id) || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
}

function checkCooldown(message) {
    if (canManage(message)) return true
    const key = `${message.guild.id}:${message.author.id}`
    const now = Date.now()
    const previous = cooldowns.get(key) || 0
    if (now - previous < 3000) return false
    cooldowns.set(key, now)
    return true
}

function tokenize(content) {
    return String(content || "").trim().split(/\s+/).filter(Boolean)
}

function mentionedTarget(message, token) {
    if (!/^<@!?\d{17,20}>$/.test(String(token || ""))) return null
    return message.mentions.members.first() || null
}

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0xA855F7)
        .setTitle("🎂 CURSED Birthdays")
        .setDescription("Birthdays are stored separately for each server. Everyone can add or update their own birthday or another current member's birthday.")
        .addFields(
            { name: "Add or update", value: "`!birthday set 24-07`\n`!birthday set @user 24-07-2006`", inline: false },
            { name: "View and lists", value: "`!birthday view [@user]`\n`!birthday list [month]`\n`!birthday today`\n`!birthday upcoming`", inline: false },
            { name: "Remove", value: "`!birthday remove`\nManagers: `!birthday remove @user`", inline: false },
            { name: "Manager settings", value: "`!birthday channel #birthdays` / `off`\n`!birthday timezone Asia/Kolkata`\n`!birthday dm on|off`\n`!birthday announcements on|off`\n`!birthday message <template>`\n`!birthday dmmessage <template>`\n`!birthday settings`", inline: false },
            { name: "Template variables", value: "`{user}` `{username}` `{server}` `{age}` `{birthday}`", inline: false },
        )
        .setFooter({ text: "Birth years are optional and are not shown in public lists." })
}

function settingsEmbed(config, guild) {
    const channel = config.announcementChannelId ? guild.channels.cache.get(config.announcementChannelId) : null
    return new EmbedBuilder()
        .setColor(config.enabled ? 0x22C55E : 0x6B7280)
        .setTitle("🎂 Birthday Settings")
        .addFields(
            { name: "System", value: config.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Announcements", value: config.announcementEnabled ? "Enabled" : "Disabled", inline: true },
            { name: "Birthday DMs", value: config.dmEnabled ? "Enabled" : "Disabled", inline: true },
            { name: "Announcement channel", value: channel ? `<#${channel.id}>` : "Not configured", inline: true },
            { name: "Timezone", value: `\`${config.timezone}\``, inline: true },
            { name: "Stored per server", value: "Announcements are sent only in this server's configured channel for birthdays recorded in this server.", inline: false },
        )
}

async function sendBirthdayList(message, entries, title) {
    if (!entries.length) {
        await message.reply({ content: `🎂 No birthdays found for **${title}**.`, allowedMentions: SAFE_MENTIONS })
        return
    }
    const chunks = []
    for (let index = 0; index < entries.length; index += 20) chunks.push(entries.slice(index, index + 20))
    for (let index = 0; index < chunks.length; index += 1) {
        const lines = chunks[index].map(entry => `**${formatBirthday(entry)}** — <@${entry.userId}>`)
        const embed = new EmbedBuilder()
            .setColor(0xA855F7)
            .setTitle(`🎂 ${title}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`)
            .setDescription(lines.join("\n"))
            .setFooter({ text: `${entries.length} birthday${entries.length === 1 ? "" : "s"} • Year hidden for privacy` })
        await message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    }
}

async function handleSet(message, args) {
    let target = message.member
    let dateToken = args[0]
    const mentioned = mentionedTarget(message, args[0])
    if (mentioned) {
        target = mentioned
        dateToken = args[1]
    }
    if (!target || !dateToken) {
        await message.reply({ content: "❌ Use `!birthday set 24-07` or `!birthday set @user 24-07-2006`.", allowedMentions: SAFE_MENTIONS })
        return
    }
    const parsed = parseBirthdayInput(dateToken)
    if (!parsed.ok) {
        await message.reply({ content: `❌ ${parsed.error}`, allowedMentions: SAFE_MENTIONS })
        return
    }
    const entry = await upsertBirthday(message.guild.id, target.id, parsed, message.author.id)
    await message.reply({
        content: `🎂 Birthday saved for **${target.displayName}**: **${formatBirthday(entry)}**${entry.year ? " (birth year kept private in public lists)" : ""}.`,
        allowedMentions: SAFE_MENTIONS,
    })
}

async function handleView(message, args) {
    const target = mentionedTarget(message, args[0]) || message.member
    const entry = await getBirthday(message.guild.id, target.id)
    if (!entry) {
        await message.reply({ content: `🎂 No birthday is recorded for **${target.displayName}** in this server.`, allowedMentions: SAFE_MENTIONS })
        return
    }
    const config = await getBirthdayConfig(message.guild.id)
    const localDate = getDateParts(config.timezone)
    const next = nextBirthday(entry, localDate)
    const age = calculateAge(entry, { ...localDate, year: next?.year || localDate.year })
    const details = [
        `**Birthday:** ${formatBirthday(entry)}`,
        `**Next celebration:** ${next?.daysUntil === 0 ? "Today! 🎉" : `in ${next?.daysUntil ?? "?"} day(s)`}`,
    ]
    if (entry.year && target.id === message.author.id) details.push(`**Age on next birthday:** ${age ?? "Unknown"}`)
    const embed = new EmbedBuilder()
        .setColor(0xEC4899)
        .setTitle(`🎂 ${target.displayName}'s Birthday`)
        .setDescription(details.join("\n"))
        .setThumbnail(target.user.displayAvatarURL({ extension: "png", size: 256 }))
        .setFooter({ text: `Recorded only for ${message.guild.name}` })
    await message.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
}

async function handleList(message, args) {
    const month = args[0] ? parseMonth(args[0]) : null
    if (args[0] && !month) {
        await message.reply({ content: "❌ Use a valid month such as `July` or `7`.", allowedMentions: SAFE_MENTIONS })
        return
    }
    const entries = await listBirthdays(message.guild.id, { month })
    await sendBirthdayList(message, entries, month ? `${MONTH_NAMES[month - 1]} Birthdays` : `${message.guild.name} Birthdays`)
}

async function handleToday(message) {
    const config = await getBirthdayConfig(message.guild.id)
    const localDate = getDateParts(config.timezone)
    const entries = (await listBirthdays(message.guild.id)).filter(entry => birthdayMatchesDate(entry, localDate))
    await sendBirthdayList(message, entries, "Today's Birthdays")
}

async function handleUpcoming(message) {
    const config = await getBirthdayConfig(message.guild.id)
    const localDate = getDateParts(config.timezone)
    const upcoming = (await listBirthdays(message.guild.id))
        .map(entry => ({ entry, next: nextBirthday(entry, localDate) }))
        .filter(item => item.next)
        .sort((a, b) => a.next.daysUntil - b.next.daysUntil || a.entry.month - b.entry.month || a.entry.day - b.entry.day)
        .slice(0, 15)
    if (!upcoming.length) {
        await message.reply({ content: "🎂 No upcoming birthdays are recorded in this server.", allowedMentions: SAFE_MENTIONS })
        return
    }
    const lines = upcoming.map(({ entry, next }) => `**${formatBirthday(entry)}** — <@${entry.userId}> • ${next.daysUntil === 0 ? "today" : `in ${next.daysUntil} day(s)`}`)
    const embed = new EmbedBuilder()
        .setColor(0xA855F7)
        .setTitle("🎂 Upcoming Birthdays")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Timezone: ${config.timezone}` })
    await message.reply({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
}

async function handleRemove(message, args) {
    const mentioned = mentionedTarget(message, args[0])
    const target = mentioned || message.member
    if (target.id !== message.author.id && !canManage(message)) {
        await message.reply({ content: "❌ Only that member, a server manager, or the bot owner can remove this birthday.", allowedMentions: SAFE_MENTIONS })
        return
    }
    const removed = await removeBirthday(message.guild.id, target.id)
    await message.reply({
        content: removed ? `🗑️ Removed **${target.displayName}**'s birthday from this server.` : `🎂 No birthday was recorded for **${target.displayName}**.`,
        allowedMentions: SAFE_MENTIONS,
    })
}

async function requireManager(message) {
    if (canManage(message)) return true
    await message.reply({ content: "❌ You need **Manage Server** to change birthday settings.", allowedMentions: SAFE_MENTIONS })
    return false
}

async function handleChannel(message, args) {
    if (!await requireManager(message)) return
    if (!args[0]) {
        const config = await getBirthdayConfig(message.guild.id)
        await message.reply({ content: config.announcementChannelId ? `🎂 Birthday announcements go to <#${config.announcementChannelId}>.` : "🎂 No birthday announcement channel is configured.", allowedMentions: SAFE_MENTIONS })
        return
    }
    if (args[0].toLowerCase() === "off") {
        await updateBirthdayConfig(message.guild.id, { announcementChannelId: null }, message.author.id)
        await message.reply({ content: "✅ Birthday server announcements are no longer assigned to a channel.", allowedMentions: SAFE_MENTIONS })
        return
    }
    const channel = message.mentions.channels.first()
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        await message.reply({ content: "❌ Mention a text or announcement channel, for example `!birthday channel #birthdays`.", allowedMentions: SAFE_MENTIONS })
        return
    }
    await updateBirthdayConfig(message.guild.id, { announcementChannelId: channel.id, announcementEnabled: true }, message.author.id)
    await message.reply({ content: `✅ Birthday announcements for this server will be sent in <#${channel.id}>.`, allowedMentions: SAFE_MENTIONS })
}

async function handleTimezone(message, args) {
    if (!await requireManager(message)) return
    const timezone = args.join(" ").trim()
    if (!timezone) {
        const config = await getBirthdayConfig(message.guild.id)
        await message.reply({ content: `🕒 Birthday timezone: \`${config.timezone}\``, allowedMentions: SAFE_MENTIONS })
        return
    }
    if (!validateTimezone(timezone)) {
        await message.reply({ content: "❌ Invalid IANA timezone. Example: `!birthday timezone Asia/Kolkata`.", allowedMentions: SAFE_MENTIONS })
        return
    }
    await updateBirthdayConfig(message.guild.id, { timezone }, message.author.id)
    await message.reply({ content: `✅ Birthday timezone set to \`${timezone}\`.`, allowedMentions: SAFE_MENTIONS })
}

async function handleToggle(message, field, args, label) {
    if (!await requireManager(message)) return
    const value = String(args[0] || "").toLowerCase()
    if (!["on", "off"].includes(value)) {
        await message.reply({ content: `❌ Use \`!birthday ${field === "dmEnabled" ? "dm" : "announcements"} on\` or \`off\`.`, allowedMentions: SAFE_MENTIONS })
        return
    }
    await updateBirthdayConfig(message.guild.id, { [field]: value === "on" }, message.author.id)
    await message.reply({ content: `✅ ${label} ${value === "on" ? "enabled" : "disabled"}.`, allowedMentions: SAFE_MENTIONS })
}

async function handleTemplate(message, args, dm = false) {
    if (!await requireManager(message)) return
    const template = args.join(" ").trim()
    if (!template) {
        await message.reply({ content: `❌ Add a message after the command. Variables: \`{user}\` \`{username}\` \`{server}\` \`{age}\` \`{birthday}\`.`, allowedMentions: SAFE_MENTIONS })
        return
    }
    await updateBirthdayConfig(message.guild.id, dm ? { dmTemplate: template } : { announcementTemplate: template }, message.author.id)
    await message.reply({ content: `✅ Birthday ${dm ? "DM" : "announcement"} template updated.`, allowedMentions: SAFE_MENTIONS })
}

async function handle(message) {
    if (!message.guild) return false
    const tokens = tokenize(message.content)
    const command = String(tokens.shift() || "").toLowerCase()
    if (!["!birthday", "!birthdays", "!bday"].includes(command)) return false

    if (!checkCooldown(message)) {
        await message.reply({ content: "⏳ Wait a few seconds before using another birthday command.", allowedMentions: SAFE_MENTIONS }).catch(() => {})
        return true
    }

    const subcommand = String(tokens.shift() || "help").toLowerCase()
    try {
        if (subcommand === "set" || subcommand === "add" || subcommand === "update") await handleSet(message, tokens)
        else if (subcommand === "view" || subcommand === "show") await handleView(message, tokens)
        else if (subcommand === "list") await handleList(message, tokens)
        else if (subcommand === "today") await handleToday(message)
        else if (subcommand === "upcoming") await handleUpcoming(message)
        else if (subcommand === "remove" || subcommand === "delete") await handleRemove(message, tokens)
        else if (subcommand === "channel") await handleChannel(message, tokens)
        else if (subcommand === "timezone") await handleTimezone(message, tokens)
        else if (subcommand === "dm") await handleToggle(message, "dmEnabled", tokens, "Birthday DMs")
        else if (subcommand === "announcements" || subcommand === "announcement") await handleToggle(message, "announcementEnabled", tokens, "Birthday announcements")
        else if (subcommand === "message") await handleTemplate(message, tokens, false)
        else if (subcommand === "dmmessage") await handleTemplate(message, tokens, true)
        else if (subcommand === "settings") {
            const config = await getBirthdayConfig(message.guild.id)
            await message.reply({ embeds: [settingsEmbed(config, message.guild)], allowedMentions: SAFE_MENTIONS })
        } else if (subcommand === "resetmessage") {
            if (!await requireManager(message)) return true
            await updateBirthdayConfig(message.guild.id, { announcementTemplate: DEFAULT_ANNOUNCEMENT_TEMPLATE, dmTemplate: DEFAULT_DM_TEMPLATE }, message.author.id)
            await message.reply({ content: "✅ Birthday message templates restored to the CURSED defaults.", allowedMentions: SAFE_MENTIONS })
        } else {
            await message.reply({ embeds: [helpEmbed()], allowedMentions: SAFE_MENTIONS })
        }
    } catch (err) {
        console.error("Birthday command error:", err.message)
        await message.reply({ content: "❌ CURSED could not complete that birthday action. Try again.", allowedMentions: SAFE_MENTIONS }).catch(() => {})
    }
    return true
}

module.exports = { handle, helpEmbed, settingsEmbed }
