const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const mongoose = require("mongoose")

const CODES_FILE = path.resolve(process.cwd(), "premiumCodes.json")
const FALLBACK_FILE = path.resolve(process.cwd(), "premiumData.json")
const DISCORD_ID = /^\d{17,20}$/
const DELETE_CODE = Symbol("deletePremiumCode")

const BOT_OWNER_IDS = Object.freeze(
    (process.env.BOT_OWNER_IDS || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
)

const PLAN_LIMITS = Object.freeze({
    free: Object.freeze({
        name: "Free",
        aiReplyCooldownMs: 5_000,
        memoryStoredMessages: 8,
        memoryContextMessages: 4,
        longTermMemoryContextItems: 6,
        imageUserDaily: 3,
        imageGuildDaily: 20,
        imageCooldownMs: 60_000,
        imageVariations: false,
        imageAvatarReference: false,
        memeUserDaily: 3,
        memeGuildDaily: 20,
        memeCooldownMs: 30_000,
        funUserDaily: 15,
        funGuildDaily: 300,
        commandCooldownMultiplier: 1,
        ticketPanels: 1,
        ticketCategoriesPerPanel: 3,
        ticketQuestionsPerCategory: 0,
        ticketHistoryDays: 7,
        welcomeCard: false,
        welcomeCustomBackground: false,
        welcomeThemes: ["classic"],
        analyticsHistoryDays: 7,
        customBranding: false,
        prioritySupport: false,
    }),
    premium: Object.freeze({
        name: "Premium",
        aiReplyCooldownMs: 0,
        memoryStoredMessages: 40,
        memoryContextMessages: 20,
        longTermMemoryContextItems: 30,
        imageUserDaily: 20,
        imageGuildDaily: 200,
        imageCooldownMs: 12_000,
        imageVariations: true,
        imageAvatarReference: true,
        memeUserDaily: 20,
        memeGuildDaily: 200,
        memeCooldownMs: 6_000,
        funUserDaily: 100,
        funGuildDaily: 2_000,
        commandCooldownMultiplier: 0.5,
        ticketPanels: 5,
        ticketCategoriesPerPanel: 25,
        ticketQuestionsPerCategory: 5,
        ticketHistoryDays: 90,
        welcomeCard: true,
        welcomeCustomBackground: true,
        welcomeThemes: ["classic", "midnight", "neon"],
        analyticsHistoryDays: 90,
        customBranding: true,
        prioritySupport: true,
    }),
})

const DEFAULT_PAYMENT_SETTINGS = Object.freeze({
    enabled: false,
    currency: "USD",
    monthlyPrice: "4.99",
    headline: "Upgrade to CURSED Premium",
    instructions: "Complete payment, then include your Discord user ID in the payment note so the bot owner can verify your purchase.",
    links: Object.freeze({
        kofi: null,
        patreon: null,
        bmc: null,
        checkout: null,
    }),
})

const premiumAccountSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, default: "manual", maxlength: 80 },
    note: { type: String, default: "", maxlength: 500 },
    grantedBy: { type: String, default: null },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null, index: true },
    revokedAt: { type: Date, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "premiumAccounts", timestamps: true, minimize: false })

const premiumSettingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: "global" },
    enabled: { type: Boolean, default: false },
    currency: { type: String, default: "USD", maxlength: 8 },
    monthlyPrice: { type: String, default: "4.99", maxlength: 32 },
    headline: { type: String, default: DEFAULT_PAYMENT_SETTINGS.headline, maxlength: 120 },
    instructions: { type: String, default: DEFAULT_PAYMENT_SETTINGS.instructions, maxlength: 1000 },
    links: {
        kofi: { type: String, default: null, maxlength: 2048 },
        patreon: { type: String, default: null, maxlength: 2048 },
        bmc: { type: String, default: null, maxlength: 2048 },
        checkout: { type: String, default: null, maxlength: 2048 },
    },
    updatedBy: { type: String, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "premiumSettings", timestamps: true, minimize: false })

const premiumCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deleted: { type: Boolean, default: false, index: true },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "premiumCodes", timestamps: true, minimize: false })

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const PremiumAccount = getModel("PremiumAccount", premiumAccountSchema)
const PremiumSettings = getModel("PremiumSettings", premiumSettingsSchema)
const PremiumCode = getModel("PremiumCode", premiumCodeSchema)

