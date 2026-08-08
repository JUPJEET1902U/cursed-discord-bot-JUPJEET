/**
 * CURSED product identity and public module hierarchy.
 *
 * Reboot principle: complexity belongs inside the bot; the public interface
 * should expose a small number of stable, understandable systems.
 *
 * This module is presentation/navigation only. It must not own permissions,
 * persistence, moderation decisions, economy balances, or security actions.
 */

const BRAND = Object.freeze({
    name: "CURSED",
    tagline: "AI-powered server protection and community management.",
    shortTagline: "Protection. Moderation. AI. Community.",
    helpFooter: "CURSED • Help",
    securityFooter: "CURSED • Server Protection",
    moderationFooter: "CURSED • Moderation",
})

const SECTION_DEFINITIONS = Object.freeze([
    Object.freeze({
        key: "server-management",
        name: "Server Management",
        description: "Protection, moderation, automation and server administration.",
        categoryKeys: Object.freeze(["protection", "moderation", "admin", "server", "automation", "customroles", "custom-roles", "owner"]),
    }),
    Object.freeze({
        key: "ai-creative",
        name: "AI & Creative",
        description: "AI chat, memory, images and creative commands.",
        categoryKeys: Object.freeze(["memory", "fun"]),
    }),
    Object.freeze({
        key: "community",
        name: "Community",
        description: "Welcome, tickets, profiles, leveling, birthdays and community tools.",
        categoryKeys: Object.freeze(["communitytools", "profiles", "birthdays", "premium"]),
    }),
    Object.freeze({
        key: "economy-games",
        name: "Economy & Games",
        description: "Economy, games, gambling and pets.",
        categoryKeys: Object.freeze(["economy", "gambling", "games", "pets"]),
    }),
    Object.freeze({
        key: "utilities",
        name: "Utilities",
        description: "Everything else available in this server.",
        categoryKeys: Object.freeze([]),
    }),
])

function normalizeKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
}

function cleanCategoryName(value) {
    return String(value || "")
        .replace(/^\s*[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, "")
        .trim()
}

function categoryLabel(category) {
    return cleanCategoryName(category?.name || category?.key || "Commands") || "Commands"
}

function definitionForCategory(category) {
    const key = normalizeKey(category?.key)
    return SECTION_DEFINITIONS.find(definition =>
        definition.categoryKeys.some(categoryKey => normalizeKey(categoryKey) === key)
    ) || SECTION_DEFINITIONS[SECTION_DEFINITIONS.length - 1]
}

function groupCategories(categories = []) {
    const groups = new Map(SECTION_DEFINITIONS.map(definition => [definition.key, {
        ...definition,
        categories: [],
        commandCount: 0,
    }]))

    for (const category of categories) {
        const definition = definitionForCategory(category)
        const group = groups.get(definition.key)
        const normalized = { ...category, name: categoryLabel(category) }
        group.categories.push(normalized)
        group.commandCount += Array.isArray(category?.commands) ? category.commands.length : 0
    }

    return [...groups.values()].filter(group => group.categories.length > 0)
}

function findSection(sectionKey, categories = []) {
    return groupCategories(categories).find(section => section.key === sectionKey) || null
}

function findCategory(categoryKey, categories = []) {
    const wanted = normalizeKey(categoryKey)
    return categories.find(category => normalizeKey(category?.key) === wanted) || null
}

function commandDisplayName(name) {
    return String(name || "").trim()
}

module.exports = {
    BRAND,
    SECTION_DEFINITIONS,
    normalizeKey,
    cleanCategoryName,
    categoryLabel,
    definitionForCategory,
    groupCategories,
    findSection,
    findCategory,
    commandDisplayName,
}
