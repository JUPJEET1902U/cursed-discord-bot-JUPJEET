const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require("discord.js")
const moderation = require("./moderation")
const {
    buildEmbed,
    admin: adminEmbed,
    success,
    warning,
    error: errorEmbed,
    statusLine,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const {
    MAX_RESPONDERS,
    MAX_REACTIONS,
    upsertResponderRule,
    removeResponderRule,
    clearResponderRules,
    listResponderRules,
    upsertReactionRule,
    removeReactionRule,
    clearReactionRules,
    listReactionRules,
} = require("../utils/automationStore")
const {
    parseDuration,
    createGiveaway,
    attachGiveawayMessage,
    giveawayEmbed,
    giveawayComponents,
    listGiveaways,
    finishGiveaway,
    rerollGiveaway,
} = require("../utils/giveawayService")
const logger = require("../utils/logger")

const log = logger.child("PowerModules")
const COMMAND_NAMES = new Set(["autoresponder", "autoreact", "giveaway", "embed"])

const autoresponderCommand = new SlashCommandBuilder()
    .setName("autoresponder")
    .setDescription("Manage persistent automatic text responses")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("add").setDescription("Create or update an autoresponder")
        .addStringOption(option => option.setName("trigger").setDescription("Trigger text").setRequired(true).setMaxLength(80))
        .addStringOption(option => option.setName("response").setDescription("Response text").setRequired(true).setMaxLength(1800))
        .addStringOption(option => option.setName("mode").setDescription("How the trigger is matched").addChoices(
            { name: "Exact message", value: "exact" },
            { name: "Contains text", value: "contains" },
        )))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove an autoresponder")
        .addStringOption(option => option.setName("trigger").setDescription("Trigger to remove").setRequired(true).setMaxLength(80)))
    .addSubcommand(sub => sub.setName("list").setDescription("List configured autoresponders"))
    .addSubcommand(sub => sub.setName("clear").setDescription("Remove every autoresponder in this server"))

const autoreactCommand = new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("Manage automatic emoji reactions")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("add").setDescription("Create or update an auto-reaction rule")
        .addStringOption(option => option.setName("trigger").setDescription("Trigger text").setRequired(true).setMaxLength(80))
        .addStringOption(option => option.setName("emojis").setDescription("One to five emojis separated by spaces").setRequired(true).setMaxLength(400))
        .addStringOption(option => option.setName("mode").setDescription("How the trigger is matched").addChoices(
            { name: "Exact message", value: "exact" },
            { name: "Contains text", value: "contains" },
        )))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove an auto-reaction rule")
        .addStringOption(option => option.setName("trigger").setDescription("Trigger to remove").setRequired(true).setMaxLength(80)))
    .addSubcommand(sub => sub.setName("list").setDescription("List configured auto-reaction rules"))
    .addSubcommand(sub => sub.setName("clear").setDescription("Remove every auto-reaction rule in this server"))

const giveawayCommand = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage restart-safe giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("create").setDescription("Start a giveaway")
        .addChannelOption(option => option.setName("channel").setDescription("Giveaway channel").setRequired(true))
        .addStringOption(option => option.setName("duration").setDescription("Duration such as 30m, 2h, or 3d").setRequired(true).setMaxLength(12))
        .addIntegerOption(option => option.setName("winners").setDescription("Number of winners").setRequired(true).setMinValue(1).setMaxValue(20))
        .addStringOption(option => option.setName("prize").setDescription("Giveaway prize").setRequired(true).setMaxLength(256)))
    .addSubcommand(sub => sub.setName("list").setDescription("List recent giveaways"))
    .addSubcommand(sub => sub.setName("end").setDescription("End an active giveaway now")
        .addStringOption(option => option.setName("id").setDescription("Giveaway ID").setRequired(true).setMaxLength(32)))
    .addSubcommand(sub => sub.setName("reroll").setDescription("Reroll winners for an ended giveaway")
        .addStringOption(option => option.setName("id").setDescription("Giveaway ID").setRequired(true).setMaxLength(32)))