const accountCache = new Map()
let paymentSettingsCache = clone(DEFAULT_PAYMENT_SETTINGS)
const codeCache = new Map()
const pendingAccountWrites = new Map()
let pendingSettingsWrite = null
const pendingCodeWrites = new Map()
const aiCooldowns = new Map()
const usageCounters = new Map()
let refreshPromise = null

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function isValidDiscordId(value) {
    return DISCORD_ID.test(String(value || ""))
}

function isBotOwnerId(userId) {
    return BOT_OWNER_IDS.includes(String(userId || ""))
}

function normalizeUrl(value) {
    const text = String(value || "").trim()
    if (!text) return null
    try {
        const url = new URL(text)
        if (!["http:", "https:"].includes(url.protocol)) return null
        return text.slice(0, 2048)
    } catch {
        return null
    }
}

function normalizePaymentSettings(raw = {}) {
    const links = raw.links && typeof raw.links === "object" ? raw.links : {}
    const currency = String(raw.currency || DEFAULT_PAYMENT_SETTINGS.currency)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 8) || DEFAULT_PAYMENT_SETTINGS.currency
    const monthlyPrice = String(raw.monthlyPrice ?? DEFAULT_PAYMENT_SETTINGS.monthlyPrice)
        .trim()
        .replace(/[^0-9.,]/g, "")
        .slice(0, 32) || DEFAULT_PAYMENT_SETTINGS.monthlyPrice

    return {
        enabled: raw.enabled === true,
        currency,
        monthlyPrice,
        headline: String(raw.headline || DEFAULT_PAYMENT_SETTINGS.headline).trim().slice(0, 120),
        instructions: String(raw.instructions || DEFAULT_PAYMENT_SETTINGS.instructions).trim().slice(0, 1000),
        links: {
            kofi: normalizeUrl(links.kofi),
            patreon: normalizeUrl(links.patreon),
            bmc: normalizeUrl(links.bmc),
            checkout: normalizeUrl(links.checkout),
        },
        updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
        updatedBy: raw.updatedBy || null,
    }
}

function isAccountActive(account) {
    if (!account || account.active !== true) return false
    if (!account.expiresAt) return true
    return new Date(account.expiresAt).getTime() > Date.now()
}

function normalizeAccount(account = {}) {
    return {
        userId: String(account.userId || ""),
        active: account.active !== false,
        source: String(account.source || "manual").slice(0, 80),
        note: String(account.note || "").slice(0, 500),
        grantedBy: account.grantedBy || null,
        grantedAt: account.grantedAt ? new Date(account.grantedAt).toISOString() : new Date().toISOString(),
        expiresAt: account.expiresAt ? new Date(account.expiresAt).toISOString() : null,
        revokedAt: account.revokedAt ? new Date(account.revokedAt).toISOString() : null,
        updatedAt: account.updatedAt ? new Date(account.updatedAt).toISOString() : null,
    }
}

function normalizeCodeData(info = {}) {
    const raw = info && typeof info === "object" && !Array.isArray(info) ? info : {}
    return {
        ...clone(raw),
        used: raw.used === true,
        createdBy: raw.createdBy || null,
        note: String(raw.note || ""),
        createdAt: raw.createdAt || new Date().toISOString(),
        usedBy: raw.usedBy || null,
        usedAt: raw.usedAt || null,
    }
}

function loadLegacyFallback() {
    try {
        if (!fs.existsSync(FALLBACK_FILE)) return { accounts: {}, settings: clone(DEFAULT_PAYMENT_SETTINGS) }
        const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"))
        return {
            accounts: parsed?.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {},
            settings: normalizePaymentSettings(parsed?.settings || DEFAULT_PAYMENT_SETTINGS),
        }
    } catch (err) {
        console.error("Premium legacy load error:", err.message)
        return { accounts: {}, settings: clone(DEFAULT_PAYMENT_SETTINGS) }
    }
}

