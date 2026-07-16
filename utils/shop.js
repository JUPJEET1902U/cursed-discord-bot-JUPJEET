const { getUser, saveEconomy, getOrCreateDailyQuests, QUEST_POOL } = require("./economy")
const { getPet, savePets, calcPetLevel } = require("./pets")

const CATEGORY_META = {
    featured: { name: "Daily Market", emoji: "🔥", description: "Four rotating offers refreshed every UTC day." },
    boosts: { name: "Boosts", emoji: "⚡", description: "Immediate bonuses for XP, daily rewards, and roast protection." },
    utility: { name: "Utility", emoji: "🧰", description: "Quest tools and mystery crates with controlled rewards." },
    pets: { name: "Pet Supplies", emoji: "🐾", description: "Food, healing, and training items for your companion." },
    cosmetics: { name: "Cosmetics", emoji: "🎨", description: "Collect and equip titles, themes, and profile badges." },
    permanent: { name: "Permanent", emoji: "💎", description: "One-time account upgrades that stay forever." },
}

const CATALOG = {
    shield: {
        id: "shield", name: "Roast Shield", emoji: "🛡️", price: 200, category: "boosts",
        rarity: "Common", kind: "instant", description: "CURSED goes easy on your next 5 AI conversations.",
        effect: { type: "counter", key: "roastShield", amount: 5 },
        aliases: ["roastshield", "roast-shield"],
    },
    xpboost: {
        id: "xpboost", name: "XP Booster", emoji: "💥", price: 400, category: "boosts",
        rarity: "Rare", kind: "instant", description: "Double XP on your next 10 qualifying AI conversations.",
        effect: { type: "counter", key: "xpBoost", amount: 10 },
        aliases: ["xp", "xpbooster", "xp-boost"],
    },
    dailyboost: {
        id: "dailyboost", name: "Daily Booster", emoji: "🎲", price: 300, category: "boosts",
        rarity: "Uncommon", kind: "instant", description: "Double your next daily reward.",
        effect: { type: "counter", key: "dailyBoost", amount: 1 },
        aliases: ["daily", "dailybooster", "daily-boost"],
    },
    questreroll: {
        id: "questreroll", name: "Quest Reroll Token", emoji: "🔄", price: 250, category: "utility",
        rarity: "Uncommon", kind: "consumable", description: "Replace one unfinished daily quest with a different quest.",
        use: "questReroll", aliases: ["reroll", "quest-reroll", "questrerolltoken"],
    },
    questbooster: {
        id: "questbooster", name: "Quest Reward Booster", emoji: "📜", price: 450, category: "utility",
        rarity: "Rare", kind: "consumable", description: "Increase today's unclaimed daily quest rewards by 25%.",
        use: "questBoost", aliases: ["questboost", "quest-boost", "questreward"],
    },
    mysterycrate: {
        id: "mysterycrate", name: "Mystery Crate", emoji: "🎁", price: 600, category: "utility",
        rarity: "Epic", kind: "consumable", description: "Open a controlled crate containing boosts, supplies, or coins.",
        use: "mysteryCrate", aliases: ["crate", "mystery", "mystery-crate"],
    },
    chaoscrate: {
        id: "chaoscrate", name: "Chaos Crate", emoji: "🧿", price: 900, category: "utility",
        rarity: "Cursed", kind: "consumable", description: "A daily-market crate with improved rewards and no real-money value.",
        use: "chaosCrate", rotatingOnly: true, aliases: ["chaos", "chaos-crate"],
    },
    petfood: {
        id: "petfood", name: "Pet Food Bundle", emoji: "🍖", price: 180, category: "pets",
        rarity: "Common", kind: "consumable", description: "Restore 60 hunger, 10 health, and improve your pet's mood.",
        use: "petFood", aliases: ["food", "foodbundle", "pet-food"],
    },
    petheal: {
        id: "petheal", name: "Pet Healing Potion", emoji: "💊", price: 250, category: "pets",
        rarity: "Uncommon", kind: "consumable", description: "Restore your pet to full health.",
        use: "petHeal", aliases: ["healpotion", "pet-heal", "potion"],
    },
    trainingpass: {
        id: "trainingpass", name: "Pet Training Pass", emoji: "🏋️", price: 350, category: "pets",
        rarity: "Rare", kind: "consumable", description: "Grant your current pet 75 XP instantly.",
        use: "trainingPass", aliases: ["training", "trainpass", "training-pass"],
    },
    voidtitle: {
        id: "voidtitle", name: "Void Walker Title", emoji: "🌑", price: 1200, category: "cosmetics",
        rarity: "Rare", kind: "cosmetic", slot: "title", display: "🌑 Void Walker",
        description: "Equip the Void Walker title on your CURSED profile.",
        aliases: ["void", "void-title"],
    },
    infernaltitle: {
        id: "infernaltitle", name: "Infernal Title", emoji: "🔥", price: 1600, category: "cosmetics",
        rarity: "Epic", kind: "cosmetic", slot: "title", display: "🔥 Infernal",
        description: "Equip an Infernal title on your CURSED profile.",
        aliases: ["infernal", "infernal-title"],
    },
    arenatitle: {
        id: "arenatitle", name: "Arena Champion Title", emoji: "⚔️", price: 2000, category: "cosmetics",
        rarity: "Legendary", kind: "cosmetic", slot: "title", display: "⚔️ Arena Champion",
        description: "Equip a battle-focused Arena Champion title.",
        aliases: ["arena", "champion", "arena-title"],
    },
    crimsontheme: {
        id: "crimsontheme", name: "Crimson Profile Theme", emoji: "🩸", price: 1800, category: "cosmetics",
        rarity: "Epic", kind: "cosmetic", slot: "theme", display: "Crimson", color: 0xDC143C,
        description: "Use a crimson accent on your CURSED profile.",
        aliases: ["crimson", "crimson-theme"],
    },
    neontheme: {
        id: "neontheme", name: "Neon Profile Theme", emoji: "💜", price: 2200, category: "cosmetics",
        rarity: "Legendary", kind: "cosmetic", slot: "theme", display: "Neon", color: 0x8B5CF6,
        description: "Use a bright neon-purple accent on your CURSED profile.",
        aliases: ["neon", "neon-theme"],
    },
    voidtheme: {
        id: "voidtheme", name: "Void Profile Theme", emoji: "🕳️", price: 3000, category: "cosmetics",
        rarity: "Cursed", kind: "cosmetic", slot: "theme", display: "Void", color: 0x312E81,
        description: "A rotating deep-void profile theme.",
        rotatingOnly: true, aliases: ["void-theme"],
    },
    highrollerbadge: {
        id: "highrollerbadge", name: "High Roller Badge", emoji: "👑", price: 2500, category: "cosmetics",
        rarity: "Legendary", kind: "cosmetic", slot: "badge", display: "👑 High Roller",
        description: "Equip a collectible High Roller profile badge.",
        aliases: ["highroller", "high-roller", "rollerbadge"],
    },
    shadowbadge: {
        id: "shadowbadge", name: "Shadowborn Badge", emoji: "🌘", price: 2800, category: "cosmetics",
        rarity: "Cursed", kind: "cosmetic", slot: "badge", display: "🌘 Shadowborn",
        description: "A rotating badge from the Black Market.",
        rotatingOnly: true, aliases: ["shadow", "shadowborn", "shadow-badge"],
    },
    cursedcrown: {
        id: "cursedcrown", name: "Cursed Crown Title", emoji: "👹", price: 3500, category: "cosmetics",
        rarity: "Cursed", kind: "cosmetic", slot: "title", display: "👹 Cursed Royalty",
        description: "A rotating title reserved for the daily Black Market.",
        rotatingOnly: true, aliases: ["crown", "cursed-crown"],
    },
    vip: {
        id: "vip", name: "VIP Title", emoji: "⭐", price: 500, category: "permanent",
        rarity: "Uncommon", kind: "legacyPermanent", key: "vip",
        description: "Permanent VIP marker on your profile.",
        aliases: ["viptitle", "vip-title"],
    },
    badge: {
        id: "badge", name: "Cursed Badge", emoji: "💀", price: 1000, category: "permanent",
        rarity: "Rare", kind: "legacyPermanent", key: "badge",
        description: "Permanent classic CURSED badge on your profile.",
        aliases: ["cursedbadge", "cursed-badge"],
    },
    prestige: {
        id: "prestige", name: "Prestige Status", emoji: "🌟", price: 2000, category: "permanent",
        rarity: "Legendary", kind: "legacyPermanent", key: "prestige",
        description: "Permanent prestige status — the ultimate classic flex.",
        aliases: ["prestigestatus", "prestige-status"],
    },
}