const embedCommand = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Create or edit a managed Discord embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub => sub.setName("send").setDescription("Send a custom embed")
        .addChannelOption(option => option.setName("channel").setDescription("Target channel").setRequired(true))
        .addStringOption(option => option.setName("title").setDescription("Embed title").setMaxLength(256))
        .addStringOption(option => option.setName("description").setDescription("Embed description").setRequired(true).setMaxLength(4000))
        .addStringOption(option => option.setName("color").setDescription("Hex color such as #5865F2").setMaxLength(7))
        .addStringOption(option => option.setName("image").setDescription("Image URL").setMaxLength(2048))
        .addStringOption(option => option.setName("thumbnail").setDescription("Thumbnail URL").setMaxLength(2048))
        .addStringOption(option => option.setName("footer").setDescription("Footer text").setMaxLength(1000)))
    .addSubcommand(sub => sub.setName("edit").setDescription("Edit a CURSED-authored embed message")
        .addChannelOption(option => option.setName("channel").setDescription("Channel containing the message").setRequired(true))
        .addStringOption(option => option.setName("message_id").setDescription("Message ID").setRequired(true).setMinLength(17).setMaxLength(20))
        .addStringOption(option => option.setName("title").setDescription("New title").setMaxLength(256))
        .addStringOption(option => option.setName("description").setDescription("New description").setMaxLength(4000))
        .addStringOption(option => option.setName("color").setDescription("Hex color such as #5865F2").setMaxLength(7))
        .addStringOption(option => option.setName("footer").setDescription("New footer").setMaxLength(1000)))

function canManageGuild(memberPermissions) {
    return Boolean(memberPermissions?.has(PermissionFlagsBits.ManageGuild) || memberPermissions?.has(PermissionFlagsBits.Administrator))
}