function loadLegacyCodes() {
    try {
        if (!fs.existsSync(CODES_FILE)) return {}
        const parsed = JSON.parse(fs.readFileSync(CODES_FILE, "utf8"))
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch (err) {
        console.error("Premium codes legacy load error:", err.message)
        return {}
    }
}

const legacyFallbackExists = fs.existsSync(FALLBACK_FILE)
const legacyCodesExists = fs.existsSync(CODES_FILE)
const legacyFallback = loadLegacyFallback()
const legacyCodes = loadLegacyCodes()

function accountSetFields(account) {
    return {
        active: account.active === true,
        source: account.source,
        note: account.note,
        grantedBy: account.grantedBy,
        grantedAt: new Date(account.grantedAt),
        expiresAt: account.expiresAt ? new Date(account.expiresAt) : null,
        revokedAt: account.revokedAt ? new Date(account.revokedAt) : null,
    }
}

function settingsSetFields(settings) {
    return {
        enabled: settings.enabled,
        currency: settings.currency,
        monthlyPrice: settings.monthlyPrice,
        headline: settings.headline,
        instructions: settings.instructions,
        links: settings.links,
        updatedBy: settings.updatedBy || null,
    }
}

async function migrateLegacyPremiumData() {
    if (!isMongoConnected()) return { accounts: 0, settings: 0, codes: 0 }
    let importedAccounts = 0
    let importedSettings = 0
    let importedCodes = 0

    const accountOps = []
    for (const [userId, rawAccount] of Object.entries(legacyFallbackExists ? legacyFallback.accounts : {})) {
        if (!isValidDiscordId(userId)) continue
        const account = normalizeAccount({ ...rawAccount, userId })
        accountOps.push({
            updateOne: {
                filter: { userId },
                update: {
                    $setOnInsert: {
                        userId,
                        ...accountSetFields(account),
                        migratedFrom: "premiumData.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (accountOps.length) {
        const result = await PremiumAccount.bulkWrite(accountOps, { ordered: false })
        importedAccounts = result.upsertedCount || 0
    }

    if (legacyFallbackExists) {
        const legacySettings = normalizePaymentSettings(legacyFallback.settings)
        const settingsResult = await PremiumSettings.updateOne(
            { key: "global" },
            {
                $setOnInsert: {
                    key: "global",
                    ...settingsSetFields(legacySettings),
                    migratedFrom: "premiumData.json",
                    migratedAt: new Date(),
                },
            },
            { upsert: true }
        )
        importedSettings = settingsResult.upsertedCount || 0
    }

    const codeOps = []
    for (const [code, rawInfo] of Object.entries(legacyCodesExists ? legacyCodes : {})) {
        if (!code) continue
        codeOps.push({
            updateOne: {
                filter: { code },
                update: {
                    $setOnInsert: {
                        code,
                        data: normalizeCodeData(rawInfo),
                        deleted: false,
                        migratedFrom: "premiumCodes.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (codeOps.length) {
        const result = await PremiumCode.bulkWrite(codeOps, { ordered: false })
        importedCodes = result.upsertedCount || 0
    }

    return { accounts: importedAccounts, settings: importedSettings, codes: importedCodes }
}

async function persistAccount(userId, account) {
    if (!isMongoConnected()) return false
    await PremiumAccount.findOneAndUpdate(
        { userId },
        {
            $set: accountSetFields(account),
            $setOnInsert: { userId },
        },
        { upsert: true, new: true }
    )
    if (pendingAccountWrites.get(userId) === account) pendingAccountWrites.delete(userId)
    return true
}

async function persistSettings(settings) {
    if (!isMongoConnected()) return false
    await PremiumSettings.findOneAndUpdate(
        { key: "global" },
        {
            $set: settingsSetFields(settings),
            $setOnInsert: { key: "global" },
        },
        { upsert: true, new: true }
    )
    if (pendingSettingsWrite === settings) pendingSettingsWrite = null
    return true
}

async function persistCode(code, value) {
    if (!isMongoConnected()) return false
    if (value === DELETE_CODE) {
        await PremiumCode.findOneAndUpdate(
            { code },
            {
                $set: { deleted: true, data: {} },
                $setOnInsert: { code },
            },
            { upsert: true }
        )
    } else {
        await PremiumCode.findOneAndUpdate(
            { code },
            {
                $set: { data: normalizeCodeData(value), deleted: false },
                $setOnInsert: { code },
            },
            { upsert: true }
        )
    }
    if (pendingCodeWrites.get(code) === value) pendingCodeWrites.delete(code)
    return true
}

async function flushPendingPremiumWrites() {
    if (!isMongoConnected()) return false
    for (const [userId, account] of [...pendingAccountWrites]) {
        try { await persistAccount(userId, account) }
        catch (err) { console.error(`Premium account save error (${userId}):`, err.message) }
    }
    if (pendingSettingsWrite) {
        const settings = pendingSettingsWrite
        try { await persistSettings(settings) }
        catch (err) { console.error("Premium settings save error:", err.message) }
    }
    for (const [code, value] of [...pendingCodeWrites]) {
        try { await persistCode(code, value) }
        catch (err) { console.error(`Premium code save error (${code}):`, err.message) }
    }
    return pendingAccountWrites.size === 0 && !pendingSettingsWrite && pendingCodeWrites.size === 0
}

async function refreshPremiumCache() {
    if (!isMongoConnected()) return false
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
        try {
            const imported = await migrateLegacyPremiumData()
            const [accounts, settings, codes] = await Promise.all([
                PremiumAccount.find({}).lean(),
                PremiumSettings.findOne({ key: "global" }).lean(),
                PremiumCode.find({ deleted: { $ne: true } }).lean(),
            ])

            const nextAccounts = new Map()
            for (const account of accounts) {
                const normalized = normalizeAccount(account)
                if (normalized.userId) nextAccounts.set(normalized.userId, normalized)
            }
            accountCache.clear()
            for (const [userId, account] of nextAccounts) accountCache.set(userId, account)
            for (const [userId, account] of pendingAccountWrites) accountCache.set(userId, account)

            if (!pendingSettingsWrite) {
                paymentSettingsCache = settings
                    ? normalizePaymentSettings(settings)
                    : clone(DEFAULT_PAYMENT_SETTINGS)
            }

            codeCache.clear()
            for (const doc of codes) {
                if (doc?.code) codeCache.set(doc.code, normalizeCodeData(doc.data))
            }
            for (const [code, value] of pendingCodeWrites) {
                if (value === DELETE_CODE) codeCache.delete(code)
                else codeCache.set(code, normalizeCodeData(value))
            }

            await flushPendingPremiumWrites()
            console.log(
                `✅ Premium MongoDB ready: ${accountCache.size} account(s), ${codeCache.size} code(s), ` +
                `${imported.accounts + imported.settings + imported.codes} legacy record(s) imported`
            )
            return true
        } catch (err) {
            console.error("Premium cache refresh error:", err.message)
            return false
        } finally {
            refreshPromise = null
        }
    })()

    return refreshPromise
}

mongoose.connection.on("connected", () => { refreshPremiumCache().catch(() => {}) })
if (isMongoConnected()) refreshPremiumCache().catch(() => {})

function isPremiumUser(userId) {
    const id = String(userId || "")
    if (isBotOwnerId(id)) return true
    return isAccountActive(accountCache.get(id))
}

function getUserPlan(userId) {
    return isPremiumUser(userId) ? "premium" : "free"
}

function getPlanLimits(userId) {
    return PLAN_LIMITS[getUserPlan(userId)]
}

function isGuildPremium(guild) {
    return Boolean(guild?.ownerId && isPremiumUser(guild.ownerId))
}

function getGuildPlanLimits(guild) {
    return isGuildPremium(guild) ? PLAN_LIMITS.premium : PLAN_LIMITS.free
}

function checkAiReplyCooldown(userId, guildId = "global") {
    const cooldownMs = getPlanLimits(userId).aiReplyCooldownMs
    if (cooldownMs <= 0) return { ok: true, remainingMs: 0, remainingSeconds: 0 }

    const key = `${guildId}:${userId}`
    const now = Date.now()
    const previous = aiCooldowns.get(key) || 0
    const elapsed = now - previous
    if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed
        return {
            ok: false,
            remainingMs,
            remainingSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        }
    }
    aiCooldowns.set(key, now)
    return { ok: true, remainingMs: 0, remainingSeconds: 0 }
}

function usageDayKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10)
}

function usageLimitFields(feature) {
    if (feature === "image") return ["imageUserDaily", "imageGuildDaily"]
    if (feature === "meme") return ["memeUserDaily", "memeGuildDaily"]
    if (feature === "fun") return ["funUserDaily", "funGuildDaily"]
    throw new Error(`Unknown premium usage feature: ${feature}`)
}

function consumeFeatureUsage(feature, { userId, guildId, units = 1 } = {}) {
    const amount = Math.max(1, Math.floor(Number(units) || 1))
    const limits = getPlanLimits(userId)
    const [userField, guildField] = usageLimitFields(feature)
    const userLimit = limits[userField]
    const guildLimit = limits[guildField]
    const day = usageDayKey()
    const userKey = `${day}:${feature}:user:${userId}`
    const guildKey = `${day}:${feature}:guild:${guildId || "dm"}`
    const userCount = usageCounters.get(userKey) || 0
    const guildCount = usageCounters.get(guildKey) || 0

    if (userCount + amount > userLimit) {
        return { ok: false, scope: "user", limit: userLimit, used: userCount, remaining: Math.max(0, userLimit - userCount) }
    }
    if (guildCount + amount > guildLimit) {
        return { ok: false, scope: "guild", limit: guildLimit, used: guildCount, remaining: Math.max(0, guildLimit - guildCount) }
    }

    usageCounters.set(userKey, userCount + amount)
    usageCounters.set(guildKey, guildCount + amount)
    return {
        ok: true,
        scope: null,
        userLimit,
        guildLimit,
        userRemaining: Math.max(0, userLimit - userCount - amount),
        guildRemaining: Math.max(0, guildLimit - guildCount - amount),
    }
}

function refundFeatureUsage(feature, { userId, guildId, units = 1 } = {}) {
    const amount = Math.max(1, Math.floor(Number(units) || 1))
    const day = usageDayKey()
    for (const key of [
        `${day}:${feature}:user:${userId}`,
        `${day}:${feature}:guild:${guildId || "dm"}`,
    ]) {
        const next = Math.max(0, (usageCounters.get(key) || 0) - amount)
        if (next === 0) usageCounters.delete(key)
        else usageCounters.set(key, next)
    }
}

async function syncPremiumRole(client, userId, active, guildId = null) {
    if (!client?.guilds?.cache || !isValidDiscordId(userId)) return []
    const { getServerConfig } = require("./serverConfig")
    const results = []
    const guilds = guildId
        ? [client.guilds.cache.get(guildId)].filter(Boolean)
        : [...client.guilds.cache.values()]

    for (const guild of guilds) {
        const roleId = getServerConfig(guild.id).config.premiumRoleId
        if (!roleId) continue
        const member = await guild.members.fetch(userId).catch(() => null)
        if (!member) continue
        try {
            if (active && !member.roles.cache.has(roleId)) await member.roles.add(roleId, "CURSED Premium granted by bot owner")
            if (!active && member.roles.cache.has(roleId)) await member.roles.remove(roleId, "CURSED Premium revoked by bot owner")
            results.push({ guildId: guild.id, roleId, ok: true })
        } catch (err) {
            results.push({ guildId: guild.id, roleId, ok: false, error: err.message })
        }
    }
    return results
}

async function grantPremiumUser(userId, options = {}) {
    const id = String(userId || "")
    if (!isValidDiscordId(id)) throw new Error("A valid Discord user ID is required.")
    const expiresAt = options.expiresAt ? new Date(options.expiresAt) : null
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Invalid Premium expiry date.")

    const account = normalizeAccount({
        userId: id,
        active: true,
        source: options.source || "manual",
        note: options.note || "",
        grantedBy: options.grantedBy || null,
        grantedAt: new Date(),
        expiresAt,
        revokedAt: null,
        updatedAt: new Date(),
    })
    accountCache.set(id, account)
    pendingAccountWrites.set(id, account)

    if (isMongoConnected()) await persistAccount(id, account)

    const roleResults = options.client
        ? await syncPremiumRole(options.client, id, true, options.guildId || null)
        : []
    return { account, roleResults }
}

async function revokePremiumUser(userId, options = {}) {
    const id = String(userId || "")
    if (!isValidDiscordId(id)) throw new Error("A valid Discord user ID is required.")
    const previous = accountCache.get(id) || normalizeAccount({ userId: id })
    const account = normalizeAccount({
        ...previous,
        userId: id,
        active: false,
        revokedAt: new Date(),
        updatedAt: new Date(),
    })
    accountCache.set(id, account)
    pendingAccountWrites.set(id, account)

    if (isMongoConnected()) await persistAccount(id, account)

    const roleResults = options.client
        ? await syncPremiumRole(options.client, id, false, options.guildId || null)
        : []
    return { account, roleResults }
}

function listPremiumUsers() {
    return [...accountCache.values()]
        .filter(isAccountActive)
        .sort((a, b) => String(b.grantedAt || "").localeCompare(String(a.grantedAt || "")))
        .map(clone)
}

function getPremiumAccount(userId) {
    const account = accountCache.get(String(userId || ""))
    return account ? clone(account) : null
}

function getPaymentSettings() {
    return clone(paymentSettingsCache)
}

async function updatePaymentSettings(patch = {}, actorId = null) {
    const merged = normalizePaymentSettings({
        ...paymentSettingsCache,
        ...patch,
        links: { ...paymentSettingsCache.links, ...(patch.links || {}) },
        updatedBy: actorId || null,
        updatedAt: new Date(),
    })
    paymentSettingsCache = merged
    pendingSettingsWrite = merged

    if (isMongoConnected()) await persistSettings(merged)
    return getPaymentSettings()
}

function loadCodes() {
    const result = {}
    for (const [code, info] of codeCache) result[code] = clone(info)
    return result
}

function saveCodes(data) {
    const next = data && typeof data === "object" && !Array.isArray(data) ? data : {}
    const nextKeys = new Set(Object.keys(next))

    for (const code of [...codeCache.keys()]) {
        if (nextKeys.has(code)) continue
        codeCache.delete(code)
        pendingCodeWrites.set(code, DELETE_CODE)
    }

    for (const [code, rawInfo] of Object.entries(next)) {
        const info = normalizeCodeData(rawInfo)
        codeCache.set(code, info)
        pendingCodeWrites.set(code, info)
    }

    if (isMongoConnected()) flushPendingPremiumWrites().catch(err =>
        console.error("Premium code flush error:", err.message)
    )
}

function generateCode() {
    return "CURSED-" + crypto.randomBytes(4).toString("hex").toUpperCase()
}

function createCode(adminId, note = "") {
    let code = generateCode()
    while (codeCache.has(code)) code = generateCode()
    const info = normalizeCodeData({
        used: false,
        createdBy: adminId,
        note,
        createdAt: new Date().toISOString(),
        usedBy: null,
        usedAt: null,
    })
    codeCache.set(code, info)
    pendingCodeWrites.set(code, info)
    if (isMongoConnected()) flushPendingPremiumWrites().catch(err =>
        console.error("Premium code create error:", err.message)
    )
    return code
}

function useCode(code, userId) {
    const info = codeCache.get(code)
    if (!info) return { ok: false, reason: "invalid" }
    if (info.used) return { ok: false, reason: "used" }
    const updated = normalizeCodeData({
        ...info,
        used: true,
        usedBy: userId,
        usedAt: new Date().toISOString(),
    })
    codeCache.set(code, updated)
    pendingCodeWrites.set(code, updated)
    if (isMongoConnected()) flushPendingPremiumWrites().catch(err =>
        console.error("Premium code redeem error:", err.message)
    )
    return { ok: true }
}

function listCodes() {
    return [...codeCache.entries()].map(([code, info]) => ({ code, ...clone(info) }))
}

function _resetForTests() {
    aiCooldowns.clear()
    usageCounters.clear()
    accountCache.clear()
    codeCache.clear()
    pendingAccountWrites.clear()
    pendingCodeWrites.clear()
    pendingSettingsWrite = null
    paymentSettingsCache = clone(DEFAULT_PAYMENT_SETTINGS)
}

module.exports = {
    PLAN_LIMITS,
    DEFAULT_PAYMENT_SETTINGS,
    isValidDiscordId,
    isBotOwnerId,
    isPremiumUser,
    isGuildPremium,
    getUserPlan,
    getPlanLimits,
    getGuildPlanLimits,
    checkAiReplyCooldown,
    consumeFeatureUsage,
    refundFeatureUsage,
    refreshPremiumCache,
    grantPremiumUser,
    revokePremiumUser,
    syncPremiumRole,
    listPremiumUsers,
    getPremiumAccount,
    getPaymentSettings,
    updatePaymentSettings,
    loadCodes,
    saveCodes,
    generateCode,
    createCode,
    useCode,
    listCodes,
    _resetForTests,
}
