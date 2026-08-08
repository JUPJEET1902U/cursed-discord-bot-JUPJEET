/**
 * CURSED Help — product-oriented command browser.
 *
 * Reboot keeps the public hierarchy small while letting every deployed module
 * expose a deep command surface. Prefix examples always follow the guild's
 * configured prefix instead of teaching stale hard-coded syntax.
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
} = require("../utils/helpGenerator")
const { COLORS, SAFE_MENTIONS } = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const {
    BRAND,
    cleanCategoryName,
    groupCategories,
    normalizeKey,
} = require("../utils/productSystem")
const { sanitize } = require("../utils/mentionSanitizer")
const logger = require("../utils/logger")

const log = logger.child("Help")
const PAGE_SIZE = 18
const SESSION_MS = 180_000
const OWNER_IDS = (process.env.BOT_OWNER_IDS || "").split(",").map(value => value.trim()).filter(Boolean)

const OWNER_CATEGORY = {
    key: "owner",
    name: "Owner Tools",
    color: COLORS.error,
    adminOnly: true,
    description: "Private diagnostics for the bot owner.",
    commands: [
        { name: "!botstats", usage: "!botstats", description: "View uptime, memory, servers, and cached users.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!aistats", usage: "!aistats", description: "View AI provider configuration and failure status.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!memorydebug", usage: "!memorydebug", description: "Inspect short-term memory and MongoDB status.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
        { name: "!economystats", usage: "!economystats", description: "View global economy, XP, and pet totals.", examples: [], aliases: [], cooldown: "none", permissions: ["Bot Owner or Administrator"] },
    ],
}

function accessFor(message) {
    const owner = OWNER_IDS.includes(message.author.id)
    const permissions = message.member?.permissions
    const admin = owner || Boolean(
        permissions?.has(PermissionFlagsBits.Administrator)
        || permissions?.has(PermissionFlagsBits.ManageGuild)
    )
    return { owner, admin }
}

function prefixFor(message) {
    return message.guild ? getGuildPrefix(message.guild.id) : "c!"
}

function prefixAware(value, message) {
    const prefix = prefixFor(message)
    return String(value || "")
        .replace(/(^|\s)!([a-z][a-z0-9-]*)/gi, (_, lead, command) => `${lead}${prefix}${command}`)
        .replace(/`!([a-z][a-z0-9-]*)/gi, `\`${prefix}$1`)
}

function displayCommandName(command, message) {
    const name = String(command?.name || "")
    return name.startsWith("!") ? `${prefixFor(message)}${name.slice(1)}` : name
}

function decorateCommand(command, message) {
    return {
        ...command,
        displayName: displayCommandName(command, message),
        displayUsage: prefixAware(command.usage || command.name, message),
        displayExamples: (command.examples || []).map(example => prefixAware(example, message)),
    }
}

function normalizeCategory(category) {
    if (!category) return null
    return {
        ...category,
        name: cleanCategoryName(category.name || category.key),
        description: category.description || `${category.commands?.length || 0} available commands.`,
    }
}

function categoriesFor(access) {
    const categories = getCategories(access.admin).map(normalizeCategory).filter(Boolean)
    if (access.owner && !categories.some(category => normalizeKey(category.key) === "owner")) categories.push(OWNER_CATEGORY)
    return categories
}

function categoryFor(key, access) {
    const wanted = normalizeKey(key)
    if (wanted === "owner") return access.owner ? OWNER_CATEGORY : null
    const visible = categoriesFor(access)
    const visibleCategory = visible.find(category => normalizeKey(category.key) === wanted)
    if (!visibleCategory) return null
    return normalizeCategory(getCategory(visibleCategory.key) || visibleCategory)
}

function sectionsFor(access) {
    return groupCategories(categoriesFor(access))
}

function sectionFor(key, access) {
    const wanted = normalizeKey(key)
    return sectionsFor(access).find(section => normalizeKey(section.key) === wanted || normalizeKey(section.name) === wanted) || null
}

function visibleSearch(query, access) {
    const categories = categoriesFor(access)
    const keys = new Set(categories.map(category => normalizeKey(category.key)))
    const results = searchCommands(query)
        .filter(command => keys.has(normalizeKey(command.categoryKey)))
        .map(command => ({ ...command, category: cleanCategoryName(command.category) }))

    if (access.owner) {
        const normalizedQuery = query.toLowerCase().replace(/^[!/]/, "")
        for (const command of OWNER_CATEGORY.commands) {
            if (`${command.name} ${command.description}`.toLowerCase().includes(normalizedQuery)) {
                results.push({ ...command, category: OWNER_CATEGORY.name, categoryKey: OWNER_CATEGORY.key })
            }
        }
    }
    return results
}

function withMeta(category) {
    return category.commands.map(command => ({ ...command, category: category.name, categoryKey: category.key }))
}

function avatar(message) {
    return message.client.user?.displayAvatarURL({ size: 256 }) || null
}

function addThumbnail(embed, message) {
    const icon = avatar(message)
    if (icon) embed.setThumbnail(icon)
    return embed
}

function homeEmbed(message, access) {
    const sections = sectionsFor(access)
    const visibleCount = sections.reduce((sum, section) => sum + section.commandCount, 0)
    const prefix = prefixFor(message)
    const fields = sections.map(section => ({
        name: section.name,
        value: `${section.commandCount} commands\n${section.categories.map(category => category.name).join(" · ")}`.slice(0, 1024),
        inline: false,
    }))

    return addThumbnail(new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("CURSED")
        .setDescription(`${BRAND.tagline}\n\nChoose a section or search for a command. Direct lookup: \`${prefix}help <command>\`.`)
        .addFields(fields)
        .setFooter({ text: `CURSED • ${visibleCount} commands • ${access.owner ? "Owner" : access.admin ? "Server manager" : "Member"} access` })
        .setTimestamp(), message)
}

function sectionEmbed(message, section) {
    return addThumbnail(new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(section.name)
        .setDescription(section.description)
        .addFields(section.categories.map(category => ({
            name: category.name,
            value: `${category.commands.length} commands`,
            inline: true,
        })))
        .setFooter({ text: "CURSED • Select a module" }), message)
}

function commandGrid(commands, message) {
    const names = commands.map(command => `\`${displayCommandName(command, message)}\``)
    const rows = []
    for (let index = 0; index < names.length; index += 3) rows.push(names.slice(index, index + 3).join("  "))
    return rows.join("\n")
}

function categoryEmbed(message, category, page) {
    const totalPages = Math.max(1, Math.ceil(category.commands.length / PAGE_SIZE))
    const safePage = Math.max(0, Math.min(page, totalPages - 1))
    const commands = category.commands.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
    const body = commandGrid(commands, message)

    return addThumbnail(new EmbedBuilder()
        .setColor(category.color || COLORS.primary)
        .setTitle(category.name)
        .setDescription(`${category.description}\n\n${body || "No commands are available in this module."}\n\nSelect a command below for syntax, permissions, and examples.`)
        .setFooter({ text: `CURSED • ${category.commands.length} commands • Page ${safePage + 1}/${totalPages}` }), message)
}

function detailEmbed(message, command) {
    const decorated = decorateCommand(command, message)
    const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(decorated.displayName)
        .setDescription(command.description)
        .addFields({ name: "Syntax", value: `\`${decorated.displayUsage}\``, inline: false })

    if (decorated.displayExamples.length) embed.addFields({ name: "Examples", value: decorated.displayExamples.map(example => `\`${example}\``).join("\n"), inline: false })
    if (command.cooldown && command.cooldown !== "none") embed.addFields({ name: "Cooldown", value: command.cooldown, inline: true })
    if (command.aliases?.length) embed.addFields({ name: "Aliases", value: command.aliases.map(alias => `\`${prefixAware(alias, message)}\``).join(", "), inline: true })
    embed.addFields({ name: "Permissions", value: command.permissions?.length ? command.permissions.join(", ") : "Everyone", inline: true })
    embed.addFields({ name: "Module", value: cleanCategoryName(command.category), inline: true })
    embed.setFooter({ text: BRAND.helpFooter })
    return addThumbnail(embed, message)
}

function resultsEmbed(message, query, results) {
    if (!results.length) {
        return new EmbedBuilder()
            .setColor(COLORS.error)
            .setTitle("No commands found")
            .setDescription(`Nothing matched **${sanitize(query)}**. Try a shorter command name or keyword.`)
            .setFooter({ text: BRAND.helpFooter })
    }

    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`Search • ${sanitize(query)}`)
        .setDescription(results.slice(0, 12).map(command => `\`${displayCommandName(command, message)}\` • ${cleanCategoryName(command.category)}\n${command.description}`).join("\n\n"))
        .setFooter({ text: `CURSED • ${results.length} match${results.length === 1 ? "" : "es"}` })
}

function popularEmbed(message, results) {
    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("Common commands")
        .setDescription(results.map(command => `\`${displayCommandName(command, message)}\` • ${cleanCategoryName(command.category)}\n${command.description}`).join("\n\n"))
        .setFooter({ text: BRAND.helpFooter })
}

function guideEmbed(message) {
    const prefix = prefixFor(message)
    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle("Using CURSED")
        .setDescription(
            `**Browse** — choose a product section, then a module.\n\n` +
            `**Search** — search by command name or purpose.\n\n` +
            `**Direct lookup** — use \`${prefix}help <command>\`, for example \`${prefix}help antinuke\`.\n\n` +
            "Administrative modules appear only when your account has access."
        )
        .setFooter({ text: BRAND.helpFooter })
}

function sectionRow(sections, selected = null) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId("help_section")
        .setPlaceholder("Choose a section")
        .addOptions(sections.map(section => ({
            label: section.name.slice(0, 100),
            description: `${section.commandCount} commands • ${section.description}`.slice(0, 100),
            value: section.key,
            default: section.key === selected,
        }))))
}

function categoryRow(categories, selected = null) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId("help_category")
        .setPlaceholder("Choose a module")
        .addOptions(categories.slice(0, 25).map(category => ({
            label: category.name.slice(0, 100),
            description: `${category.commands.length} commands`.slice(0, 100),
            value: category.key,
            default: category.key === selected,
        }))))
}

function commandRow(commands, id, placeholder, message) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(id)
        .setPlaceholder(placeholder)
        .addOptions(commands.slice(0, 25).map(command => ({
            label: displayCommandName(command, message).slice(0, 100),
            description: command.description.slice(0, 100),
            value: `${command.categoryKey}::${command.name}`.slice(0, 100),
        }))))
}

function closeButton() {
    return new ButtonBuilder().setCustomId("help_close").setLabel("Close").setStyle(ButtonStyle.Danger)
}

function homeButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_search").setLabel("Search").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("help_popular").setLabel("Common commands").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_guide").setLabel("Guide").setStyle(ButtonStyle.Secondary),
        closeButton()
    )
}

function categoryNav(page = 0, totalPages = 1) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_first").setLabel("First").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId("help_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        closeButton(),
        new ButtonBuilder().setCustomId("help_next").setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        new ButtonBuilder().setCustomId("help_last").setLabel("Last").setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
    )
}

function detailNav() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_home").setLabel("Home").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_search").setLabel("Search").setStyle(ButtonStyle.Primary),
        closeButton()
    )
}

function simpleNav() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("help_home").setLabel("Home").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("help_search").setLabel("Search again").setStyle(ButtonStyle.Primary),
        closeButton()
    )
}

function findSelection(value, access) {
    const [key, name] = value.split("::")
    const category = categoryFor(key, access)
    const command = category?.commands.find(item => item.name === name)
    return command ? { ...command, category: category.name, categoryKey: category.key } : null
}

function popularFor(access) {
    const names = ["!help", "/security-status", "!balance", "!daily", "!profile", "!imagine", "!battle", "!quests", "/warn", "/ban"]
    const all = categoriesFor(access).flatMap(withMeta)
    return names.map(name => all.find(command => command.name === name)).filter(Boolean).slice(0, 8)
}

function sectionContainingCategory(categoryKey, access) {
    const wanted = normalizeKey(categoryKey)
    return sectionsFor(access).find(section => section.categories.some(category => normalizeKey(category.key) === wanted)) || null
}

function render(message, access, state) {
    const sections = sectionsFor(access)

    if (state.view === "section") {
        const section = sectionFor(state.sectionKey, access)
        if (!section) return render(message, access, { view: "home" })
        return {
            embeds: [sectionEmbed(message, section)],
            components: [sectionRow(sections, section.key), categoryRow(section.categories), simpleNav()],
        }
    }

    if (state.view === "category") {
        const category = categoryFor(state.categoryKey, access)
        if (!category) return render(message, access, { view: "home" })
        const section = sectionContainingCategory(category.key, access)
        const totalPages = Math.max(1, Math.ceil(category.commands.length / PAGE_SIZE))
        state.page = Math.max(0, Math.min(state.page || 0, totalPages - 1))
        return {
            embeds: [categoryEmbed(message, category, state.page)],
            components: [
                sectionRow(sections, section?.key || null),
                categoryRow(section?.categories || [category], category.key),
                commandRow(withMeta(category), "help_command", "View command details", message),
                categoryNav(state.page, totalPages),
            ],
        }
    }

    if (state.view === "detail" && state.command) return { embeds: [detailEmbed(message, state.command)], components: [detailNav()] }

    if (state.view === "search") {
        return {
            embeds: [resultsEmbed(message, state.query, state.results)],
            components: [
                ...(state.results.length ? [commandRow(state.results, "help_result", "Open a search result", message)] : []),
                simpleNav(),
            ],
        }
    }

    if (state.view === "popular") {
        const results = popularFor(access)
        return {
            embeds: [popularEmbed(message, results)],
            components: [
                ...(results.length ? [commandRow(results, "help_popular_result", "Open a command", message)] : []),
                simpleNav(),
            ],
        }
    }

    if (state.view === "guide") return { embeds: [guideEmbed(message)], components: [simpleNav()] }
    return { embeds: [homeEmbed(message, access)], components: [sectionRow(sections), homeButtons()] }
}

function initialState(args, access) {
    const value = String(args || "").trim()
    if (!value) return { view: "home", page: 0 }

    if (value.toLowerCase().startsWith("search ")) {
        const query = value.slice(7).trim()
        return { view: "search", query, results: visibleSearch(query, access).slice(0, 25), page: 0 }
    }

    const section = sectionFor(value, access)
    if (section) return { view: "section", sectionKey: section.key, page: 0 }

    const category = categoryFor(value, access)
    if (category) return { view: "category", categoryKey: category.key, page: 0 }

    const results = visibleSearch(value, access)
    const target = value.toLowerCase().replace(/^[!/]/, "")
    const exact = results.find(command => command.name.toLowerCase().replace(/^[!/]/, "") === target)
    return exact
        ? { view: "detail", command: exact, categoryKey: exact.categoryKey, page: 0 }
        : { view: "search", query: value, results: results.slice(0, 25), page: 0 }
}

async function searchModal(interaction, sent, message, access, state) {
    const modalId = `help_search_${sent.id}`
    const input = new TextInputBuilder()
        .setCustomId("query")
        .setLabel("Command or keyword")
        .setPlaceholder("antinuke, automod, giveaway, balance...")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true)
    const modal = new ModalBuilder().setCustomId(modalId).setTitle("Search CURSED").addComponents(new ActionRowBuilder().addComponents(input))

    await interaction.showModal(modal)
    const submitted = await interaction.awaitModalSubmit({
        time: 60_000,
        filter: item => item.customId === modalId && item.user.id === message.author.id,
    }).catch(() => null)
    if (!submitted) return

    const query = submitted.fields.getTextInputValue("query").trim()
    Object.assign(state, { view: "search", query, results: visibleSearch(query, access).slice(0, 25), sectionKey: null, categoryKey: null, command: null, page: 0 })
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
        log.error(`Failed to send help: ${err.message}`)
        return true
    }

    const collector = sent.createMessageComponentCollector({ time: SESSION_MS })
    collector.on("collect", async interaction => {
        try {
            if (interaction.user.id !== message.author.id) {
                await interaction.reply({
                    content: `Run \`${prefixFor(message)}help\` to open your own help menu.`,
                    ephemeral: true,
                    allowedMentions: SAFE_MENTIONS,
                }).catch(() => {})
                return
            }

            if (interaction.customId === "help_close") {
                await interaction.deferUpdate().catch(() => {})
                collector.stop("closed")
                await sent.delete().catch(() => sent.edit({ components: [] }).catch(() => {}))
                return
            }

            if (interaction.customId === "help_search") {
                await searchModal(interaction, sent, message, access, state)
                return
            }

            await interaction.deferUpdate()
            const id = interaction.customId

            if (id === "help_home") Object.assign(state, { view: "home", sectionKey: null, categoryKey: null, command: null, page: 0 })
            else if (id === "help_popular") Object.assign(state, { view: "popular", sectionKey: null, categoryKey: null, command: null, page: 0 })
            else if (id === "help_guide") Object.assign(state, { view: "guide", sectionKey: null, categoryKey: null, command: null, page: 0 })
            else if (interaction.isStringSelectMenu() && id === "help_section") Object.assign(state, { view: "section", sectionKey: interaction.values[0], categoryKey: null, command: null, page: 0 })
            else if (interaction.isStringSelectMenu() && id === "help_category") {
                const category = categoryFor(interaction.values[0], access)
                const section = category ? sectionContainingCategory(category.key, access) : null
                if (category) Object.assign(state, { view: "category", sectionKey: section?.key || null, categoryKey: category.key, command: null, page: 0 })
            } else if (interaction.isStringSelectMenu() && ["help_command", "help_result", "help_popular_result"].includes(id)) {
                const command = findSelection(interaction.values[0], access)
                if (command) {
                    const section = sectionContainingCategory(command.categoryKey, access)
                    Object.assign(state, { view: "detail", command, sectionKey: section?.key || null, categoryKey: command.categoryKey, page: 0 })
                }
            } else if (id === "help_first" && state.view === "category") state.page = 0
            else if (id === "help_prev" && state.view === "category") state.page = Math.max(0, state.page - 1)
            else if (id === "help_next" && state.view === "category") state.page += 1
            else if (id === "help_last" && state.view === "category") {
                const category = categoryFor(state.categoryKey, access)
                state.page = Math.max(0, Math.ceil((category?.commands.length || 1) / PAGE_SIZE) - 1)
            } else if (id === "help_back" && state.categoryKey) Object.assign(state, { view: "category", command: null })

            await sent.edit(render(message, access, state))
        } catch (err) {
            log.error(`Help interaction error: ${err.message}`, { stack: err.stack })
        }
    })

    collector.on("end", (_collected, reason) => {
        if (reason !== "closed") sent.edit({ components: [] }).catch(() => {})
    })
    return true
}

module.exports = { handle, prefixAware, displayCommandName, decorateCommand, commandGrid }
