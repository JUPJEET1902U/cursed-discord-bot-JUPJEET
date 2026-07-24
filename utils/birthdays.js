const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const { ChannelType } = require("discord.js")

const FALLBACK_FILE = path.resolve(process.cwd(), "birthdayData.json")
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
}, { collection: "birthdayGuildConfigs", timestamps: true, minimize: false })

const birthdayDmDeliverySchema = new mongoose.Schema({
    deliveryKey: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    birthdayKey: { type: String, required: true },
    deliveredAt: { type: Date, default: Date.now },
}, { collection: "birthdayDmDeliveries", timestamps: true, minimize: false })

function model(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const BirthdayEntry = model("BirthdayEntry", birthdayEntrySchema)
const BirthdayGuildConfig = model("BirthdayGuildConfig", birthdayGuildConfigSchema)
const BirthdayDmDelivery = model("BirthdayDmDelivery", birthdayDmDeliverySchema)

const fallback = {
    entries: new Map(),
    configs: new Map(),
    dmDeliveries: new Set(),
}
let schedulerHandle = null
let schedulerRunning = false

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
}

function entryKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function loadFallback() {
    try {
        if (!fs.existsSync(FALLBACK_FILE)) return
        const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"))
        for (const entry of Array.isArray(parsed.entries) ? parsed.entries : []) {
            if (entry?.guildId && entry?.userId) fallback.entries.set(entryKey(entry.guildId, entry.userId), entry)
        }
        for (const config of Array.isArray(parsed.configs) ? parsed.configs : []) {
            if (config?.guildId) fallback.configs.set(config.guildId, config)
        }
        for (const key of Array.isArray(parsed.dmDeliveries) ? parsed.dmDeliveries : []) fallback.dmDeliveries.add(key)
    } catch (err) {
        console.error("Birthday fallback load error:", err.message)
    }
}

function saveFallback() {
    try {
        fs.writeFileSync(FALLBACK_FILE, JSON.stringify({
            entries: [...fallback.entries.values()],
            configs: [...fallback.configs.values()],
            dmDeliveries: [...fallback.dmDeliveries],
        }, null, 2))
    } catch (err) {
        console.error("Birthday fallback save error:", err.message)
    }
}

loadFallback()

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
    if (isMongoConnected()) {
        const found = await BirthdayGuildConfig.findOne({ guildId: id }).lean()
        if (found) return normalizeConfig(found)
    }
    return normalizeConfig(fallback.configs.get(id) || { guildId: id })
}

async function updateBirthdayConfig(guildId, patch = {}, actorId = null) {
    const current = await getBirthdayConfig(guildId)
    const next = normalizeConfig({ ...current, ...patch, guildId: String(guildId), updatedBy: actorId || current.updatedBy, updatedAt: new Date() })
    fallback.configs.set(next.guildId, next)
    saveFallback()
    if (isMongoConnected()) {
        await BirthdayGuildConfig.findOneAndUpdate(
            { guildId: next.guildId },
            { $set: {
                enabled: next.enabled,
                announcementChannelId: next.announcementChannelId,
                timezone: next.timezone,
                dmEnabled: next.dmEnabled,
                announcementEnabled: next.announcementEnabled,
                announcementTemplate: next.announcementTemplate,
                dmTemplate: next.dmTemplate,
                updatedBy: next.updatedBy,
            }, $setOnInsert: { guildId: next.guildId } },
            { upsert: true, new: true }
        )
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
    fallback.entries.set(entryKey(id, uid), next)
    saveFallback()
    if (isMongoConnected()) {
        await BirthdayEntry.findOneAndUpdate(
            { guildId: id, userId: uid },
            { $set: {
                day: next.day,
                month: next.month,
                year: next.year,
                updatedBy: next.updatedBy,
                lastAnnouncementKey: null,
            }, $setOnInsert: { guildId: id, userId: uid, addedBy: next.addedBy } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
    }
    return next
}

async function getBirthday(guildId, userId) {
    const id = String(guildId || "")
    const uid = String(userId || "")
    if (isMongoConnected()) {
        const found = await BirthdayEntry.findOne({ guildId: id, userId: uid }).lean()
        if (found) return normalizeEntry(found)
    }
    const found = fallback.entries.get(entryKey(id, uid))
    return found ? clone(found) : null
}

async function listBirthdays(guildId, options = {}) {
    const id = String(guildId || "")
    let entries
    if (isMongoConnected()) {
        const query = { guildId: id }
        if (options.month) query.month = Number(options.month)
        entries = await BirthdayEntry.find(query).sort({ month: 1, day: 1, userId: 1 }).lean()
        entries = entries.map(normalizeEntry)
    } else {
        entries = [...fallback.entries.values()]
            .filter(entry => entry.guildId === id && (!options.month || entry.month === Number(options.month)))
            .map(normalizeEntry)
            .sort((a, b) => a.month - b.month || a.day - b.day || a.userId.localeCompare(b.userId))
    }
    return entries
}

async function removeBirthday(guildId, userId) {
    const id = String(guildId || "")
    const uid = String(userId || "")
    const existing = await getBirthday(id, uid)
    fallback.entries.delete(entryKey(id, uid))
    saveFallback()
    if (isMongoConnected()) await BirthdayEntry.deleteOne({ guildId: id, userId: uid })
    return existing
}

async function claimAnnouncement(guildId, userId, key) {
    const id = String(guildId)
    const uid = String(userId)
    if (isMongoConnected()) {
        const claimed = await BirthdayEntry.findOneAndUpdate(
            { guildId: id, userId: uid, $or: [{ lastAnnouncementKey: { $ne: key } }, { lastAnnouncementKey: null }] },
            { $set: { lastAnnouncementKey: key } },
            { new: true }
        ).lean()
        return Boolean(claimed)
    }
    const stored = fallback.entries.get(entryKey(id, uid))
    if (!stored || stored.lastAnnouncementKey === key) return false
    stored.lastAnnouncementKey = key
    fallback.entries.set(entryKey(id, uid), stored)
    saveFallback()
    return true
}

async function releaseAnnouncement(guildId, userId, key) {
    const id = String(guildId)
    const uid = String(userId)
    if (isMongoConnected()) await BirthdayEntry.updateOne({ guildId: id, userId: uid, lastAnnouncementKey: key }, { $set: { lastAnnouncementKey: null } })
    const stored = fallback.entries.get(entryKey(id, uid))
    if (stored?.lastAnnouncementKey === key) {
        stored.lastAnnouncementKey = null
        fallback.entries.set(entryKey(id, uid), stored)
        saveFallback()
    }
}

async function claimDm(userId, birthdayKey, year) {
    const deliveryKey = `${userId}:${birthdayKey}:${year}`
    if (isMongoConnected()) {
        try {
            await BirthdayDmDelivery.create({ deliveryKey, userId: String(userId), birthdayKey })
            return true
        } catch (err) {
            if (err?.code === 11000) return false
            throw err
        }
    }
    if (fallback.dmDeliveries.has(deliveryKey)) return false
    fallback.dmDeliveries.add(deliveryKey)
    saveFallback()
    return true
}

async function releaseDm(userId, birthdayKey, year) {
    const deliveryKey = `${userId}:${birthdayKey}:${year}`
    if (isMongoConnected()) await BirthdayDmDelivery.deleteOne({ deliveryKey })
    fallback.dmDeliveries.delete(deliveryKey)
    saveFallback()
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
    _models: { BirthdayEntry, BirthdayGuildConfig, BirthdayDmDelivery },
}