function parseHexColor(value, fallback = 0x5865F2) {
    if (!value) return fallback
    const text = String(value).trim().replace(/^#/, "")
    if (!/^[0-9a-fA-F]{6}$/.test(text)) throw new Error("Color must be a 6-digit hex value such as #5865F2")
    return Number.parseInt(text, 16)
}

function automationListEmbed(title, rules, type) {
    const limit = type === "response" ? MAX_RESPONDERS : MAX_REACTIONS
    const description = rules.length
        ? rules.slice(0, 20).map((rule, index) => {
            const output = type === "response"
                ? `→ ${String(rule.response).slice(0, 120)}`
                : `→ ${(rule.emojis || []).join(" ")}`
            return `**${index + 1}. ${rule.trigger}** · ${rule.mode}\n${output}`
        }).join("\n\n")
        : "No rules configured."
    return adminEmbed(title, description, {
        fields: [{ name: "Capacity", value: `${rules.length}/${limit}`, inline: true }],
        footer: "CURSED • Automation",
    })
}

function giveawayListEmbed(items) {
    return adminEmbed("Giveaways", items.length
        ? items.map(item => `**${item.giveawayId}** · ${item.ended ? "Ended" : "Active"}\n${item.prize} · ${item.winnerCount} winner${item.winnerCount === 1 ? "" : "s"} · ${item.entrantIds?.length || 0} entries`).join("\n\n")
        : "No giveaways found.", {
        footer: "CURSED • Giveaways",
    })
}

function buildCustomEmbed({ title, description, color, image, thumbnail, footer }) {
    const embed = new EmbedBuilder()
        .setColor(parseHexColor(color))
        .setDescription(String(description || "").slice(0, 4000))
    if (title) embed.setTitle(String(title).slice(0, 256))
    if (image) embed.setImage(String(image))
    if (thumbnail) embed.setThumbnail(String(thumbnail))
    if (footer) embed.setFooter({ text: String(footer).slice(0, 1000) })
    return embed
}

async function interactionReply(interaction, payload, ephemeral = true) {
    const body = { ...payload, ephemeral, allowedMentions: SAFE_MENTIONS }
    if (interaction.deferred) {
        const { ephemeral: _ephemeral, ...edit } = body
        return interaction.editReply(edit)
    }
    if (interaction.replied) return interaction.followUp(body)
    return interaction.reply(body)
}

async function handleAutoresponderInteraction(interaction) {
    if (!canManageGuild(interaction.memberPermissions)) throw new Error("Manage Server is required")
    const sub = interaction.options.getSubcommand()
    if (sub === "add") {
        const rule = await upsertResponderRule(interaction.guildId, {
            trigger: interaction.options.getString("trigger", true),
            response: interaction.options.getString("response", true),
            mode: interaction.options.getString("mode") || "exact",
            createdBy: interaction.user.id,
        })
        await interactionReply(interaction, { embeds: [success(`Autoresponder saved for **${rule.trigger}**.`, { title: "Autoresponder updated" })] })
        return true
    }
    if (sub === "remove") {
        const trigger = interaction.options.getString("trigger", true)
        const removed = await removeResponderRule(interaction.guildId, trigger)
        await interactionReply(interaction, { embeds: [removed ? success(`Removed **${trigger}**.`, { title: "Autoresponder removed" }) : warning(`No autoresponder matched **${trigger}**.`, { title: "Nothing changed" })] })
        return true
    }
    if (sub === "clear") {
        const count = await clearResponderRules(interaction.guildId)
        await interactionReply(interaction, { embeds: [success(`Removed ${count} autoresponder rule${count === 1 ? "" : "s"}.`, { title: "Autoresponders cleared" })] })
        return true
    }
    const rules = await listResponderRules(interaction.guildId)
    await interactionReply(interaction, { embeds: [automationListEmbed("Autoresponders", rules, "response")] })
    return true
}

async function handleAutoreactInteraction(interaction) {
    if (!canManageGuild(interaction.memberPermissions)) throw new Error("Manage Server is required")
    const sub = interaction.options.getSubcommand()
    if (sub === "add") {
        const rule = await upsertReactionRule(interaction.guildId, {
            trigger: interaction.options.getString("trigger", true),
            emojis: interaction.options.getString("emojis", true),
            mode: interaction.options.getString("mode") || "exact",
            createdBy: interaction.user.id,
        })
        await interactionReply(interaction, { embeds: [success(`Auto-reaction saved for **${rule.trigger}**.`, { title: "Auto reaction updated" })] })
        return true
    }
    if (sub === "remove") {
        const trigger = interaction.options.getString("trigger", true)
        const removed = await removeReactionRule(interaction.guildId, trigger)
        await interactionReply(interaction, { embeds: [removed ? success(`Removed **${trigger}**.`, { title: "Auto reaction removed" }) : warning(`No auto-reaction matched **${trigger}**.`, { title: "Nothing changed" })] })
        return true
    }
    if (sub === "clear") {
        const count = await clearReactionRules(interaction.guildId)
        await interactionReply(interaction, { embeds: [success(`Removed ${count} auto-reaction rule${count === 1 ? "" : "s"}.`, { title: "Auto reactions cleared" })] })
        return true
    }
    const rules = await listReactionRules(interaction.guildId)
    await interactionReply(interaction, { embeds: [automationListEmbed("Auto reactions", rules, "reaction")] })
    return true
}

async function handleGiveawayInteraction(interaction) {
    if (!canManageGuild(interaction.memberPermissions)) throw new Error("Manage Server is required")
    const sub = interaction.options.getSubcommand()
    if (sub === "create") {
        const channel = interaction.options.getChannel("channel", true)
        if (!channel.isTextBased?.()) throw new Error("Choose a text channel")
        const botPermissions = channel.permissionsFor?.(interaction.guild.members.me)
        if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
            throw new Error("CURSED needs Send Messages and Embed Links in that channel")
        }
        const durationText = interaction.options.getString("duration", true)
        const durationMs = parseDuration(durationText)
        if (!durationMs) throw new Error("Use a duration such as 30m, 2h, or 3d")
        await interaction.deferReply({ ephemeral: true })
        const created = await createGiveaway({
            guildId: interaction.guildId,
            channelId: channel.id,
            createdBy: interaction.user.id,
            prize: interaction.options.getString("prize", true),
            winnerCount: interaction.options.getInteger("winners", true),
            durationMs,
        })
        const message = await channel.send({ embeds: [giveawayEmbed(created)], components: giveawayComponents(created), allowedMentions: SAFE_MENTIONS })
        const saved = await attachGiveawayMessage(created.giveawayId, message.id)
        await interactionReply(interaction, { embeds: [success(`Giveaway **${saved.giveawayId}** started in ${channel}.`, { title: "Giveaway started" })] })
        return true
    }
    if (sub === "end") {
        await interaction.deferReply({ ephemeral: true })
        const ended = await finishGiveaway(interaction.guildId, interaction.options.getString("id", true), interaction.client)
        await interactionReply(interaction, { embeds: [success(`Giveaway **${ended.giveawayId}** ended.`, { title: "Giveaway ended" })] })
        return true
    }
    if (sub === "reroll") {
        await interaction.deferReply({ ephemeral: true })
        const rerolled = await rerollGiveaway(interaction.guildId, interaction.options.getString("id", true), interaction.client)
        await interactionReply(interaction, { embeds: [success(`Giveaway **${rerolled.giveawayId}** winners rerolled.`, { title: "Giveaway rerolled" })] })
        return true
    }
    const items = await listGiveaways(interaction.guildId, { limit: 15 })
    await interactionReply(interaction, { embeds: [giveawayListEmbed(items)] })
    return true
}

