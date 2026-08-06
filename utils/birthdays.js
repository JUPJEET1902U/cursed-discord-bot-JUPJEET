const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const { ChannelType } = require("discord.js")

const FALLBACK_FILE = path.resolve(process.cwd(), "birthdayData.json")
const RETRY_DELAY_MS = 30_000
const DEFAULT_ANNOUNCEMENT_TEMPLATE = "🎉 **HAPPY BIRTHDAY, {user}!** 🎂\nEveryone wish **{username}** an amazing birthday! We hope your day is full of happiness, fun and unforgettable moments. 💜"
const DEFAULT_DM_TEMPLATE = "🎂 Happy Birthday, {username}! CURSED wishes you an amazing year ahead. Have a wonderful day! 🎉💜"
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

const birthdayEntrySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    day: { type: Number, required: true, min: 1, max: 31 },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, default: null, min: 1900, max: 9999 },
    addedBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
    lastAnnouncementKey: { type: String, default: null },
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "birthdayEntries", timestamps: true, minimize: false })
birthdayEntrySchema.index({ guildId: 1, userId: 1 }, { unique: true })
birthdayEntrySchema.index({ guildId: 1, month: 1, day: 1 })

const birthdayGuildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: true },
    announcementChannelId: { type: String, default: null },
    timezone: { type: String, default: "UTC", maxlength: 100 },
    dmEnabled: { type: Boolean, default: true },
    announcementEnabled: { type: Boolean, default: true },
    announcementTemplate: { type: String, default: DEFAULT_ANNOUNCEMENT_TEMPLATE, maxlength: 1500 },
    dmTemplate: { type: String, default: DEFAULT_DM_TEMPLATE, maxlength: 1500 },
    updatedBy: { type: String, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "birthdayGuildConfigs", timestamps: true, minimize: false })

const birthdayDmDeliverySchema = new mongoose.Schema({
    deliveryKey: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    birthdayKey: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    deliveredAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
}, { collection: "birthdayDmDeliveries", timestamps: true, minimize: false })

function model(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const BirthdayEntry = model("BirthdayEntry", birthdayEntrySchema)
const BirthdayGuildConfig = model("BirthdayGuildConfig", birthdayGuildConfigSchema)
const BirthdayDmDelivery = model("BirthdayDmDelivery", birthdayDmDeliverySchema)

const entryCache = new Map()
const entryTombstones = new Set()
const configCache = new Map()
const activeDmDeliveries = new Set()
const releasedDmDeliveries = new Set()
const pendingEntryWrites = new Map()
const pendingConfigWrites = new Map()
const pendingDmWrites = new Map()

let schedulerHandle = null
let schedulerRunning = false
let initializationPromise = null
let initialized = false
let retryTimer = null

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
}

function entryKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function sanitizeTemplate(value, fallbackValue) {
    const text = String(value || "").trim()
    return (text || fallbackValue).slice(0, 1500)
}

function normalizeConfig(config = {}) {
    return {
        guildId: String(config.guildId || ""),
        enabled: config.enabled !== false,
        announcementChannelId: config.announcementChannelId ? String(config.announcementChannelId) : null,
        timezone: validateTimezone(config.timezone) ? String(config.timezone) : "UTC",
        dmEnabled: config.dmEnabled !== false,
        announcementEnabled: config.announcementEnabled !== false,
        announcementTemplate: sanitizeTemplate(config.announcementTemplate, DEFAULT_ANNOUNCEMENT_TEMPLATE),
        dmTemplate: sanitizeTemplate(config.dmTemplate, DEFAULT_DM_TEMPLATE),
        updatedBy: config.updatedBy ? String(config.updatedBy) : null,
        updatedAt: config.updatedAt ? new Date(config.updatedAt).toISOString() : null,
    }
}