const ALIASES = {}
for (const item of Object.values(CATALOG)) {
    ALIASES[item.id] = item.id
    for (const alias of item.aliases || []) ALIASES[normalizeToken(alias)] = item.id
}

const MARKET_POOL = [
    "xpboost", "dailyboost", "shield", "questreroll", "questbooster",
    "mysterycrate", "chaoscrate", "petfood", "petheal", "trainingpass",
    "voidtitle", "infernaltitle", "arenatitle", "crimsontheme", "neontheme",
    "voidtheme", "highrollerbadge", "shadowbadge", "cursedcrown",
]

function normalizeToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function resolveItemId(value) {
    return ALIASES[normalizeToken(value)] || null
}

function ensureShopState(user) {
    if (!user.inventory || typeof user.inventory !== "object" || Array.isArray(user.inventory)) user.inventory = {}
    if (!user.cosmetics || typeof user.cosmetics !== "object" || Array.isArray(user.cosmetics)) user.cosmetics = {}
    if (!Array.isArray(user.cosmetics.owned)) user.cosmetics.owned = []
    if (!user.cosmetics.equipped || typeof user.cosmetics.equipped !== "object") {
        user.cosmetics.equipped = { title: null, theme: null, badge: null }
    }
    for (const slot of ["title", "theme", "badge"]) {
        if (!(slot in user.cosmetics.equipped)) user.cosmetics.equipped[slot] = null
    }
    if (!user.shopState || typeof user.shopState !== "object" || Array.isArray(user.shopState)) {
        user.shopState = { marketDate: null, marketPurchases: {} }
    }
    if (!user.shopState.marketPurchases || typeof user.shopState.marketPurchases !== "object") {
        user.shopState.marketPurchases = {}
    }
    user.stats = user.stats || {}
    return user
}