async function handleEmbedInteraction(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) throw new Error("Manage Messages is required")
    const sub = interaction.options.getSubcommand()
    const channel = interaction.options.getChannel("channel", true)
    if (!channel.isTextBased?.()) throw new Error("Choose a text channel")
    const botPermissions = channel.permissionsFor?.(interaction.guild.members.me)
    if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
        throw new Error("CURSED needs Send Messages and Embed Links in that channel")
    }
    if (sub === "send") {
        const embed = buildCustomEmbed({
            title: interaction.options.getString("title"),
            description: interaction.options.getString("description", true),
            color: interaction.options.getString("color"),
            image: interaction.options.getString("image"),
            thumbnail: interaction.options.getString("thumbnail"),
            footer: interaction.options.getString("footer"),
        })
        const sent = await channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        await interactionReply(interaction, { embeds: [success(`Embed sent in ${channel}. Message ID: \`${sent.id}\`.`, { title: "Embed sent" })] })
        return true
    }
    const messageId = interaction.options.getString("message_id", true)
    const message = await channel.messages.fetch(messageId)
    if (message.author.id !== interaction.client.user.id || !message.embeds.length) throw new Error("That message is not a CURSED-authored embed")
    const existing = message.embeds[0]
    const embed = new EmbedBuilder(existing.toJSON())
    const title = interaction.options.getString("title")
    const description = interaction.options.getString("description")
    const color = interaction.options.getString("color")
    const footer = interaction.options.getString("footer")
    if (title !== null) embed.setTitle(title || null)
    if (description !== null) embed.setDescription(description || null)
    if (color !== null) embed.setColor(parseHexColor(color))
    if (footer !== null) embed.setFooter(footer ? { text: footer } : null)
    await message.edit({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
    await interactionReply(interaction, { embeds: [success(`Embed \`${messageId}\` updated.`, { title: "Embed updated" })] })
    return true
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.() || !COMMAND_NAMES.has(interaction.commandName)) return false
    try {
        if (!interaction.inGuild()) throw new Error("Use this command inside a server")
        if (interaction.commandName === "autoresponder") return handleAutoresponderInteraction(interaction)
        if (interaction.commandName === "autoreact") return handleAutoreactInteraction(interaction)
        if (interaction.commandName === "giveaway") return handleGiveawayInteraction(interaction)
        if (interaction.commandName === "embed") return handleEmbedInteraction(interaction)
        return false
    } catch (err) {
        log.warn(`${interaction.commandName} failed: ${err.message}`)
        await interactionReply(interaction, { embeds: [errorEmbed(err.message)] }, true).catch(() => {})
        return true
    }
}

