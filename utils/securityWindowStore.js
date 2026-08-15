const mongoose = require("mongoose")

const MAX_EXECUTOR_EVENTS = 200
const MAX_RAID_EVENTS = 250
const MAX_PENDING_WRITES = 1000
const RETRY_DELAYS_MS = Object.freeze([1000, 2500, 5000, 10_000, 30_000])

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const executorWindowSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    executorId: { type: String, required: true, index: true },
    events: [{
        at: { type: Date, required: true },
        eventType: { type: String, required: true },
        auditId: { type: String, default: null },
        weight: { type: Number, default: 1 },
    }],
    expiresAt: { type: Date, required: true },
}, { collection: "securityExecutorWindows", timestamps: true, minimize: false })
executorWindowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const raidWindowSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    events: [{
        at: { type: Date, required: true },
        userId: { type: String, required: true },
        joinedTimestamp: { type: Number, default: 0 },
        isBot: { type: Boolean, default: false },
        isYoung: { type: Boolean, default: false },
        riskScore: { type: Number, default: 0 },
    }],
    activeUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
}, { collection: "securityRaidWindows", timestamps: true, minimize: false })
raidWindowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const SecurityExecutorWindow = getModel("SecurityExecutorWindow", executorWindowSchema)
const SecurityRaidWindow = getModel("SecurityRaidWindow", raidWindowSchema)

const pendingWrites = []
const mutationTails = new Map()
let flushPromise = null
let retryTimer = null
let retryAttempt = 0

function mongoReady() {
    return mongoose.connection.readyState === 1
}

function safeTime(value, fallback = Date.now()) {
    const parsed = value instanceof Date ? value.getTime() : Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function pruneSecurityEvents(events, windowMs, currentTime = Date.now()) {
    const cutoff = currentTime - Math.max(1, Number(windowMs) || 1)
    return (Array.isArray(events) ? events : [])
        .map(event => ({ ...event, at: safeTime(event.at) }))
        .filter(event => event.at >= cutoff && event.at <= currentTime + 5000)
}

async function runSecurityStateMutation(key, work) {
    const normalizedKey = String(key || "global")
    const previous = mutationTails.get(normalizedKey) || Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const tail = previous.catch(() => {}).then(() => gate)
    mutationTails.set(normalizedKey, tail)
    await previous.catch(() => {})
    try {
        return await work()
    } finally {
        release()
        if (mutationTails.get(normalizedKey) === tail) mutationTails.delete(normalizedKey)
    }
}

function scheduleRetry() {
    if (retryTimer || pendingWrites.length === 0) return
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)]
    retryAttempt += 1
    retryTimer = setTimeout(() => {
        retryTimer = null
        flushPendingSecurityWindowWrites().catch(err => {
            console.error(`[SecurityWindowStore] retry flush failed: ${err.message}`)
            scheduleRetry()
        })
    }, delay)
    if (typeof retryTimer.unref === "function") retryTimer.unref()
}

function clearRetryState() {
    retryAttempt = 0
    if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
    }
}

function queuePendingWrite(write) {
    pendingWrites.push(write)
    while (pendingWrites.length > MAX_PENDING_WRITES) pendingWrites.shift()
    scheduleRetry()
}

async function persistExecutorAction(write) {
    const retentionMs = Math.max(60_000, Number(write.retentionMs) || 300_000)
    const event = {
        at: new Date(safeTime(write.event.at)),
        eventType: String(write.event.eventType || "unknown"),
        auditId: write.event.auditId ? String(write.event.auditId) : null,
        weight: Number(write.event.weight) || 1,
    }
    await SecurityExecutorWindow.updateOne(
        { key: `${write.guildId}:${write.executorId}` },
        {
            $set: {
                guildId: String(write.guildId),
                executorId: String(write.executorId),
                expiresAt: new Date(Date.now() + retentionMs + 60_000),
            },
            $push: { events: { $each: [event], $slice: -MAX_EXECUTOR_EVENTS } },
        },
        { upsert: true }
    )
}

async function persistRaidJoin(write) {
    const retentionMs = Math.max(60_000, Number(write.retentionMs) || 300_000)
    const event = {
        at: new Date(safeTime(write.event.at)),
        userId: String(write.event.userId || "unknown"),
        joinedTimestamp: Number(write.event.joinedTimestamp) || 0,
        isBot: write.event.isBot === true,
        isYoung: write.event.isYoung === true,
        riskScore: Number(write.event.riskScore) || 0,
    }
    const update = {
        $set: {
            expiresAt: new Date(Date.now() + retentionMs + 60_000),
        },
        $push: { events: { $each: [event], $slice: -MAX_RAID_EVENTS } },
        $setOnInsert: { guildId: String(write.guildId) },
    }
    if (write.activeUntil) update.$set.activeUntil = new Date(safeTime(write.activeUntil))
    await SecurityRaidWindow.updateOne({ guildId: String(write.guildId) }, update, { upsert: true })
}

async function persistRaidActiveUntil(write) {
    const activeUntil = safeTime(write.activeUntil)
    const retentionMs = Math.max(60_000, Number(write.retentionMs) || 300_000)
    await SecurityRaidWindow.updateOne(
        { guildId: String(write.guildId) },
        {
            $set: {
                activeUntil: new Date(activeUntil),
                expiresAt: new Date(Math.max(activeUntil + 60_000, Date.now() + retentionMs + 60_000)),
            },
            $setOnInsert: { guildId: String(write.guildId), events: [] },
        },
        { upsert: true }
    )
}