function dateKey(date = new Date()) {
    return date.toISOString().slice(0, 10)
}

function hashString(value) {
    let hash = 2166136261
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

function seededShuffle(values, seed) {
    const result = [...values]
    let state = seed >>> 0
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

function getDailyMarket(key = dateKey()) {
    const seed = hashString(`CURSED:${key}`)
    const ids = seededShuffle(MARKET_POOL, seed).slice(0, 4)
    const discountIndex = seed % ids.length
    const discount = 15 + ((seed >>> 4) % 11)
    return ids.map((id, index) => {
        const item = CATALOG[id]
        const percentage = index === discountIndex ? discount : 10
        return {
            ...item,
            market: true,
            discount: percentage,
            marketPrice: Math.max(1, Math.floor(item.price * (1 - percentage / 100))),
            dateKey: key,
        }
    })
}

function resetMarketState(user, key = dateKey()) {
    ensureShopState(user)
    if (user.shopState.marketDate !== key) {
        user.shopState.marketDate = key
        user.shopState.marketPurchases = {}
    }
    return user.shopState
}

function getItem(value) {
    const id = resolveItemId(value)
    return id ? CATALOG[id] : null
}

function getCategoryItems(category) {
    if (category === "featured") return getDailyMarket()
    return Object.values(CATALOG).filter(item => item.category === category && !item.rotatingOnly)
}

function isOwned(user, item) {
    ensureShopState(user)
    if (item.kind === "legacyPermanent") return Boolean(user[item.key])
    if (item.kind === "cosmetic") return user.cosmetics.owned.includes(item.id)
    return false
}

function getOffer(user, item, key = dateKey()) {
    ensureShopState(user)
    resetMarketState(user, key)
    const marketItem = getDailyMarket(key).find(entry => entry.id === item.id)
    const usedDailyOffer = Boolean(user.shopState.marketPurchases[item.id])

    if (item.rotatingOnly && !marketItem) {
        return { available: false, reason: "That item is not in today's Black Market rotation." }
    }
    if (item.rotatingOnly && usedDailyOffer) {
        return { available: false, reason: "That limited item is sold out for you until the next UTC rotation." }
    }
    if (marketItem && !usedDailyOffer) {
        return { available: true, price: marketItem.marketPrice, discount: marketItem.discount, dailyOffer: true }
    }
    return { available: true, price: item.price, discount: 0, dailyOffer: false }
}

function addInventory(user, itemId, amount = 1) {
    ensureShopState(user)
    user.inventory[itemId] = Math.max(0, Number(user.inventory[itemId] || 0) + amount)
    if (user.inventory[itemId] === 0) delete user.inventory[itemId]
}

function buyItem(userId, name, rawItem, quantity = 1) {
    const item = getItem(rawItem)
    if (!item) return { ok: false, message: "❌ Item not found. Use `!shop` to browse the Black Market." }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return { ok: false, message: "❌ Quantity must be a whole number from 1 to 10." }
    }

    const { data, user } = getUser(userId, name)
    ensureShopState(user)
    const offer = getOffer(user, item)
    if (!offer.available) return { ok: false, message: `❌ ${offer.reason}` }

    if (["legacyPermanent", "cosmetic"].includes(item.kind)) quantity = 1
    if (item.rotatingOnly) quantity = 1
    if (isOwned(user, item)) return { ok: false, message: `✅ You already own **${item.name}**.` }

    const firstPrice = offer.price
    const remainingPrice = item.price * Math.max(0, quantity - 1)
    const totalPrice = firstPrice + remainingPrice
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0) {
        return { ok: false, message: "❌ That purchase total is invalid." }
    }
    if ((user.coins || 0) < totalPrice) {
        return { ok: false, message: `💸 You need **${totalPrice.toLocaleString()} coins** but only have **${(user.coins || 0).toLocaleString()}**.` }
    }

    user.coins -= totalPrice
    if (item.kind === "instant") {
        const amount = item.effect.amount * quantity
        user[item.effect.key] = Number(user[item.effect.key] || 0) + amount
    } else if (item.kind === "legacyPermanent") {
        user[item.key] = true
    } else if (item.kind === "cosmetic") {
        user.cosmetics.owned.push(item.id)
    } else if (item.kind === "consumable") {
        addInventory(user, item.id, quantity)
    }

    if (offer.dailyOffer) user.shopState.marketPurchases[item.id] = true
    user.stats.shopPurchases = Number(user.stats.shopPurchases || 0) + quantity
    user.stats.coinsSpent = Number(user.stats.coinsSpent || 0) + totalPrice
    saveEconomy(data)

    const discountText = offer.dailyOffer ? ` (${offer.discount}% daily deal)` : ""
    return {
        ok: true,
        item,
        quantity,
        totalPrice,
        balance: user.coins,
        message: `✅ Purchased **${quantity}× ${item.emoji} ${item.name}** for **${totalPrice.toLocaleString()} coins**${discountText}.\nBalance: **${user.coins.toLocaleString()} coins**.`,
    }
}

