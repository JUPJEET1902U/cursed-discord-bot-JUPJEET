/**
 * Premium interactive help center for CURSED.
 * Presentation only: no command execution, data stores, or bot systems are changed.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} = require("discord.js")
const {
    getCategories,
    getCategory,
    searchCommands,
    getTotalCommandCount,
} = require("../utils/helpGenerator")
const { sanitize } = require("../utils/mentionSanitizer")
const logger = require("../utils/logger")

const log = logger.child("Help")
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const PAGE_SIZE = 8
const SESSION_MS = 180_000
const OWNER_IDS = (process.env.BOT_OWNER_IDS || "").split(",").map(v => v.trim()).filter(Boolean)
const COLOR = { purple: 0x7C3AED, rose: 0xE11D48, gold: 0xF59E0B, teal: 0x14B8A6 }

const OWNER_CATEGORY = {
    key: "owner",
    name: "Owner Tools",
    emoji: "👑",
    color: COLOR.rose,
    adminOnly: true,
    description: "Private diagnostics for CURSED's owner.",
    commands: [
        { name: "!botstats", usage: "!botstats", description: "View uptime, memory, servers, and cached users.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!aistats", usage: "!aistats", description: "View AI provider configuration and failure status.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!memorydebug", usage: "!memorydebug", description: "Inspect short-term memory and MongoDB status.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!economystats", usage: "!economystats", description: "View global economy, XP, and pet totals.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
    ],
}

function accessFor(message) {
    const owner = OWNER_IDS.includes(message.author.id)
    const perms = message.member?.permissions
    const admin = owner || Boolean(
        perms?.has(PermissionFlagsBits.Administrator) ||
        perms?.has(PermissionFlagsBits.ManageGuild)
    )
    return { owner, admin }
}

function categoriesFor(access) {
    const categories = getCategories(access.admin).map(cat => ({ ...cat, description: cat.description || `${cat.commands.length} available commands.` }))
    if (access.owner && !categories.some(cat => cat.key === OWNER_CATEGORY.key)) categories.push(OWNER_CATEGORY)
    return categories
}

function categoryFor(key, access) {
    if (key === OWNER_CATEGORY.key) return access.owner ? OWNER_CATEGORY : null
    const visible = new Set(categoriesFor(access).map(cat => cat.key))
    return visible.has(key) ? getCategory(key) : null
}

function visibleSearch(query, access) {
    const keys = new Set(categoriesFor(access).map(cat => cat.key))
    const results = searchCommands(query).filter(cmd => keys.has(cmd.categoryKey))
    if (access.owner) {
        const q = query.toLowerCase().replace(/^[!/]/, "")
        for (const cmd of OWNER_CATEGORY.commands) {
            if (`${cmd.name} ${cmd.description}`.toLowerCase().includes(q)) {
                results.push({ ...cmd, category: OWNER_CATEGORY.name, categoryKey: OWNER_CATEGORY.key })
            }
        }
    }
    return results
}

function withMeta(category) {
    return category.commands.map(cmd => ({ ...cmd, category: category.name, categoryKey: category.key }))
}

function avatar(message) {
    return message.client.user?.displayAvatarURL({ size: 256 }) || null
}

function homeEmbed(message, access) {
    const categories = categoriesFor(access)
    const visibleCount = categories.reduce((sum, cat) => sum + cat.commands.length, 0)
    const embed = new EmbedBuilder()
        .setColor(COLOR.purple)
        .setTitle("☠️ CURSED • Help Center")
        .setDescription(
            "**AI • Games • Economy • Utility**\n" +
            "Browse modules, search for a command, or open a popular command below.\n\n" +
            "Use `!help [command]` for a direct lookup, for example `!help battle`."
        )
        .addFields(categories.map(cat => ({
            name: `${cat.emoji} ${cat.name}`,
            value: `**${cat.commands.length} commands**\n${cat.description}`,
            inline: true,
        })))
        .setFooter({ text: `${visibleCount} visible commands • ${access.owner ? "Bot owner" : access.admin ? "Server manager" : "Member"} access • 3-minute session` })
        .setTimestamp()
    const icon = avatar(message)
    if (icon) embed.setThumbnail(icon)
    return embed
}

function categoryEmbed(message, category, page) {
    const totalPages = Math.max(1, Math.ceil(category.commands.length / PAGE_SIZE))
    const safePage = Math.max(0, Math.min(page, totalPages - 1))
    const commands = category.commands.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
    const embed = new EmbedBuilder()
        .setColor(category.color || COLOR.purple)
        .setTitle(`${category.emoji} ${category.name} Module`)
        .setDescription(commands.map(cmd => {
            const tags = [cmd.cooldown && cmd.cooldown !== "none" ? `⏱ ${cmd.cooldown}` : null, cmd.slashOnly ? "Slash" : null].filter(Boolean)
            return `**${cmd.name}**${tags.length ? `  ${tags.map(t => `\`${t}\``).join(" ")}` : ""}\n${cmd.description}`
        }).join("\n\n"))
        .setFooter({ text: `Page ${safePage + 1}/${totalPages} • Select a command below for full details` })
    const icon = avatar(message)
    if (icon) embed.setThumbnail(icon)
    return embed
}

function detailEmbed(message, cmd) {
    const embed = new EmbedBuilder()
        .setColor(COLOR.rose)
        .setTitle(`${cmd.slashOnly ? "⚡" : "⌨️"} ${cmd.name}`)
        .setDescription(cmd.description)
        .addFields({ name: "🧾 Syntax", value: `\`${cmd.usage || cmd.name}\``, inline: false })
    if (cmd.examples?.length) embed.addFields({ name: "✨ Examples", value: cmd.examples.map(x => `\`${x}\``).join("\n"), inline: false })
    if (cmd.cooldown && cmd.cooldown !== "none") embed.addFields({ name: "⏱️ Cooldown", value: cmd.cooldown, inline: true })
    if (cmd.aliases?.length) embed.addFields({ name: "🏷️ Aliases", value: cmd.aliases.map(x => `\`${x}\``).join(", "), inline: true })
    embed.addFields({ name: "🛡️ Permissions", value: cmd.permissions?.length ? cmd.permissions.join(", ") : "Everyone", inline: true })
    embed.addFields({ name: "📦 Module", value: cmd.category, inline: true })
    const icon = avatar(message)
    if (icon) embed.setThumbnail(icon)
    return embed
}

function resultsEmbed(query, results) {
    if (!results.length) return new EmbedBuilder().setColor(COLOR.rose).setTitle("🔎 No commands found").setDescription(`Nothing matched **${sanitize(query)}**. Try a shorter keyword such as \`battle\`, \`pet\`, or \`welcome\`.`)
    return new EmbedBuilder()
        .setColor(COLOR.purple)
        .setTitle(`🔎 Results for “${sanitize(query)}”`)
        .setDescription(results.slice(0, 12).map(cmd => `**${cmd.name}** • *${cmd.category}*\n${cmd.description}`).join("\n\n"))
        .setFooter({ text: `${results.length} match${results.length === 1 ? "" : "es"} • Select one for details` })
}

function popularEmbed(results) {
    return new EmbedBuilder()
        .setColor(COLOR.gold)
        .setTitle("🔥 Popular Commands")
        .setDescription(results.map((cmd, i) => `**${i + 1}. ${cmd.name}** • *${cmd.category}*\n${cmd.description}`).join("\n\n"))
}

function guideEmbed() {
    return new EmbedBuilder()
        .setColor(COLOR.teal)
        .setTitle("🎧 Help Center Guide")
        .setDescription(
            "**Browse:** choose a module, then choose a command.\n\n" +
            "**Search:** press Search or type `!help search [keyword]`.\n\n" +
            "**Direct lookup:** type `!help [command]`, such as `!help battle`.\n\n" +
            "Admin and owner sections are shown only when you have access."
        )
}

function categoryRow(categories, selected = null) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId("help_category")
        .setPlaceholder("Choose a module")
        .addOptions(categories.map(cat => ({
            label: cat.name.slice(0, 100),
            description: `${cat.commands.length} commands • ${cat.description}`.slice(0, 100),
            emoji: cat.emoji,
            value: cat.key,
            default: cat.key === selected,
        }))))
}

function commandRow(commands, id, placeholder) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(id)
        .setPlaceholder(placeholder)
        .addOptions(commands.slice(0, 25).map(cmd => ({
            label: cmd.name.slice(0, 100),
            description: cmd.description.slice(0, 100),
            value: `${cmd.categoryKey}::${cmd.name}`.slice(0, 100),
        }))))
}

function homeButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_browse").setLabel("Browse Modules").setEmoji("📦").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("help_search").setLabel("Search").setEmoji("🔎").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_popular").setLabel("Popular").setEmoji("🔥").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_guide").setLabel("Guide").setEmoji("🎧").setStyle(ButtonStyle.Secondary)
    )
}

function navButtons(page = 0, totalPages = 1, detail = false) {
    const row = new ActionRowBuilder()
    if (detail) row.addComponents(new ButtonBuilder().setCustomId("help_back").setLabel("Module").setEmoji("↩️").setStyle(ButtonStyle.Secondary))
    else row.addComponents(new ButtonBuilder().setCustomId("help_prev").setLabel("Prev").setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0))
    row.addComponents(new ButtonBuilder().setCustomId("help_home").setLabel("Home").setEmoji("🏠").setStyle(ButtonStyle.Secondary))
    if (!detail) row.addComponents(new ButtonBuilder().setCustomId("help_next").setLabel("Next").setEmoji("▶️").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1))
    row.addComponents(new ButtonBuilder().setCustomId("help_search").setLabel("Search").setEmoji("🔎").setStyle(ButtonStyle.Secondary))
    return row
}

function simpleNav() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_home").setLabel("Home").setEmoji("🏠").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_search").setLabel("Search Again").setEmoji("🔎").setStyle(ButtonStyle.Primary)
    )
}

function findSelection(value, access) {
    const [key, name] = value.split("::")
    const category = categoryFor(key, access)
    const cmd = category?.commands.find(x => x.name === name)
    return cmd ? { ...cmd, category: category.name, categoryKey: category.key } : null
}

function popularFor(access) {
    const names = ["!help", "!balance", "!daily", "!profile", "!battle", "!blackjack", "!imagine", "!quests", "!mypet", "/summary"]
    const all = categoriesFor(access).flatMap(withMeta)
    return names.map(name => all.find(cmd => cmd.name === name)).filter(Boolean)
}

function render(message, access, state) {
    const categories = categoriesFor(access)
    if (state.view === "category") {
        const category = categoryFor(state.categoryKey, access)
        if (!category) return render(message, access, { view: "home" })
        const totalPages = Math.max(1, Math.ceil(category.commands.length / PAGE_SIZE))
        state.page = Math.max(0, Math.min(state.page || 0, totalPages - 1))
        return { embeds: [categoryEmbed(message, category, state.page)], components: [categoryRow(categories, category.key), commandRow(withMeta(category), "help_command", "View command details"), navButtons(state.page, totalPages)] }
    }
    if (state.view === "detail" && state.command) return { embeds: [detailEmbed(message, state.command)], components: [navButtons(0, 1, true)] }
    if (state.view === "search") return { embeds: [resultsEmbed(state.query, state.results)], components: [...(state.results.length ? [commandRow(state.results, "help_result", "Open a search result")] : []), simpleNav()] }
    if (state.view === "popular") {
        const results = popularFor(access)
        return { embeds: [popularEmbed(results)], components: [commandRow(results, "help_popular_result", "Open a popular command"), simpleNav()] }
    }
    if (state.view === "guide") return { embeds: [guideEmbed()], components: [simpleNav()] }
    return { embeds: [homeEmbed(message, access)], components: [categoryRow(categories), homeButtons()] }
}

function initialState(args, access) {
    const value = String(args || "").trim()
    if (!value) return { view: "home", page: 0 }
    if (value.toLowerCase().startsWith("search ")) {
        const query = value.slice(7).trim()
        return { view: "search", query, results: visibleSearch(query, access).slice(0, 25), page: 0 }
    }
    const category = categoryFor(value.toLowerCase(), access)
    if (category) return { view: "category", categoryKey: category.key, page: 0 }
    const results = visibleSearch(value, access)
    const target = value.toLowerCase().replace(/^[!/]/, "")
    const exact = results.find(cmd => cmd.name.toLowerCase().replace(/^[!/]/, "") === target)
    return exact ? { view: "detail", command: exact, categoryKey: exact.categoryKey, page: 0 } : { view: "search", query: value, results: results.slice(0, 25), page: 0 }
}

async function searchModal(interaction, sent, message, access, state) {
    const modalId = `help_search_${sent.id}`
    const input = new TextInputBuilder().setCustomId("query").setLabel("Command or keyword").setPlaceholder("battle, pet, economy, welcome...").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)
    const modal = new ModalBuilder().setCustomId(modalId).setTitle("Search CURSED Commands").addComponents(new ActionRowBuilder().addComponents(input))
    await interaction.showModal(modal)
    const submitted = await interaction.awaitModalSubmit({ time: 60_000, filter: i => i.customId === modalId && i.user.id === message.author.id }).catch(() => null)
    if (!submitted) return
    const query = submitted.fields.getTextInputValue("query").trim()
    Object.assign(state, { view: "search", query, results: visibleSearch(query, access).slice(0, 25), categoryKey: null, command: null, page: 0 })
    await submitted.deferUpdate()
    await sent.edit(render(message, access, state))
}

async function handle(message) {
    const content = message.content.trim()
    if (!content.toLowerCase().startsWith("!help")) return false
    const access = accessFor(message)
    const state = initialState(content.slice(5).trim(), access)
    let sent
    try {
        sent = await message.channel.send({ ...render(message, access, state), allowedMentions: SAFE_MENTIONS })
    } catch (err) {
        log.error(`Failed to send help menu: ${err.message}`)
        return true
    }

    const collector = sent.createMessageComponentCollector({ time: SESSION_MS })
    collector.on("collect", async interaction => {
        try {
            if (interaction.user.id !== message.author.id) {
                await interaction.reply({ content: "Run `!help` to open your own Help Center.", ephemeral: true, allowedMentions: SAFE_MENTIONS }).catch(() => {})
                return
            }
            if (interaction.customId === "help_search") {
                await searchModal(interaction, sent, message, access, state)
                return
            }
            await interaction.deferUpdate()
            const id = interaction.customId
            if (id === "help_home" || id === "help_browse") Object.assign(state, { view: "home", categoryKey: null, command: null, page: 0 })
            else if (id === "help_popular") Object.assign(state, { view: "popular", categoryKey: null, command: null, page: 0 })
            else if (id === "help_guide") Object.assign(state, { view: "guide", categoryKey: null, command: null, page: 0 })
            else if (interaction.isStringSelectMenu() && id === "help_category") Object.assign(state, { view: "category", categoryKey: interaction.values[0], command: null, page: 0 })
            else if (interaction.isStringSelectMenu() && ["help_command", "help_result", "help_popular_result"].includes(id)) {
                const cmd = findSelection(interaction.values[0], access)
                if (cmd) Object.assign(state, { view: "detail", command: cmd, categoryKey: cmd.categoryKey, page: 0 })
            } else if (id === "help_prev" && state.view === "category") state.page = Math.max(0, state.page - 1)
            else if (id === "help_next" && state.view === "category") state.page += 1
            else if (id === "help_back" && state.categoryKey) Object.assign(state, { view: "category", command: null })
            await sent.edit(render(message, access, state))
        } catch (err) {
            log.error(`Help interaction error: ${err.message}`, { stack: err.stack })
        }
    })
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}))
    return true
}

module.exports = { handle }