function normalizeEntry(entry = {}) {
    return {
        guildId: String(entry.guildId || ""),
        userId: String(entry.userId || ""),
        day: Number(entry.day),
        month: Number(entry.month),
        year: entry.year == null ? null : Number(entry.year),
        addedBy: String(entry.addedBy || entry.updatedBy || ""),
        updatedBy: String(entry.updatedBy || entry.addedBy || ""),
        lastAnnouncementKey: entry.lastAnnouncementKey || null,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : new Date().toISOString(),
    }
}

function loadLegacySnapshot() {
    const empty = { entries: [], configs: [], dmDeliveries: [] }
    try {
        if (!fs.existsSync(FALLBACK_FILE)) return empty
        const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"))
        return {
            entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
            configs: Array.isArray(parsed?.configs) ? parsed.configs : [],
            dmDeliveries: Array.isArray(parsed?.dmDeliveries) ? parsed.dmDeliveries : [],
        }
    } catch (err) {
        console.error("Birthday legacy load error:", err.message)
        return empty
    }
}

const legacySnapshot = loadLegacySnapshot()
for (const rawEntry of legacySnapshot.entries) {
    if (!rawEntry?.guildId || !rawEntry?.userId) continue
    const entry = normalizeEntry(rawEntry)
    entryCache.set(entryKey(entry.guildId, entry.userId), entry)
}
for (const rawConfig of legacySnapshot.configs) {
    if (!rawConfig?.guildId) continue
    const config = normalizeConfig(rawConfig)
    configCache.set(config.guildId, config)
}
for (const rawKey of legacySnapshot.dmDeliveries) {
    const deliveryKey = String(rawKey || "")
    if (deliveryKey) activeDmDeliveries.add(deliveryKey)
}

function entrySetFields(entry) {
    return {
        day: entry.day,
        month: entry.month,
        year: entry.year,
        addedBy: entry.addedBy,
        updatedBy: entry.updatedBy,
        lastAnnouncementKey: entry.lastAnnouncementKey || null,
        deleted: false,
        deletedAt: null,
    }
}

function configSetFields(config) {
    return {
        enabled: config.enabled,
        announcementChannelId: config.announcementChannelId,
        timezone: config.timezone,
        dmEnabled: config.dmEnabled,
        announcementEnabled: config.announcementEnabled,
        announcementTemplate: config.announcementTemplate,
        dmTemplate: config.dmTemplate,
        updatedBy: config.updatedBy,
    }
}

function parseLegacyDeliveryKey(deliveryKey) {
    const [userId = "", birthdayKey = ""] = String(deliveryKey || "").split(":")
    return { userId, birthdayKey }
}