function consumeOne(user, itemId) {
    if (Number(user.inventory?.[itemId] || 0) < 1) return false
    addInventory(user, itemId, -1)
    return true
}

function cloneQuest(quest) {
    return { ...quest, reward: { ...quest.reward }, progress: 0 }
}

function useItem(userId, name, rawItem) {
    const item = getItem(rawItem)
    if (!item || item.kind !== "consumable") {
        return { ok: false, message: "❌ That is not a usable inventory item." }
    }

    const { data, user } = getUser(userId, name)
    ensureShopState(user)
    if (Number(user.inventory[item.id] || 0) < 1) {
        return { ok: false, message: `❌ You do not own **${item.name}**. Use \`!shop\` to buy it.` }
    }

    let result = null

    if (item.use === "questReroll") {
        const qp = getOrCreateDailyQuests(user)
        if (qp.claimed) return { ok: false, message: "❌ Today's quest rewards are already claimed." }
        const incompleteIndexes = qp.quests.map((quest, index) => quest.progress < quest.goal ? index : -1).filter(index => index >= 0)
        if (!incompleteIndexes.length) return { ok: false, message: "❌ All current quests are complete. Save the token for tomorrow." }
        const existingIds = new Set(qp.quests.map(quest => quest.id))
        const candidates = QUEST_POOL.filter(quest => !existingIds.has(quest.id))
        if (!candidates.length) return { ok: false, message: "❌ No different quest is available right now." }
        const index = incompleteIndexes[Math.floor(Math.random() * incompleteIndexes.length)]
        const oldQuest = qp.quests[index]
        const replacement = cloneQuest(candidates[Math.floor(Math.random() * candidates.length)])
        qp.quests[index] = replacement
        result = `🔄 Replaced **${oldQuest.desc}** with **${replacement.desc}**.`
    } else if (item.use === "questBoost") {
        const qp = getOrCreateDailyQuests(user)
        if (qp.claimed) return { ok: false, message: "❌ Today's quest rewards are already claimed." }
        if (qp.rewardBoosted) return { ok: false, message: "❌ Today's quests are already boosted." }
        for (const quest of qp.quests) {
            quest.reward.coins = Math.ceil(quest.reward.coins * 1.25)
            quest.reward.xp = Math.ceil(quest.reward.xp * 1.25)
        }
        qp.rewardBoosted = true
        result = "📜 Today's unclaimed quest rewards were increased by **25%**."
    } else if (["petFood", "petHeal", "trainingPass"].includes(item.use)) {
        const { data: petData, pet } = getPet(userId)
        if (!pet) return { ok: false, message: "❌ You need a pet before using this item." }
        if (item.use === "petFood") {
            const hunger = Number(pet.hunger || 0)
            const health = Number(pet.health ?? 100)
            if (hunger >= 100 && health >= 100) return { ok: false, message: `💚 **${pet.name}** is already fully fed and healthy.` }
            pet.hunger = Math.min(100, hunger + 60)
            pet.health = Math.min(100, health + 10)
            pet.mood = "happy"
            result = `🍖 **${pet.name}** is now at **${pet.hunger}% hunger** and **${pet.health}% health**.`
        } else if (item.use === "petHeal") {
            if (Number(pet.health ?? 100) >= 100) return { ok: false, message: `💚 **${pet.name}** is already at full health.` }
            pet.health = 100
            pet.mood = "happy"
            result = `💊 **${pet.name}** was restored to full health.`
        } else {
            pet.xp = Number(pet.xp || 0) + 75
            pet.mood = "excited"
            result = `🏋️ **${pet.name}** gained **75 pet XP** and reached level **${calcPetLevel(pet.xp)}**.`
        }
        savePets(petData)
    } else if (["mysteryCrate", "chaosCrate"].includes(item.use)) {
        const better = item.use === "chaosCrate"
        const rewards = better
            ? ["coins", "xp", "daily", "reroll", "petfood", "questboost"]
            : ["coins", "shield", "xp", "daily", "reroll", "petfood"]
        const reward = rewards[Math.floor(Math.random() * rewards.length)]
        if (reward === "coins") {
            const coins = better ? Math.floor(Math.random() * 251) + 300 : Math.floor(Math.random() * 151) + 150
            user.coins += coins
            result = `🪙 The crate contained **${coins} Cursed Coins**.`
        } else if (reward === "shield") {
            user.roastShield = Number(user.roastShield || 0) + 5
            result = "🛡️ The crate contained **5 Roast Shield uses**."
        } else if (reward === "xp") {
            user.xpBoost = Number(user.xpBoost || 0) + (better ? 10 : 5)
            result = `💥 The crate contained **${better ? 10 : 5} XP Booster uses**.`
        } else if (reward === "daily") {
            user.dailyBoost = Number(user.dailyBoost || 0) + 1
            result = "🎲 The crate contained **1 Daily Booster**."
        } else if (reward === "reroll") {
            addInventory(user, "questreroll", 1)
            result = "🔄 The crate contained **1 Quest Reroll Token**."
        } else if (reward === "petfood") {
            addInventory(user, "petfood", better ? 2 : 1)
            result = `🍖 The crate contained **${better ? 2 : 1} Pet Food Bundle${better ? "s" : ""}**.`
        } else {
            addInventory(user, "questbooster", 1)
            result = "📜 The crate contained **1 Quest Reward Booster**."
        }
    }

    if (!result) return { ok: false, message: "❌ That item could not be used." }
    consumeOne(user, item.id)
    user.stats.itemsUsed = Number(user.stats.itemsUsed || 0) + 1
    saveEconomy(data)
    return { ok: true, item, message: `✅ Used **${item.emoji} ${item.name}**.\n${result}` }
}

