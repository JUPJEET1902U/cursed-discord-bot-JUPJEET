/**
 * commands/shop.js
 * Interactive CURSED Black Market, inventory, usable items, and cosmetics.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require("discord.js")
const { getUser } = require("../utils/economy")
const {
    CATEGORY_META,
    CATALOG,
    dateKey,
    getItem,
    getCategoryItems,
    getOffer,
    getInventoryView,
    buyItem,
    useItem,
    equipItem,
    unequipItem,
} = require("../utils/shop")
const { sanitizeName } = require("../utils/sanitizer")
const logger = require("../utils/logger")

const log = logger.child("Shop")
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const PAGE_SIZE = 4
const SESSION_MS = 180_000
const SHOP_COLOR = 0x7C3AED

function userName(message) {
    return sanitizeName(message.member?.displayName || message.author.username)
}

function ownedLabel(user, item) {
    if (item.kind === "legacyPermanent") return user[item.key] ? "Owned" : null
    if (item.kind === "cosmetic") return user.cosmetics?.owned?.includes(item.id) ? "Owned" : null
    const quantity = Number(user.inventory?.[item.id] || 0)
    return quantity > 0 ? `Owned ×${quantity}` : null
}

function itemPrice(user, item) {
    const offer = getOffer(user, item)
    if (!offer.available) return { text: "Unavailable", offer }
    const discount = offer.dailyOffer ? ` • ${offer.discount}% OFF` : ""
    return { text: `${offer.price.toLocaleString()} coins${discount}`, offer }
}

function categoryItems(category) {
    return getCategoryItems(category)
}

function detailText(user, item) {
    const price = itemPrice(user, item)
    const status = ownedLabel(user, item)
    const lines = [
        `${item.emoji} **${item.name}**`,
        `*${item.rarity} • ${item.kind === "cosmetic" ? `${item.slot} cosmetic` : item.kind}*`,
        item.description,
        `💰 **Price:** ${price.text}`,
    ]
    if (status) lines.push(`🎒 **Status:** ${status}`)
    if (!price.offer.available) lines.push(`🚫 ${price.offer.reason}`)
    if (item.kind === "consumable") lines.push(`Use after purchase with \`!use ${item.id}\`.`)
    if (item.kind === "cosmetic") lines.push(`Equip after purchase with \`!equip ${item.id}\`.`)
    return lines.join("\n")
}

function shopEmbed(message, state) {
    const name = userName(message)
    const { user } = getUser(message.author.id, name)
    const meta = CATEGORY_META[state.category] || CATEGORY_META.featured
    const items = categoryItems(state.category)
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    state.page = Math.max(0, Math.min(state.page || 0, totalPages - 1))
    const pageItems = items.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)
    if (!pageItems.some(item => item.id === state.selectedId)) state.selectedId = pageItems[0]?.id || null
    const selected = pageItems.find(item => item.id === state.selectedId) || pageItems[0] || null

    const embed = new EmbedBuilder()
        .setColor(selected?.color || SHOP_COLOR)
        .setTitle("☠️ CURSED • Black Market")
        .setDescription(
            `**${meta.emoji} ${meta.name}**\n${meta.description}\n\n` +
            `🪙 **Balance:** ${(user.coins || 0).toLocaleString()} coins\n` +
            `🗓️ **Rotation:** ${dateKey()} UTC`
        )
        .setFooter({ text: `Page ${state.page + 1}/${totalPages} • Daily offers refresh at 00:00 UTC • Session lasts 3 minutes` })
        .setTimestamp()

    for (const item of pageItems) {
        const price = itemPrice(user, item)
        const selectedMark = item.id === state.selectedId ? "▸ " : ""
        const status = ownedLabel(user, item)
        embed.addFields({
            name: `${selectedMark}${item.emoji} ${item.name} • ${item.rarity}`,
            value: `${item.description}\n💰 **${price.text}**${status ? ` • 🎒 ${status}` : ""}\nID: \`${item.id}\``,
            inline: false,
        })
    }

    if (selected) {
        embed.addFields({
            name: "🛒 Selected Item",
            value: detailText(user, selected),
            inline: false,
        })
    }

    const icon = message.client.user?.displayAvatarURL({ size: 256 })
    if (icon) embed.setThumbnail(icon)
    return { embed, items: pageItems, totalPages }
}

function inventoryEmbed(message) {
    const name = userName(message)
    const { user } = getUser(message.author.id, name)
    const view = getInventoryView(user)
    const consumables = view.consumables.length
        ? view.consumables.map(({ item, quantity }) => `${item.emoji} **${item.name}** ×${quantity} — \`!use ${item.id}\``).join("\n")
        : "No consumables yet."
    const cosmetics = view.cosmetics.length
        ? view.cosmetics.map(item => `${item.emoji} **${item.name}** — ${item.slot}`).join("\n")
        : "No cosmetics yet."
    const equipped = [
        view.equipped.title ? `🏷️ Title: **${view.equipped.title.display}**` : "🏷️ Title: None",
        view.equipped.theme ? `🎨 Theme: **${view.equipped.theme.display}**` : "🎨 Theme: None",
        view.equipped.badge ? `🎖️ Badge: **${view.equipped.badge.display}**` : "🎖️ Badge: None",
    ].join("\n")
    const active = [
        (user.roastShield || 0) > 0 ? `🛡️ Roast Shield: **${user.roastShield} uses**` : null,
        (user.xpBoost || 0) > 0 ? `💥 XP Booster: **${user.xpBoost} uses**` : null,
        (user.dailyBoost || 0) > 0 ? `🎲 Daily Booster: **${user.dailyBoost} ready**` : null,
    ].filter(Boolean).join("\n") || "No active boosts."

    return new EmbedBuilder()
        .setColor(view.equipped.theme?.color || SHOP_COLOR)
        .setTitle(`🎒 ${name}'s Black Market Inventory`)
        .setDescription(`🪙 **Balance:** ${(user.coins || 0).toLocaleString()} coins`)
        .addFields(
            { name: "⚡ Active Boosts", value: active, inline: false },
            { name: "🧰 Consumables", value: consumables, inline: false },
            { name: "🎨 Cosmetics Owned", value: cosmetics, inline: false },
            { name: "✨ Equipped", value: equipped, inline: false },
        )
        .setFooter({ text: "Use !shop to buy • !shop help for commands • !use item • !equip item • !unequip slot" })
}

function guideEmbed() {
    return new EmbedBuilder()
        .setColor(SHOP_COLOR)
        .setTitle("📖 CURSED Black Market Commands")
        .setDescription(
            "`!shop` — Open the interactive Black Market\n" +
            "`!shop [category or item]` — Open a specific section or item\n" +
            "`!blackmarket` — Open today's rotating deals\n" +
            "`!buy [item] [quantity]` — Buy directly by item ID\n" +
            "`!inventory` / `!inv` — View boosts, items, and cosmetics\n" +
            "`!use [item]` — Use a consumable\n" +
            "`!equip [cosmetic]` — Equip an owned cosmetic\n" +
            "`!unequip [title|theme|badge|all]` — Remove equipped cosmetics\n\n" +
            "**Categories:** `featured`, `boosts`, `utility`, `pets`, `cosmetics`, `permanent`"
        )
        .setFooter({ text: "Item IDs are shown inside !shop and !inventory." })
}

function categoryRow(selected) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("shop_category")
            .setPlaceholder("Choose a Black Market category")
            .addOptions(Object.entries(CATEGORY_META).map(([key, meta]) => ({
                label: meta.name,
                description: meta.description.slice(0, 100),
                emoji: meta.emoji,
                value: key,
                default: key === selected,
            })))
    )
}

function itemRow(items, selectedId) {
    if (!items.length) return null
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("shop_item")
            .setPlaceholder("Select an item for details")
            .addOptions(items.map(item => ({
                label: item.name.slice(0, 100),
                description: `${item.rarity} • ${item.price.toLocaleString()} base coins`.slice(0, 100),
                emoji: item.emoji,
                value: item.id,
                default: item.id === selectedId,
            })))
    )
}

function navRow(state, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("shop_prev")
            .setLabel("Prev")
            .setEmoji("◀️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.page <= 0),
        new ButtonBuilder()
            .setCustomId("shop_buy")
            .setLabel("Buy Selected")
            .setEmoji("🛒")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!state.selectedId),
        new ButtonBuilder()
            .setCustomId("shop_inventory")
            .setLabel("Inventory")
            .setEmoji("🎒")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("shop_next")
            .setLabel("Next")
            .setEmoji("▶️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.page >= totalPages - 1),
    )
}

function render(message, state) {
    const { embed, items, totalPages } = shopEmbed(message, state)
    const rows = [categoryRow(state.category)]
    const itemsRow = itemRow(items, state.selectedId)
    if (itemsRow) rows.push(itemsRow)
    rows.push(navRow(state, totalPages))
    return { embeds: [embed], components: rows, allowedMentions: SAFE_MENTIONS }
}

function parseItemAndQuantity(text) {
    const parts = String(text || "").trim().split(/\s+/).filter(Boolean)
    let quantity = 1
    if (parts.length > 1 && /^\d+$/.test(parts.at(-1))) quantity = Number(parts.pop())
    return { item: parts.join(" "), quantity }
}

function simpleResult(message, result) {
    return message.channel.send({ content: result.message, allowedMentions: SAFE_MENTIONS })
}

async function openShop(message, requested = "") {
    const normalized = String(requested || "").trim().toLowerCase()
    let category = Object.prototype.hasOwnProperty.call(CATEGORY_META, normalized) ? normalized : "featured"
    let selectedId = null
    const requestedItem = getItem(normalized)
    if (requestedItem) {
        const featuredIds = new Set(getCategoryItems("featured").map(item => item.id))
        category = requestedItem.rotatingOnly || featuredIds.has(requestedItem.id) ? "featured" : requestedItem.category
        selectedId = requestedItem.id
    }

    const state = { category, page: 0, selectedId }
    let sent
    try {
        sent = await message.channel.send(render(message, state))
    } catch (err) {
        log.error(`Failed to send Black Market: ${err.message}`)
        await message.channel.send({ content: "❌ The Black Market could not open. Try again.", allowedMentions: SAFE_MENTIONS }).catch(() => {})
        return
    }

    const collector = sent.createMessageComponentCollector({ time: SESSION_MS })
    collector.on("collect", async interaction => {
        try {
            if (interaction.user.id !== message.author.id) {
                await interaction.reply({ content: "Run `!shop` to open your own Black Market.", ephemeral: true, allowedMentions: SAFE_MENTIONS }).catch(() => {})
                return
            }

            const id = interaction.customId
            if (interaction.isStringSelectMenu() && id === "shop_category") {
                await interaction.deferUpdate()
                state.category = interaction.values[0]
                state.page = 0
                state.selectedId = null
                await sent.edit(render(message, state))
                return
            }
            if (interaction.isStringSelectMenu() && id === "shop_item") {
                await interaction.deferUpdate()
                state.selectedId = interaction.values[0]
                await sent.edit(render(message, state))
                return
            }
            if (id === "shop_inventory") {
                await interaction.reply({ embeds: [inventoryEmbed(message)], ephemeral: true, allowedMentions: SAFE_MENTIONS })
                return
            }
            if (id === "shop_buy") {
                const result = buyItem(message.author.id, userName(message), state.selectedId, 1)
                await interaction.reply({ content: result.message, ephemeral: true, allowedMentions: SAFE_MENTIONS })
                await sent.edit(render(message, state)).catch(() => {})
                return
            }

            await interaction.deferUpdate()
            if (id === "shop_prev") state.page = Math.max(0, state.page - 1)
            if (id === "shop_next") state.page += 1
            state.selectedId = null
            await sent.edit(render(message, state))
        } catch (err) {
            log.error(`Black Market interaction failed: ${err.message}`, { stack: err.stack })
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "❌ That Black Market action failed.", ephemeral: true, allowedMentions: SAFE_MENTIONS }).catch(() => {})
            }
        }
    })
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}))
}

async function handle(message) {
    const content = message.content.trim()
    const msgLower = content.toLowerCase()
    const name = userName(message)
    const userId = message.author.id

    const isShop = msgLower === "!shop" || msgLower.startsWith("!shop ")
    const isBlackMarket = msgLower === "!blackmarket" || msgLower.startsWith("!blackmarket ")
    const isBuy = msgLower === "!buy" || msgLower.startsWith("!buy ")
    const isInventory = msgLower === "!inventory" || msgLower === "!inv"
    const isUse = msgLower === "!use" || msgLower.startsWith("!use ")
    const isEquip = msgLower === "!equip" || msgLower.startsWith("!equip ")
    const isUnequip = msgLower === "!unequip" || msgLower.startsWith("!unequip ")

    if (!isShop && !isBlackMarket && !isBuy && !isInventory && !isUse && !isEquip && !isUnequip) return false

    if (isInventory) {
        await message.channel.send({ embeds: [inventoryEmbed(message)], allowedMentions: SAFE_MENTIONS })
        return true
    }

    if (isBuy) {
        const args = content.slice(4).trim()
        if (!args) {
            await message.channel.send({ content: "Usage: `!buy [item] [quantity]`\nExample: `!buy petfood 2`", allowedMentions: SAFE_MENTIONS })
            return true
        }
        const parsed = parseItemAndQuantity(args)
        await simpleResult(message, buyItem(userId, name, parsed.item, parsed.quantity))
        return true
    }

    if (isUse) {
        const item = content.slice(4).trim()
        if (!item) {
            await message.channel.send({ content: "Usage: `!use [item]`\nExample: `!use questreroll`", allowedMentions: SAFE_MENTIONS })
            return true
        }
        await simpleResult(message, useItem(userId, name, item))
        return true
    }

    if (isEquip) {
        const item = content.slice(6).trim()
        if (!item) {
            await message.channel.send({ content: "Usage: `!equip [cosmetic]`\nExample: `!equip voidtitle`", allowedMentions: SAFE_MENTIONS })
            return true
        }
        await simpleResult(message, equipItem(userId, name, item))
        return true
    }

    if (isUnequip) {
        const slot = content.slice(8).trim()
        await simpleResult(message, unequipItem(userId, name, slot))
        return true
    }

    const prefixLength = isBlackMarket ? "!blackmarket".length : "!shop".length
    const requested = content.slice(prefixLength).trim()
    if (["help", "commands"].includes(requested.toLowerCase())) {
        await message.channel.send({ embeds: [guideEmbed()], allowedMentions: SAFE_MENTIONS })
        return true
    }
    await openShop(message, requested)
    return true
}

module.exports = { handle }