async function migrateLegacyBirthdayData() {
    if (!isMongoConnected()) return { entries: 0, configs: 0, dmDeliveries: 0 }
    let importedEntries = 0
    let importedConfigs = 0
    let importedDmDeliveries = 0

    const entryOps = []
    for (const rawEntry of legacySnapshot.entries) {
        if (!rawEntry?.guildId || !rawEntry?.userId) continue
        const entry = normalizeEntry(rawEntry)
        if (!validateBirthday(entry.day, entry.month, entry.year)) continue
        entryOps.push({
            updateOne: {
                filter: { guildId: entry.guildId, userId: entry.userId },
                update: {
                    $setOnInsert: {
                        guildId: entry.guildId,
                        userId: entry.userId,
                        ...entrySetFields(entry),
                        migratedFrom: "birthdayData.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (entryOps.length) {
        const result = await BirthdayEntry.bulkWrite(entryOps, { ordered: false })
        importedEntries = result.upsertedCount || 0
    }

    const configOps = []
    for (const rawConfig of legacySnapshot.configs) {
        if (!rawConfig?.guildId) continue
        const config = normalizeConfig(rawConfig)
        configOps.push({
            updateOne: {
                filter: { guildId: config.guildId },
                update: {
                    $setOnInsert: {
                        guildId: config.guildId,
                        ...configSetFields(config),
                        migratedFrom: "birthdayData.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (configOps.length) {
        const result = await BirthdayGuildConfig.bulkWrite(configOps, { ordered: false })
        importedConfigs = result.upsertedCount || 0
    }

    const dmOps = []
    for (const rawKey of legacySnapshot.dmDeliveries) {
        const deliveryKey = String(rawKey || "")
        if (!deliveryKey) continue
        const { userId, birthdayKey } = parseLegacyDeliveryKey(deliveryKey)
        dmOps.push({
            updateOne: {
                filter: { deliveryKey },
                update: {
                    $setOnInsert: {
                        deliveryKey,
                        userId,
                        birthdayKey,
                        active: true,
                        deliveredAt: new Date(),
                        releasedAt: null,
                        migratedFrom: "birthdayData.json",
                        migratedAt: new Date(),
                    },
                },
                upsert: true,
            },
        })
    }
    if (dmOps.length) {
        const result = await BirthdayDmDelivery.bulkWrite(dmOps, { ordered: false })
        importedDmDeliveries = result.upsertedCount || 0
    }

    return { entries: importedEntries, configs: importedConfigs, dmDeliveries: importedDmDeliveries }
}

async function persistEntryMutation(key, mutation) {
    if (!isMongoConnected()) return false
    if (mutation.type === "delete") {
        await BirthdayEntry.findOneAndUpdate(
            { guildId: mutation.guildId, userId: mutation.userId },
            {
                $set: { deleted: true, deletedAt: new Date(), lastAnnouncementKey: null },
                $setOnInsert: {
                    guildId: mutation.guildId,
                    userId: mutation.userId,
                    day: 1,
                    month: 1,
                    year: null,
                    addedBy: mutation.actorId || "system",
                    updatedBy: mutation.actorId || "system",
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
    } else {
        const entry = mutation.entry
        await BirthdayEntry.findOneAndUpdate(
            { guildId: entry.guildId, userId: entry.userId },
            {
                $set: entrySetFields(entry),
                $setOnInsert: { guildId: entry.guildId, userId: entry.userId },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
    }
    if (pendingEntryWrites.get(key) === mutation) pendingEntryWrites.delete(key)
    return true
}

async function persistConfig(config) {
    if (!isMongoConnected()) return false
    await BirthdayGuildConfig.findOneAndUpdate(
        { guildId: config.guildId },
        {
            $set: configSetFields(config),
            $setOnInsert: { guildId: config.guildId },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    if (pendingConfigWrites.get(config.guildId) === config) pendingConfigWrites.delete(config.guildId)
    return true
}

async function persistDmMutation(deliveryKey, mutation) {
    if (!isMongoConnected()) return false
    await BirthdayDmDelivery.findOneAndUpdate(
        { deliveryKey },
        {
            $set: {
                userId: mutation.userId,
                birthdayKey: mutation.birthdayKey,
                active: mutation.active,
                deliveredAt: mutation.active ? (mutation.deliveredAt || new Date()) : mutation.deliveredAt,
                releasedAt: mutation.active ? null : (mutation.releasedAt || new Date()),
            },
            $setOnInsert: { deliveryKey },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    if (pendingDmWrites.get(deliveryKey) === mutation) pendingDmWrites.delete(deliveryKey)
    return true
}

async function flushPendingBirthdayWrites() {
    if (!isMongoConnected()) return false
    for (const [key, mutation] of [...pendingEntryWrites]) {
        try { await persistEntryMutation(key, mutation) }
        catch (err) { console.error(`Birthday entry save error (${key}):`, err.message) }
    }
    for (const [, config] of [...pendingConfigWrites]) {
        try { await persistConfig(config) }
        catch (err) { console.error(`Birthday config save error (${config.guildId}):`, err.message) }
    }
    for (const [deliveryKey, mutation] of [...pendingDmWrites]) {
        try { await persistDmMutation(deliveryKey, mutation) }
        catch (err) { console.error(`Birthday DM state save error (${deliveryKey}):`, err.message) }
    }
    return pendingEntryWrites.size === 0 && pendingConfigWrites.size === 0 && pendingDmWrites.size === 0
}

function scheduleRetry() {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        initializeBirthdayStore().catch(() => {})
    }, RETRY_DELAY_MS)
    retryTimer.unref?.()
}

async function initializeBirthdayStore() {
    if (!isMongoConnected()) return false
    if (initialized) return true
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
        try {
            const imported = await migrateLegacyBirthdayData()
            await BirthdayDmDelivery.updateMany(
                { active: { $exists: false } },
                { $set: { active: true, releasedAt: null } }
            )
            const [entries, configs, deliveries] = await Promise.all([
                BirthdayEntry.find({}).lean(),
                BirthdayGuildConfig.find({}).lean(),
                BirthdayDmDelivery.find({}).lean(),
            ])

            entryCache.clear()
            entryTombstones.clear()
            for (const doc of entries) {
                const key = entryKey(doc.guildId, doc.userId)
                if (doc.deleted === true) entryTombstones.add(key)
                else entryCache.set(key, normalizeEntry(doc))
            }

            configCache.clear()
            for (const doc of configs) {
                const config = normalizeConfig(doc)
                if (config.guildId) configCache.set(config.guildId, config)
            }

            activeDmDeliveries.clear()
            releasedDmDeliveries.clear()
            for (const doc of deliveries) {
                if (!doc?.deliveryKey) continue
                if (doc.active === false) releasedDmDeliveries.add(doc.deliveryKey)
                else activeDmDeliveries.add(doc.deliveryKey)
            }

            for (const [key, mutation] of pendingEntryWrites) {
                if (mutation.type === "delete") {
                    entryCache.delete(key)
                    entryTombstones.add(key)
                } else {
                    entryTombstones.delete(key)
                    entryCache.set(key, mutation.entry)
                }
            }
            for (const [guildId, config] of pendingConfigWrites) configCache.set(guildId, config)
            for (const [deliveryKey, mutation] of pendingDmWrites) {
                if (mutation.active) {
                    releasedDmDeliveries.delete(deliveryKey)
                    activeDmDeliveries.add(deliveryKey)
                } else {
                    activeDmDeliveries.delete(deliveryKey)
                    releasedDmDeliveries.add(deliveryKey)
                }
            }

            await flushPendingBirthdayWrites()
            const importedCount = imported.entries + imported.configs + imported.dmDeliveries
            initialized = true
            console.log(
                `✅ Birthday MongoDB ready: ${entryCache.size} birthday(s), ${configCache.size} guild config(s), ` +
                `${activeDmDeliveries.size} DM delivery claim(s), ${importedCount} legacy record(s) imported`
            )
            return true
        } catch (err) {
            console.error("Birthday MongoDB initialization error:", err.message)
            scheduleRetry()
            return false
        } finally {
            initializationPromise = null
        }
    })()

    return initializationPromise
}

async function ensureBirthdayReady() {
    if (!isMongoConnected()) return false
    return initializeBirthdayStore()
}

mongoose.connection.on("connected", () => { initializeBirthdayStore().catch(() => {}) })
mongoose.connection.on("disconnected", () => { initialized = false })
if (isMongoConnected()) initializeBirthdayStore().catch(() => {})

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(month, year = 2000) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function validateBirthday(day, month, year = null) {
    if (!Number.isInteger(day) || !Number.isInteger(month)) return false
    if (month < 1 || month > 12 || day < 1) return false
    if (year != null && (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear())) return false
    const validationYear = year == null ? 2000 : year
    return day <= daysInMonth(month, validationYear)
}

function parseBirthdayInput(input) {
    const match = String(input || "").trim().match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}))?$/)
    if (!match) return { ok: false, error: "Use `DD-MM` or `DD-MM-YYYY`, for example `24-07` or `24-07-2006`." }
    const day = Number(match[1])
    const month = Number(match[2])
    const year = match[3] ? Number(match[3]) : null
    if (!validateBirthday(day, month, year)) return { ok: false, error: "That is not a valid birthday date." }
    return { ok: true, day, month, year }
}

function validateTimezone(timezone) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: String(timezone || "") }).format(new Date())
        return Boolean(timezone)
    } catch {
        return false
    }
}

function getDateParts(timezone = "UTC", date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        timeZone: validateTimezone(timezone) ? timezone : "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    })
    const values = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
    return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function birthdayMatchesDate(entry, dateParts) {
    if (entry.month === dateParts.month && entry.day === dateParts.day) return true
    return entry.month === 2 && entry.day === 29 && !isLeapYear(dateParts.year)
        && dateParts.month === 2 && dateParts.day === 28
}

function celebrationDay(entry, year) {
    if (entry.month === 2 && entry.day === 29 && !isLeapYear(year)) return 28
    return entry.day
}

function calculateAge(entry, dateParts) {
    if (!entry.year) return null
    const age = dateParts.year - entry.year
    return age >= 0 && age <= 150 ? age : null
}

function formatBirthday(entry, includeYear = false) {
    const base = `${entry.day} ${MONTH_NAMES[entry.month - 1] || "Unknown"}`
    return includeYear && entry.year ? `${base} ${entry.year}` : base
}

function parseMonth(value) {
    const raw = String(value || "").trim().toLowerCase()
    if (!raw) return null
    if (/^\d{1,2}$/.test(raw)) {
        const numeric = Number(raw)
        return numeric >= 1 && numeric <= 12 ? numeric : null
    }
    const index = MONTH_NAMES.findIndex(name => name.toLowerCase() === raw || name.toLowerCase().startsWith(raw))
    return index >= 0 ? index + 1 : null
}

function nextBirthday(entry, dateParts) {
    const todayUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)
    for (let year = dateParts.year; year <= dateParts.year + 5; year += 1) {
        const day = celebrationDay(entry, year)
        const candidate = Date.UTC(year, entry.month - 1, day)
        if (candidate >= todayUtc) {
            return { year, month: entry.month, day, daysUntil: Math.round((candidate - todayUtc) / 86_400_000) }
        }
    }
    return null
}

function renderTemplate(template, { userId, username, guildName, entry, age, dm = false }) {
    const replacements = {
        "{user}": dm ? username : `<@${userId}>`,
        "{username}": username,
        "{server}": guildName,
        "{age}": age == null ? "another amazing year" : String(age),
        "{birthday}": formatBirthday(entry, false),
    }
    let output = sanitizeTemplate(template, dm ? DEFAULT_DM_TEMPLATE : DEFAULT_ANNOUNCEMENT_TEMPLATE)
    for (const [placeholder, value] of Object.entries(replacements)) output = output.split(placeholder).join(value)
    return output.slice(0, 1900)
}

async function getBirthdayConfig(guildId) {
    const id = String(guildId || "")
    const pending = pendingConfigWrites.get(id)
    if (pending) return clone(pending)

    if (await ensureBirthdayReady()) {
        const found = await BirthdayGuildConfig.findOne({ guildId: id }).lean()
        if (found) {
            const config = normalizeConfig(found)
            configCache.set(id, config)
            return config
        }
    }
    return normalizeConfig(configCache.get(id) || { guildId: id })
}

async function updateBirthdayConfig(guildId, patch = {}, actorId = null) {
    const current = await getBirthdayConfig(guildId)
    const next = normalizeConfig({ ...current, ...patch, guildId: String(guildId), updatedBy: actorId || current.updatedBy, updatedAt: new Date() })
    configCache.set(next.guildId, next)
    pendingConfigWrites.set(next.guildId, next)
    if (isMongoConnected()) {
        try { await persistConfig(next) }
        catch (err) { console.error(`Birthday config save error (${next.guildId}):`, err.message); scheduleRetry() }
    }
    return next
}

async function upsertBirthday(guildId, userId, birthday, actorId) {
    const id = String(guildId || "")
    const uid = String(userId || "")
    if (!validateBirthday(birthday.day, birthday.month, birthday.year ?? null)) throw new Error("Invalid birthday date.")
    const existing = await getBirthday(id, uid)
    const now = new Date()
    const next = normalizeEntry({
        ...existing,
        guildId: id,
        userId: uid,
        day: birthday.day,
        month: birthday.month,
        year: birthday.year ?? null,
        addedBy: existing?.addedBy || actorId,
        updatedBy: actorId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastAnnouncementKey: null,
    })
    const key = entryKey(id, uid)
    entryTombstones.delete(key)
    entryCache.set(key, next)
    const mutation = { type: "upsert", entry: next }
    pendingEntryWrites.set(key, mutation)
    if (isMongoConnected()) {
        try { await persistEntryMutation(key, mutation) }
        catch (err) { console.error(`Birthday entry save error (${key}):`, err.message); scheduleRetry() }
    }
    return next
}

async function getBirthday(guildId, userId) {
    const id = String(guildId || "")
    const uid = String(userId || "")
    const key = entryKey(id, uid)
    const pending = pendingEntryWrites.get(key)
    if (pending?.type === "delete") return null
    if (pending?.type === "upsert") return clone(pending.entry)
    if (entryTombstones.has(key)) return null

    if (await ensureBirthdayReady()) {
        const found = await BirthdayEntry.findOne({ guildId: id, userId: uid, deleted: { $ne: true } }).lean()
        if (found) {
            const entry = normalizeEntry(found)
            entryCache.set(key, entry)
            return entry
        }
        return null
    }
    const found = entryCache.get(key)
    return found ? clone(found) : null
}

async function listBirthdays(guildId, options = {}) {
    const id = String(guildId || "")
    let entries
    if (await ensureBirthdayReady()) {
        const query = { guildId: id, deleted: { $ne: true } }
        if (options.month) query.month = Number(options.month)
        entries = (await BirthdayEntry.find(query).sort({ month: 1, day: 1, userId: 1 }).lean()).map(normalizeEntry)
        const byKey = new Map(entries.map(entry => [entryKey(entry.guildId, entry.userId), entry]))
        for (const [key, mutation] of pendingEntryWrites) {
            if (!key.startsWith(`${id}:`)) continue
            if (mutation.type === "delete") byKey.delete(key)
            else if (!options.month || mutation.entry.month === Number(options.month)) byKey.set(key, mutation.entry)
        }
        entries = [...byKey.values()]
    } else {
        entries = [...entryCache.values()]
            .filter(entry => entry.guildId === id && (!options.month || entry.month === Number(options.month)))
            .map(normalizeEntry)
    }
    return entries.sort((a, b) => a.month - b.month || a.day - b.day || a.userId.localeCompare(b.userId))
}

async function removeBirthday(guildId, userId) {
    const id = String(guildId || "")
    const uid = String(userId || "")
    const existing = await getBirthday(id, uid)
    const key = entryKey(id, uid)
    entryCache.delete(key)
    entryTombstones.add(key)
    const mutation = { type: "delete", guildId: id, userId: uid, actorId: existing?.updatedBy || existing?.addedBy || "system" }
    pendingEntryWrites.set(key, mutation)
    if (isMongoConnected()) {
        try { await persistEntryMutation(key, mutation) }
        catch (err) { console.error(`Birthday entry delete error (${key}):`, err.message); scheduleRetry() }
    }
    return existing
}

async function claimAnnouncement(guildId, userId, key) {
    const id = String(guildId)
    const uid = String(userId)
    const cacheKey = entryKey(id, uid)

    if (await ensureBirthdayReady()) {
        const claimed = await BirthdayEntry.findOneAndUpdate(
            {
                guildId: id,
                userId: uid,
                deleted: { $ne: true },
                $or: [{ lastAnnouncementKey: { $ne: key } }, { lastAnnouncementKey: null }],
            },
            { $set: { lastAnnouncementKey: key } },
            { new: true }
        ).lean()
        if (!claimed) return false
        entryCache.set(cacheKey, normalizeEntry(claimed))
        return true
    }

    const stored = entryCache.get(cacheKey)
    if (!stored || stored.lastAnnouncementKey === key || entryTombstones.has(cacheKey)) return false
    const next = normalizeEntry({ ...stored, lastAnnouncementKey: key, updatedAt: new Date() })
    entryCache.set(cacheKey, next)
    const mutation = { type: "upsert", entry: next }
    pendingEntryWrites.set(cacheKey, mutation)
    return true
}

async function releaseAnnouncement(guildId, userId, key) {
    const id = String(guildId)
    const uid = String(userId)
    const cacheKey = entryKey(id, uid)
    let persisted = false
    if (await ensureBirthdayReady()) {
        const result = await BirthdayEntry.updateOne(
            { guildId: id, userId: uid, deleted: { $ne: true }, lastAnnouncementKey: key },
            { $set: { lastAnnouncementKey: null } }
        )
        persisted = result.modifiedCount > 0
    }

    const stored = entryCache.get(cacheKey)
    if (stored?.lastAnnouncementKey === key) {
        const next = normalizeEntry({ ...stored, lastAnnouncementKey: null, updatedAt: new Date() })
        entryCache.set(cacheKey, next)
        if (!persisted) {
            const mutation = { type: "upsert", entry: next }
            pendingEntryWrites.set(cacheKey, mutation)
        }
    }
}

async function claimDm(userId, birthdayKey, year) {
    const deliveryKey = `${userId}:${birthdayKey}:${year}`
    const uid = String(userId)
    const bdayKey = String(birthdayKey)

    if (await ensureBirthdayReady()) {
        try {
            const claimed = await BirthdayDmDelivery.findOneAndUpdate(
                { deliveryKey, active: { $ne: true } },
                {
                    $set: { userId: uid, birthdayKey: bdayKey, active: true, deliveredAt: new Date(), releasedAt: null },
                    $setOnInsert: { deliveryKey },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean()
            if (!claimed) return false
            releasedDmDeliveries.delete(deliveryKey)
            activeDmDeliveries.add(deliveryKey)
            return true
        } catch (err) {
            if (err?.code === 11000) return false
            throw err
        }
    }

    if (activeDmDeliveries.has(deliveryKey)) return false
    releasedDmDeliveries.delete(deliveryKey)
    activeDmDeliveries.add(deliveryKey)
    const mutation = { active: true, userId: uid, birthdayKey: bdayKey, deliveredAt: new Date() }
    pendingDmWrites.set(deliveryKey, mutation)
    return true
}

async function releaseDm(userId, birthdayKey, year) {
    const deliveryKey = `${userId}:${birthdayKey}:${year}`
    const mutation = {
        active: false,
        userId: String(userId),
        birthdayKey: String(birthdayKey),
        releasedAt: new Date(),
    }
    activeDmDeliveries.delete(deliveryKey)
    releasedDmDeliveries.add(deliveryKey)
    pendingDmWrites.set(deliveryKey, mutation)
    if (isMongoConnected()) {
        try { await persistDmMutation(deliveryKey, mutation) }
        catch (err) { console.error(`Birthday DM release error (${deliveryKey}):`, err.message); scheduleRetry() }
    }
}

async function runBirthdayCheck(client, now = new Date()) {
    if (!client?.isReady?.() || schedulerRunning) return { checkedGuilds: 0, announcements: 0, dms: 0 }
    schedulerRunning = true
    const result = { checkedGuilds: 0, announcements: 0, dms: 0 }
    try {
        for (const guild of client.guilds.cache.values()) {
            const config = await getBirthdayConfig(guild.id)
            if (!config.enabled) continue
            result.checkedGuilds += 1
            const localDate = getDateParts(config.timezone, now)
            const entries = (await listBirthdays(guild.id)).filter(entry => birthdayMatchesDate(entry, localDate))
            for (const entry of entries) {
                const member = guild.members.cache.get(entry.userId) || await guild.members.fetch(entry.userId).catch(() => null)
                if (!member) continue
                const username = member.displayName || member.user.globalName || member.user.username
                const age = calculateAge(entry, localDate)
                const birthdayKey = `${String(entry.month).padStart(2, "0")}-${String(entry.day).padStart(2, "0")}`
                const annualKey = `${localDate.year}:${birthdayKey}`

                if (config.announcementEnabled && config.announcementChannelId) {
                    const claimed = await claimAnnouncement(guild.id, entry.userId, annualKey)
                    if (claimed) {
                        const channel = guild.channels.cache.get(config.announcementChannelId)
                        const validChannel = channel?.isTextBased?.() && ![ChannelType.DM, ChannelType.GroupDM].includes(channel.type)
                        try {
                            if (!validChannel) throw new Error("Configured birthday channel is unavailable.")
                            await channel.send({
                                content: renderTemplate(config.announcementTemplate, {
                                    userId: entry.userId, username, guildName: guild.name, entry, age, dm: false,
                                }),
                                allowedMentions: { parse: [], users: [entry.userId], roles: [], repliedUser: false },
                            })
                            result.announcements += 1
                        } catch (err) {
                            await releaseAnnouncement(guild.id, entry.userId, annualKey)
                            console.error(`[Birthdays] Announcement failed in ${guild.id}:`, err.message)
                        }
                    }
                }

                if (config.dmEnabled) {
                    const claimed = await claimDm(entry.userId, birthdayKey, localDate.year)
                    if (claimed) {
                        try {
                            await member.user.send({
                                content: renderTemplate(config.dmTemplate, {
                                    userId: entry.userId, username, guildName: guild.name, entry, age, dm: true,
                                }),
                                allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
                            })
                            result.dms += 1
                        } catch (err) {
                            await releaseDm(entry.userId, birthdayKey, localDate.year)
                            console.warn(`[Birthdays] DM failed for ${entry.userId}: ${err.message}`)
                        }
                    }
                }
            }
        }
    } finally {
        schedulerRunning = false
    }
    return result
}

function startBirthdayScheduler(client, intervalMs = 10 * 60 * 1000) {
    stopBirthdayScheduler()
    const run = () => runBirthdayCheck(client).catch(err => console.error("[Birthdays] Scheduler failed:", err.message))
    setTimeout(run, 15_000).unref?.()
    schedulerHandle = setInterval(run, Math.max(60_000, intervalMs))
    schedulerHandle.unref?.()
    return schedulerHandle
}

function stopBirthdayScheduler() {
    if (schedulerHandle) clearInterval(schedulerHandle)
    schedulerHandle = null
}

module.exports = {
    DEFAULT_ANNOUNCEMENT_TEMPLATE,
    DEFAULT_DM_TEMPLATE,
    MONTH_NAMES,
    parseBirthdayInput,
    validateBirthday,
    validateTimezone,
    getDateParts,
    birthdayMatchesDate,
    calculateAge,
    formatBirthday,
    parseMonth,
    nextBirthday,
    renderTemplate,
    getBirthdayConfig,
    updateBirthdayConfig,
    upsertBirthday,
    getBirthday,
    listBirthdays,
    removeBirthday,
    runBirthdayCheck,
    startBirthdayScheduler,
    stopBirthdayScheduler,
    isLeapYear,
    initializeBirthdayStore,
    flushPendingBirthdayWrites,
    _models: { BirthdayEntry, BirthdayGuildConfig, BirthdayDmDelivery },
}