function equipItem(userId, name, rawItem) {
    const item = getItem(rawItem)
    if (!item || item.kind !== "cosmetic") return { ok: false, message: "❌ That item is not an equippable cosmetic." }
    const { data, user } = getUser(userId, name)
    ensureShopState(user)
    if (!user.cosmetics.owned.includes(item.id)) {
        return { ok: false, message: `❌ You do not own **${item.name}**.` }
    }
    user.cosmetics.equipped[item.slot] = item.id
    saveEconomy(data)
    return { ok: true, item, message: `✨ Equipped **${item.display}** in your **${item.slot}** slot.` }
}

function unequipItem(userId, name, rawSlot) {
    const slot = String(rawSlot || "").toLowerCase()
    if (!["title", "theme", "badge", "all"].includes(slot)) {
        return { ok: false, message: "Usage: `!unequip [title|theme|badge|all]`" }
    }
    const { data, user } = getUser(userId, name)
    ensureShopState(user)
    if (slot === "all") {
        user.cosmetics.equipped = { title: null, theme: null, badge: null }
    } else {
        user.cosmetics.equipped[slot] = null
    }
    saveEconomy(data)
    return { ok: true, message: `🧹 Unequipped **${slot}** cosmetics.` }
}

function getEquipped(user) {
    ensureShopState(user)
    const result = {}
    for (const slot of ["title", "theme", "badge"]) {
        const id = user.cosmetics.equipped[slot]
        result[slot] = id ? CATALOG[id] || null : null
    }
    return result
}

function getInventoryView(user) {
    ensureShopState(user)
    const consumables = Object.entries(user.inventory)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([id, quantity]) => ({ item: CATALOG[id], quantity: Number(quantity) }))
        .filter(entry => entry.item)
    const cosmetics = user.cosmetics.owned.map(id => CATALOG[id]).filter(Boolean)
    return { consumables, cosmetics, equipped: getEquipped(user) }
}

module.exports = {
    CATEGORY_META,
    CATALOG,
    dateKey,
    ensureShopState,
    resolveItemId,
    getItem,
    getCategoryItems,
    getDailyMarket,
    getOffer,
    getInventoryView,
    getEquipped,
    buyItem,
    useItem,
    equipItem,
    unequipItem,
}
