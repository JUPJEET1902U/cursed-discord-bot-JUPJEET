/**
 * commands/help.js
 * Auto-generated, interactive help system for CURSED bot.
 * Supports category browsing, command search, and detailed command info.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js")
const { getCategories, getCategory, searchCommands, getTotalCommandCount } = require("../utils/helpGenerator")
const { COLORS } = require("../utils/responseBuilder")
const { sanitize } = require("../utils/mentionSanitizer")
const logger = require("../utils/logger")
const log = logger.child("Help")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const ITEMS_PER_PAGE = 8
const COLLECTOR_TIMEOUT = 120_000 // 2 minutes

// ── Cursed System Color Palette ────────────────────────────────────────────────
const CURSED_COLORS = {
    crimson:  0xDC143C,  // primary accent — dark crimson
    purple:   0x2C1B47,  // secondary accent — dark purple
    gray:     0x1A1A1A,  // background tone — dark gray
    neon:     0x00FF41,  // highlight — neon green
}

// ── Module label map for category headers ──────────────────────────────────────
const MODULE_LABELS = {
    fun:        "🎉 FUN MODULE",
    economy:    "💰 ECONOMY MODULE",
    gambling:   "🎰 GAMBLING MODULE",
    games:      "🎮 GAMES MODULE",
    pets:       "🐾 PETS MODULE",
    profiles:   "👤 PROFILES MODULE",
    memory:     "🧠 MEMORY MODULE",
    premium:    "💎 PREMIUM MODULE",
    admin:      "⚙️ ADMIN MODULE",
    moderation: "⚔ MODERATION MODULE",
    security:   "🛡 SECURITY MODULE",
}

// ── Embed Builders ─────────────────────────────────────────────────────────────

function buildMainMenu() {
    const categories = getCategories(false)
    const total = getTotalCommandCount()

    const embed = new EmbedBuilder()
        .setColor(CURSED_COLORS.crimson)
        .setTitle("☠ CURSED SYSTEM  ·  HELP TERMINAL")
        .setDescription(
            `\`\`\`ansi\n\u001b[1;31m[ SYSTEM ONLINE ] — CURSED SECURITY ENGINE v2.0\u001b[0m\n\`\`\`` +
            `> **${total} commands** loaded across **${categories.length} modules**\n\n` +
            `Select a module from the menu below, or use:\n` +
            `\`!help [command]\` — detailed command info\n` +
            `\`!help search [query]\` — search all commands`
        )
        .addFields(
            categories.map(cat => ({
                name: `${cat.emoji}  ${cat.name.toUpperCase()}`,
                value: `\`${cat.commands.length}\` commands`,
                inline: true,
            }))
        )
        .setFooter({ text: "☠ CURSED SECURITY ENGINE  ·  Select a module to continue" })
        .setTimestamp()

    return embed
}

function buildCategoryEmbed(categoryKey, page = 0) {
    const cat = getCategory(categoryKey)
    if (!cat) return null

    const commands = cat.commands
    const totalPages = Math.ceil(commands.length / ITEMS_PER_PAGE)
    const pageCommands = commands.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)
    const moduleLabel = MODULE_LABELS[categoryKey] || `${cat.emoji} ${cat.name.toUpperCase()} MODULE`

    const embed = new EmbedBuilder()
        .setColor(cat.color || CURSED_COLORS.crimson)
        .setTitle(moduleLabel)
        .setDescription(
            pageCommands.map(cmd => {
                const aliases = cmd.aliases?.length ? `  *(${cmd.aliases.join(", ")})*` : ""
                const cooldown = cmd.cooldown && cmd.cooldown !== "none" ? `  ·  ⏱ \`${cmd.cooldown}\`` : ""
                const slashNote = cmd.slashOnly ? "  ·  \`/\` slash only" : ""
                return `**\`${cmd.name}\`**${aliases}\n┗ ${cmd.description}${cooldown}${slashNote}`
            }).join("\n\n")
        )
        .setFooter({ text: `☠ CURSED SECURITY ENGINE  ·  Page ${page + 1}/${totalPages}  ·  !help [command] for details` })

    if (cat.adminOnly) {
        embed.addFields({ name: "🔒 RESTRICTED ACCESS", value: "These commands require elevated permissions.", inline: false })
    }

    return embed
}

function buildCommandEmbed(cmd, categoryName) {
    const embed = new EmbedBuilder()
        .setColor(CURSED_COLORS.crimson)
        .setTitle(`⌨  COMMAND REFERENCE  ·  \`${cmd.name}\``)
        .setDescription(`> ${cmd.description}`)
        .addFields(
            { name: "📡  SYNTAX", value: `\`${cmd.usage}\``, inline: false },
        )

    if (cmd.aliases?.length) {
        embed.addFields({ name: "🔀  ALIASES", value: cmd.aliases.map(a => `\`${a}\``).join("  ·  "), inline: true })
    }

    if (cmd.cooldown && cmd.cooldown !== "none") {
        embed.addFields({ name: "⏱  COOLDOWN", value: `\`${cmd.cooldown}\``, inline: true })
    }

    if (cmd.permissions?.length) {
        embed.addFields({ name: "🔒  PERMISSIONS", value: cmd.permissions.join(", "), inline: true })
    }

    if (cmd.examples?.length) {
        embed.addFields({
            name: "💡  EXAMPLES",
            value: cmd.examples.map(e => `\`${e}\``).join("\n"),
            inline: false,
        })
    }

    embed.addFields({ name: "📂  MODULE", value: categoryName, inline: true })
    embed.setFooter({ text: "☠ CURSED SECURITY ENGINE  ·  !help to return to the main menu" })

    return embed
}

function buildSearchEmbed(query, results) {
    if (!results.length) {
        return new EmbedBuilder()
            .setColor(CURSED_COLORS.crimson)
            .setTitle("🔍  SEARCH  ·  NO RESULTS")
            .setDescription(
                `No commands matched \`${sanitize(query)}\`.\n\n` +
                `Try a different search term or use \`!help\` to browse all modules.`
            )
            .setFooter({ text: "☠ CURSED SECURITY ENGINE" })
    }

    const embed = new EmbedBuilder()
        .setColor(CURSED_COLORS.crimson)
        .setTitle(`🔍  SEARCH RESULTS  ·  "${sanitize(query)}"`)
        .setDescription(
            results.slice(0, 10).map(cmd => {
                return `**\`${cmd.name}\`**  ·  *${cmd.category}*\n┗ ${cmd.description}`
            }).join("\n\n")
        )
        .setFooter({ text: `☠ CURSED SECURITY ENGINE  ·  ${results.length} result(s) found  ·  !help [command] for details` })

    return embed
}

// ── Component Builders ─────────────────────────────────────────────────────────

function buildCategorySelect(currentKey = null) {
    const categories = getCategories(false)
    const options = categories.map(cat => ({
        label: `${cat.emoji} ${cat.name}`,
        description: `${cat.commands.length} commands`,
        value: cat.key,
        default: cat.key === currentKey,
    }))

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("help_category")
            .setPlaceholder("⚡ Select a module...")
            .addOptions(options)
    )
}

function buildPaginationRow(categoryKey, page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`help_prev_${categoryKey}_${page}`)
            .setLabel("◀ PREV")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`help_home`)
            .setLabel("☠ MAIN MENU")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`help_next_${categoryKey}_${page}`)
            .setLabel("NEXT ▶")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(page >= totalPages - 1),
    )
}

function buildHomeRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("help_home")
            .setLabel("☠ MAIN MENU")
            .setStyle(ButtonStyle.Secondary),
    )
}

// ── Main Handler ───────────────────────────────────────────────────────────────

async function handle(message) {
    const content = message.content.trim()
    const msgLower = content.toLowerCase()

    if (!msgLower.startsWith("!help")) return false

    const args = content.slice(5).trim()

    // ── !help search [query] ───────────────────────────────────────────────────
    if (args.toLowerCase().startsWith("search ")) {
        const query = args.slice(7).trim()
        if (!query) {
            await message.channel.send({
                content: "🔍 Usage: `!help search [query]`",
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }
        const results = searchCommands(query)
        const embed = buildSearchEmbed(query, results)
        await message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
        return true
    }

    // ── !help [command] ────────────────────────────────────────────────────────
    if (args && !args.toLowerCase().startsWith("premium") && !args.toLowerCase().startsWith("moderation") && !args.toLowerCase().startsWith("admin")) {
        // Search for specific command
        const results = searchCommands(args)
        if (results.length === 1) {
            const cmd = results[0]
            const embed = buildCommandEmbed(cmd, cmd.category)
            await message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
            return true
        }
        if (results.length > 1) {
            const embed = buildSearchEmbed(args, results)
            await message.channel.send({ embeds: [embed], allowedMentions: SAFE_MENTIONS })
            return true
        }
        // No results — fall through to main menu
    }

    // ── !help (main menu) ──────────────────────────────────────────────────────
    const mainEmbed = buildMainMenu()
    const selectRow = buildCategorySelect()

    let sentMsg
    try {
        sentMsg = await message.channel.send({
            embeds: [mainEmbed],
            components: [selectRow],
            allowedMentions: SAFE_MENTIONS,
        })
    } catch (err) {
        log.error(`Failed to send help menu: ${err.message}`)
        return true
    }

    // ── Interaction Collector ──────────────────────────────────────────────────
    const collector = sentMsg.createMessageComponentCollector({
        filter: (i) => i.user.id === message.author.id,
        time: COLLECTOR_TIMEOUT,
    })

    let currentCategory = null
    let currentPage = 0

    collector.on("collect", async (interaction) => {
        try {
            await interaction.deferUpdate()

            const id = interaction.customId

            // Home button
            if (id === "help_home") {
                currentCategory = null
                currentPage = 0
                await sentMsg.edit({
                    embeds: [buildMainMenu()],
                    components: [buildCategorySelect()],
                })
                return
            }

            // Category select menu
            if (interaction.isStringSelectMenu() && id === "help_category") {
                currentCategory = interaction.values[0]
                currentPage = 0
                const cat = getCategory(currentCategory)
                const totalPages = Math.ceil(cat.commands.length / ITEMS_PER_PAGE)
                const embed = buildCategoryEmbed(currentCategory, currentPage)
                const components = [
                    buildCategorySelect(currentCategory),
                    ...(totalPages > 1 ? [buildPaginationRow(currentCategory, currentPage, totalPages)] : [buildHomeRow()]),
                ]
                await sentMsg.edit({ embeds: [embed], components })
                return
            }

            // Pagination buttons
            if (id.startsWith("help_prev_") || id.startsWith("help_next_")) {
                const parts = id.split("_")
                const direction = parts[1] // prev or next
                const catKey = parts[2]
                const page = parseInt(parts[3])
                const cat = getCategory(catKey)
                const totalPages = Math.ceil(cat.commands.length / ITEMS_PER_PAGE)

                currentPage = direction === "next" ? page + 1 : page - 1
                currentPage = Math.max(0, Math.min(currentPage, totalPages - 1))

                const embed = buildCategoryEmbed(catKey, currentPage)
                const components = [
                    buildCategorySelect(catKey),
                    buildPaginationRow(catKey, currentPage, totalPages),
                ]
                await sentMsg.edit({ embeds: [embed], components })
                return
            }
        } catch (err) {
            log.error(`Help interaction error: ${err.message}`)
        }
    })

    collector.on("end", async () => {
        try {
            // Disable all components when collector expires
            const disabledSelect = buildCategorySelect(currentCategory)
            disabledSelect.components[0].setDisabled(true)
            await sentMsg.edit({ components: [disabledSelect] }).catch(() => {})
        } catch { /* ignore */ }
    })

    return true
}

module.exports = { handle }