function parsePrefix(content, command) {
    const match = String(content || "").trim().match(new RegExp(`^!${command}(?:\\s+|$)`, "i"))
    if (!match) return null
    return String(content).trim().slice(match[0].length).trim()
}

async function prefixSay(message, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload
    return message.reply({ ...body, allowedMentions: SAFE_MENTIONS }).catch(() => message.channel.send({ ...body, allowedMentions: SAFE_MENTIONS }))
}

async function prefixGuard(message, permission = PermissionFlagsBits.ManageGuild) {
    if (!message.member?.permissions?.has(permission) && !message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        await prefixSay(message, statusLine("error", permission === PermissionFlagsBits.ManageMessages ? "Manage Messages is required." : "Manage Server is required."))
        return false
    }
    return true
}

async function handlePrefixResponder(message, body) {
    if (!await prefixGuard(message)) return true
    const prefix = getGuildPrefix(message.guild.id)
    const [subRaw, ...rest] = body.split(/\s+/)
    const sub = (subRaw || "list").toLowerCase()
    if (sub === "list") {
        const rules = await listResponderRules(message.guild.id)
        await prefixSay(message, { embeds: [automationListEmbed("Autoresponders", rules, "response")] })
        return true
    }
    if (sub === "clear") {
        const count = await clearResponderRules(message.guild.id)
        await prefixSay(message, statusLine("success", `Removed ${count} autoresponder rule${count === 1 ? "" : "s"}.`))
        return true
    }
    if (sub === "remove") {
        const trigger = rest.join(" ").trim()
        if (!trigger) throw new Error(`Usage: ${prefix}autoresponder remove <trigger>`)
        const removed = await removeResponderRule(message.guild.id, trigger)
        await prefixSay(message, removed ? statusLine("success", `Removed autoresponder **${trigger}**.`) : statusLine("warning", "No matching autoresponder found."))
        return true
    }
    if (sub === "add") {
        const source = rest.join(" ")
        const separator = source.indexOf("=>")
        if (separator < 1) throw new Error(`Usage: ${prefix}autoresponder add <trigger> => <response>`)
        const trigger = source.slice(0, separator).trim()
        const response = source.slice(separator + 2).trim()
        const rule = await upsertResponderRule(message.guild.id, { trigger, response, createdBy: message.author.id })
        await prefixSay(message, statusLine("success", `Autoresponder saved for **${rule.trigger}**.`))
        return true
    }
    throw new Error(`Use ${prefix}autoresponder add|remove|list|clear`)
}

async function handlePrefixReact(message, body) {
    if (!await prefixGuard(message)) return true
    const prefix = getGuildPrefix(message.guild.id)
    const [subRaw, ...rest] = body.split(/\s+/)
    const sub = (subRaw || "list").toLowerCase()
    if (sub === "list") {
        const rules = await listReactionRules(message.guild.id)
        await prefixSay(message, { embeds: [automationListEmbed("Auto reactions", rules, "reaction")] })
        return true
    }
    if (sub === "clear") {
        const count = await clearReactionRules(message.guild.id)
        await prefixSay(message, statusLine("success", `Removed ${count} auto-reaction rule${count === 1 ? "" : "s"}.`))
        return true
    }
    if (sub === "remove") {
        const trigger = rest.join(" ").trim()
        if (!trigger) throw new Error(`Usage: ${prefix}autoreact remove <trigger>`)
        const removed = await removeReactionRule(message.guild.id, trigger)
        await prefixSay(message, removed ? statusLine("success", `Removed auto-reaction **${trigger}**.`) : statusLine("warning", "No matching auto-reaction found."))
        return true
    }
    if (sub === "add") {
        const source = rest.join(" ")
        const separator = source.indexOf("=>")
        if (separator < 1) throw new Error(`Usage: ${prefix}autoreact add <trigger> => <emoji ...>`)
        const trigger = source.slice(0, separator).trim()
        const emojis = source.slice(separator + 2).trim()
        const rule = await upsertReactionRule(message.guild.id, { trigger, emojis, createdBy: message.author.id })
        await prefixSay(message, statusLine("success", `Auto-reaction saved for **${rule.trigger}**.`))
        return true
    }
    throw new Error(`Use ${prefix}autoreact add|remove|list|clear`)
}

