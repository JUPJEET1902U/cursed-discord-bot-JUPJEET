const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const premium = require("./premium")

const FALLBACK_FILE = path.resolve(process.cwd(), "serverPremiumData.json")

const premiumGuildAccountSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, default: "manual", maxlength: 80 },
    note: { type: String, default: "", maxlength: 500 },
    grantedBy: { type: String, default: null },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null, index: true },
    revokedAt: { type: Date, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "premiumGuildAccounts", timestamps: true, minimize: false })

function getModel() {
    try { return mongoose.model("PremiumGuildAccount") }
    catch { return mongoose.model("PremiumGuildAccount", premiumGuildAccountSchema) }
}

const PremiumGuildAccount = getModel()
const guildCache = new Map()
const pendingGuildWrites = new Map()
let refreshPromise = null
const ownerBasedGuildPremium = premium.isGuildPremium.bind(premium)

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function isAccountActive(account) {
    if (!account || account.active !== true) return false
    if (!account.expiresAt) return true
    return new Date(account.expiresAt).getTime() > Date.now()
}

function normalizeGuildAccount(account = {}) {
    return {
        guildId: String(account.guildId || ""),
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

function loadLegacyFallback() {
    try {
        if (!fs.existsSync(FALLBACK_FILE)) return {}
        const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"))
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch (err) {
        console.error("Server Premium legacy load error:", err.message)
        return {}
    }
}

const legacyAccounts = loadLegacyFallback()

async function migrateLegacyServerPremium() {
    if (!isMongoConnected()) return 0
    const operations = []
    for (const [guildId, rawAccount] of Object.entries(legacyAccounts)) {
        if (!premium.isValidDiscordId(guildId)) continue
        const account = normalizeGuildAccount({ ...rawAccount, guildId })
        operations.push({
            updateOne: {
                filter: { guildId },
                update: {
                    $setOnInsert: {
                        guildId,
                        ...accountSetFields(account),
                        migratedFrom: "serverPremiumData.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (!operations.length) return 0
    const result = await PremiumGuildAccount.bulkWrite(operations, { ordered: false })
    return result.upsertedCount || 0
}

async function persistGuildAccount(guildId, account) {
    if (!isMongoConnected()) return false
    await PremiumGuildAccount.findOneAndUpdate(
        { guildId },
        {
            $set: accountSetFields(account),
            $setOnInsert: { guildId },
        },
        { upsert: true, new: true }
    )
    if (pendingGuildWrites.get(guildId) === account) pendingGuildWrites.delete(guildId)
    return true
}

async function flushPendingServerPremiumWrites() {
    if (!isMongoConnected()) return false
    for (const [guildId, account] of [...pendingGuildWrites]) {
        try { await persistGuildAccount(guildId, account) }
        catch (err) { console.error(`Server Premium save error (${guildId}):`, err.message) }
    }
    return pendingGuildWrites.size === 0
}

async function refreshServerPremiumCache() {
    if (!isMongoConnected()) return false
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
        try {
            const imported = await migrateLegacyServerPremium()
            const accounts = await PremiumGuildAccount.find({}).lean()
            guildCache.clear()
            for (const account of accounts) {
                const normalized = normalizeGuildAccount(account)
                if (premium.isValidDiscordId(normalized.guildId)) {
                    guildCache.set(normalized.guildId, normalized)
                }
            }
            for (const [guildId, account] of pendingGuildWrites) guildCache.set(guildId, account)
            await flushPendingServerPremiumWrites()
            console.log(`✅ Server Premium MongoDB ready: ${guildCache.size} account(s), ${imported} imported from legacy JSON`)
            return true
        } catch (err) {
            console.error("Server Premium cache refresh error:", err.message)
            return false
        } finally {
            refreshPromise = null
        }
    })()

    return refreshPromise
}

mongoose.connection.on("connected", () => { refreshServerPremiumCache().catch(() => {}) })
if (isMongoConnected()) refreshServerPremiumCache().catch(() => {})

function getServerPremiumAccount(guildId) {
    const account = guildCache.get(String(guildId || ""))
    return account ? clone(account) : null
}

function isServerPremium(guildId) {
    return isAccountActive(guildCache.get(String(guildId || "")))
}

function isGuildPremium(guild) {
    return Boolean(guild?.id && isServerPremium(guild.id)) || ownerBasedGuildPremium(guild)
}

function getGuildPlanLimits(guild) {
    return isGuildPremium(guild) ? premium.PLAN_LIMITS.premium : premium.PLAN_LIMITS.free
}

async function grantServerPremium(guildId, options = {}) {
    const id = String(guildId || "")
    if (!premium.isValidDiscordId(id)) throw new Error("A valid Discord server ID is required.")
    const expiresAt = options.expiresAt ? new Date(options.expiresAt) : null
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Invalid server Premium expiry date.")

    const account = normalizeGuildAccount({
        guildId: id,
        active: true,
        source: options.source || "manual",
        note: options.note || "",
        grantedBy: options.grantedBy || null,
        grantedAt: new Date(),
        expiresAt,
        revokedAt: null,
        updatedAt: new Date(),
    })
    guildCache.set(id, account)
    pendingGuildWrites.set(id, account)

    if (isMongoConnected()) await persistGuildAccount(id, account)
    return { account }
}

async function revokeServerPremium(guildId) {
    const id = String(guildId || "")
    if (!premium.isValidDiscordId(id)) throw new Error("A valid Discord server ID is required.")
    const previous = guildCache.get(id) || normalizeGuildAccount({ guildId: id })
    const account = normalizeGuildAccount({
        ...previous,
        guildId: id,
        active: false,
        revokedAt: new Date(),
        updatedAt: new Date(),
    })
    guildCache.set(id, account)
    pendingGuildWrites.set(id, account)

    if (isMongoConnected()) await persistGuildAccount(id, account)
    return { account }
}

function listServerPremiumAccounts() {
    return [...guildCache.values()]
        .filter(isAccountActive)
        .sort((a, b) => String(b.grantedAt || "").localeCompare(String(a.grantedAt || "")))
        .map(clone)
}

function _resetForTests() {
    guildCache.clear()
    pendingGuildWrites.clear()
}

// Patch the shared Premium module before dashboard, ticket and welcome modules
// destructure these functions during startup.
premium.isGuildPremium = isGuildPremium
premium.getGuildPlanLimits = getGuildPlanLimits
premium.isServerPremium = isServerPremium
premium.getServerPremiumAccount = getServerPremiumAccount
premium.grantServerPremium = grantServerPremium
premium.revokeServerPremium = revokeServerPremium
premium.listServerPremiumAccounts = listServerPremiumAccounts
premium.refreshServerPremiumCache = refreshServerPremiumCache

module.exports = {
    isServerPremium,
    isGuildPremium,
    getGuildPlanLimits,
    getServerPremiumAccount,
    grantServerPremium,
    revokeServerPremium,
    listServerPremiumAccounts,
    refreshServerPremiumCache,
    _resetForTests,
}