async function persistWrite(write) {
    if (write.kind === "executor") return persistExecutorAction(write)
    if (write.kind === "raid-join") return persistRaidJoin(write)
    if (write.kind === "raid-active") return persistRaidActiveUntil(write)
    return null
}

async function flushPendingSecurityWindowWrites() {
    if (!mongoReady()) {
        scheduleRetry()
        return false
    }
    if (flushPromise) return flushPromise
    flushPromise = (async () => {
        const batch = pendingWrites.splice(0, pendingWrites.length)
        for (const write of batch) {
            try {
                await persistWrite(write)
            } catch (err) {
                console.error(`[SecurityWindowStore] pending ${write.kind} write failed: ${err.message}`)
                pendingWrites.push(write)
            }
        }
        while (pendingWrites.length > MAX_PENDING_WRITES) pendingWrites.shift()
        if (pendingWrites.length === 0) clearRetryState()
        else scheduleRetry()
        return pendingWrites.length === 0
    })().finally(() => { flushPromise = null })
    return flushPromise
}

async function appendExecutorSecurityAction(guildId, executorId, event, retentionMs = 300_000) {
    const write = { kind: "executor", guildId: String(guildId), executorId: String(executorId), event, retentionMs }
    if (!mongoReady()) {
        queuePendingWrite(write)
        return false
    }
    try {
        await persistWrite(write)
        return true
    } catch (err) {
        console.error(`[SecurityWindowStore] executor window write failed: ${err.message}`)
        queuePendingWrite(write)
        return false
    }
}

async function loadExecutorSecurityWindow(guildId, executorId, windowMs) {
    if (!mongoReady()) return null
    const doc = await SecurityExecutorWindow.findOne({ key: `${guildId}:${executorId}` }).lean().catch(() => null)
    if (!doc) return []
    return pruneSecurityEvents(doc.events, windowMs).map(event => ({
        at: safeTime(event.at),
        eventType: String(event.eventType || "unknown"),
        auditId: event.auditId ? String(event.auditId) : null,
        weight: Number(event.weight) || 1,
    }))
}

async function loadGuildSecurityWindow(guildId, windowMs) {
    if (!mongoReady()) return null
    const docs = await SecurityExecutorWindow.find({ guildId: String(guildId) }).lean().catch(() => null)
    if (!docs) return null
    const combined = []
    for (const doc of docs) {
        for (const event of pruneSecurityEvents(doc.events, windowMs)) {
            combined.push({
                at: safeTime(event.at),
                executorId: String(doc.executorId || "unknown"),
                eventType: String(event.eventType || "unknown"),
                auditId: event.auditId ? String(event.auditId) : null,
                weight: Number(event.weight) || 1,
            })
        }
    }
    return combined.sort((a, b) => a.at - b.at).slice(-500)
}

async function appendRaidJoin(guildId, event, retentionMs, activeUntil = null) {
    const write = { kind: "raid-join", guildId: String(guildId), event, retentionMs, activeUntil }
    if (!mongoReady()) {
        queuePendingWrite(write)
        return false
    }
    try {
        await persistWrite(write)
        return true
    } catch (err) {
        console.error(`[SecurityWindowStore] raid window write failed: ${err.message}`)
        queuePendingWrite(write)
        return false
    }
}

async function setRaidActiveUntil(guildId, activeUntil, retentionMs) {
    const write = { kind: "raid-active", guildId: String(guildId), activeUntil, retentionMs }
    if (!mongoReady()) {
        queuePendingWrite(write)
        return false
    }
    try {
        await persistWrite(write)
        return true
    } catch (err) {
        console.error(`[SecurityWindowStore] raid active-state write failed: ${err.message}`)
        queuePendingWrite(write)
        return false
    }
}

async function loadRaidWindow(guildId, windowMs) {
    if (!mongoReady()) return null
    const doc = await SecurityRaidWindow.findOne({ guildId: String(guildId) }).lean().catch(() => null)
    if (!doc) return { events: [], activeUntil: 0 }
    return {
        events: pruneSecurityEvents(doc.events, windowMs).map(event => ({
            at: safeTime(event.at),
            userId: String(event.userId || "unknown"),
            joinedTimestamp: Number(event.joinedTimestamp) || 0,
            isBot: event.isBot === true,
            isYoung: event.isYoung === true,
            riskScore: Number(event.riskScore) || 0,
        })),
        activeUntil: doc.activeUntil ? safeTime(doc.activeUntil, 0) : 0,
    }
}

mongoose.connection.on("connected", () => {
    flushPendingSecurityWindowWrites().catch(err => {
        console.error(`[SecurityWindowStore] reconnect flush failed: ${err.message}`)
        scheduleRetry()
    })
})

module.exports = {
    SecurityExecutorWindow,
    SecurityRaidWindow,
    pruneSecurityEvents,
    runSecurityStateMutation,
    appendExecutorSecurityAction,
    loadExecutorSecurityWindow,
    loadGuildSecurityWindow,
    appendRaidJoin,
    setRaidActiveUntil,
    loadRaidWindow,
    flushPendingSecurityWindowWrites,
}