async function handlePrefixGiveaway(message, body) {
    if (!await prefixGuard(message)) return true
    const prefix = getGuildPrefix(message.guild.id)
    const args = body.split(/\s+/).filter(Boolean)
    const sub = (args.shift() || "list").toLowerCase()
    if (sub === "list") {
        const items = await listGiveaways(message.guild.id, { limit: 15 })
        await prefixSay(message, { embeds: [giveawayListEmbed(items)] })
        return true
    }
    if (sub === "end" || sub === "reroll") {
        const id = args[0]
        if (!id) throw new Error(`Usage: ${prefix}giveaway ${sub} <id>`)
        const updated = sub === "end"
            ? await finishGiveaway(message.guild.id, id, message.client)
            : await rerollGiveaway(message.guild.id, id, message.client)
        await prefixSay(message, statusLine("success", `Giveaway **${updated.giveawayId}** ${sub === "end" ? "ended" : "rerolled"}.`))
        return true
    }
    if (sub === "create") {
        const channel = message.mentions.channels.first()
        const durationText = args.find(value => /^\d+[smhd]$/i.test(value))
        const durationIndex = durationText ? args.indexOf(durationText) : -1
        const winnersText = durationIndex >= 0 ? args[durationIndex + 1] : null
        const winnerCount = Number(winnersText)
        const prizeStart = durationIndex >= 0 ? durationIndex + 2 : -1
        const prize = prizeStart >= 0 ? args.slice(prizeStart).join(" ") : ""
        const durationMs = parseDuration(durationText)
        if (!channel || !durationMs || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20 || !prize) {
            throw new Error(`Usage: ${prefix}giveaway create #channel <30m|2h|3d> <winners> <prize>`)
        }
        const created = await createGiveaway({ guildId: message.guild.id, channelId: channel.id, createdBy: message.author.id, prize, winnerCount, durationMs })
        const sent = await channel.send({ embeds: [giveawayEmbed(created)], components: giveawayComponents(created), allowedMentions: SAFE_MENTIONS })
        await attachGiveawayMessage(created.giveawayId, sent.id)
        await prefixSay(message, statusLine("success", `Giveaway **${created.giveawayId}** started in ${channel}.`))
        return true
    }
    throw new Error(`Use ${prefix}giveaway create|list|end|reroll`)
}

async function handle(message) {
    if (!message.guild) return false
    const commands = ["autoresponder", "autoreact", "giveaway"]
    for (const command of commands) {
        const body = parsePrefix(message.content, command)
        if (body === null) continue
        try {
            if (command === "autoresponder") return handlePrefixResponder(message, body)
            if (command === "autoreact") return handlePrefixReact(message, body)
            if (command === "giveaway") return handlePrefixGiveaway(message, body)
        } catch (error) {
            await prefixSay(message, statusLine("error", error.message))
            return true
        }
    }
    return false
}

for (const command of [autoresponderCommand, autoreactCommand, giveawayCommand, embedCommand]) {
    if (!moderation.commands.some(existing => existing.name === command.name)) moderation.commands.push(command)
}

if (!moderation.__powerModulesPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedPowerModuleInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__powerModulesPatched", { value: true, enumerable: false })
}

module.exports = {
    handle,
    handleInteraction,
    autoresponderCommand,
    autoreactCommand,
    giveawayCommand,
    embedCommand,
    COMMAND_NAMES,
    parseHexColor,
    buildCustomEmbed,
    automationListEmbed,
    giveawayListEmbed,
}
