const mongoose = require("mongoose")

const DEFAULT_FLUSH_TIMEOUT_MS = 4_000
const DEFAULT_CLOSE_TIMEOUT_MS = 1_500
const PATCHED_CLOSE = Symbol.for("cursed.persistenceClosePatched")

let guildConfigStore = null
let guildConfigWrapped = false
let gracefulCloseInstalled = false
let flushInFlight = null
const pendingGuildConfigs = new Map()

function boundedMs(value, fallback, minimum = 100, maximum = 30_000) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
}

function settleWithin(promise, timeoutMs, label) {
    let timer = null
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve({ label, status: "timeout" }), timeoutMs)
        timer.unref?.()
    })

    return Promise.race([
        Promise.resolve(promise)
            .then(value => ({ label, status: "fulfilled", value }))
            .catch(error => ({ label, status: "rejected", error })),
        timeout,
    ]).finally(() => {
        if (timer) clearTimeout(timer)
    })
}

function queueGuildConfig(guildId, config) {
    if (!guildId || !config || typeof config !== "object") return
    pendingGuildConfigs.set(String(guildId), JSON.parse(JSON.stringify(config)))

    if (mongoose.connection.readyState === 1) {
        setImmediate(() => {
            flushGuildConfigWrites().catch(err =>
                console.error("Guild config queued flush error:", err.message)
            )
        })
    }
}

async function flushGuildConfigWrites() {
    if (!guildConfigStore || pendingGuildConfigs.size === 0) return true
    if (mongoose.connection.readyState !== 1) return false

    while (pendingGuildConfigs.size > 0) {
        const batch = Array.from(pendingGuildConfigs.entries())
        for (const [guildId] of batch) pendingGuildConfigs.delete(guildId)
        let failed = false

        for (const [guildId, config] of batch) {
            try {
                await guildConfigStore.updateGuildConfigAndWait(guildId, config)
            } catch (err) {
                failed = true
                if (!pendingGuildConfigs.has(guildId)) pendingGuildConfigs.set(guildId, config)
                console.error(`[GuildConfigStore] queued save failed for ${guildId}: ${err.message}`)
            }
        }

        if (mongoose.connection.readyState !== 1 || failed) return false
    }

    try {
        await guildConfigStore.refreshMongoCache()
    } catch (err) {
        console.error(`[GuildConfigStore] post-flush refresh failed: ${err.message}`)
    }
    return true
}

function installGuildConfigQueue(store) {
    if (!store || guildConfigWrapped) return
    guildConfigStore = store
    guildConfigWrapped = true

    const originalSaveGuildConfig = store.saveGuildConfig.bind(store)
    const originalUpdateGuildConfig = store.updateGuildConfig.bind(store)
    const originalSaveAllGuildConfigs = store.saveAllGuildConfigs.bind(store)

    store.saveGuildConfig = function saveGuildConfigWithQueue(guildId, config) {
        const saved = originalSaveGuildConfig(guildId, config)
        queueGuildConfig(guildId, saved)
        return saved
    }

    store.updateGuildConfig = function updateGuildConfigWithQueue(guildId, updates = {}) {
        const saved = originalUpdateGuildConfig(guildId, updates)
        queueGuildConfig(guildId, saved)
        return saved
    }

    store.saveAllGuildConfigs = function saveAllGuildConfigsWithQueue(data) {
        const saved = originalSaveAllGuildConfigs(data)
        for (const [guildId, config] of Object.entries(saved || {})) {
            queueGuildConfig(guildId, config)
        }
        return saved
    }

    mongoose.connection.on("connected", () => {
        setImmediate(() => {
            flushGuildConfigWrites().catch(err =>
                console.error("Guild config reconnect flush error:", err.message)
            )
        })
    })
}

function loadedExports(relativePath) {
    try {
        const resolved = require.resolve(relativePath)
        return require.cache[resolved]?.exports || null
    } catch {
        return null
    }
}

function loadedQueueFlushers() {
    const candidates = [
        ["economy", "./economy", "flushEconomy"],
        ["profiles", "./profiles", "flushProfiles"],
        ["pets", "./pets", "flushPets"],
        ["short-term memory", "./memory", "flushMemory"],
        ["roast leaderboard", "./roast", "flushRoastIncrements"],
        ["birthdays", "./birthdays", "flushPendingBirthdayWrites"],
        ["Premium", "./premium", "refreshPremiumCache"],
        ["server Premium", "./serverPremium", "refreshServerPremiumCache"],
    ]

    const flushers = [{ name: "guild configuration", run: flushGuildConfigWrites }]
    for (const [name, modulePath, method] of candidates) {
        const exports = loadedExports(modulePath)
        if (typeof exports?.[method] !== "function") continue
        flushers.push({
            name,
            run: async () => {
                if (name === "birthdays" && typeof exports.stopBirthdayScheduler === "function") {
                    exports.stopBirthdayScheduler()
                }
                return exports[method]()
            },
        })
    }
    return flushers
}

async function flushPersistenceQueues(options = {}) {
    if (flushInFlight) return flushInFlight

    const timeoutMs = boundedMs(
        options.timeoutMs ?? process.env.PERSISTENCE_FLUSH_TIMEOUT_MS,
        DEFAULT_FLUSH_TIMEOUT_MS
    )
    const flushers = loadedQueueFlushers()

    flushInFlight = (async () => {
        const work = Promise.all(flushers.map(({ name, run }) =>
            Promise.resolve()
                .then(run)
                .then(value => ({ name, status: value === false ? "incomplete" : "fulfilled" }))
                .catch(error => ({ name, status: "rejected", error }))
        ))

        const outcome = await settleWithin(work, timeoutMs, "persistence flush")
        if (outcome.status === "timeout") {
            console.warn(`⚠️  Persistence flush exceeded ${timeoutMs}ms; continuing shutdown`)
            return { timedOut: true, results: [] }
        }

        const results = outcome.status === "fulfilled" ? outcome.value : []
        for (const result of results) {
            if (result.status === "rejected") {
                console.error(`Persistence flush failed (${result.name}):`, result.error?.message || result.error)
            } else if (result.status === "incomplete") {
                console.warn(`Persistence flush incomplete (${result.name})`)
            }
        }
        return { timedOut: false, results }
    })()

    try {
        return await flushInFlight
    } finally {
        flushInFlight = null
    }
}

function installGracefulMongoClose() {
    if (gracefulCloseInstalled || mongoose.connection[PATCHED_CLOSE]) return
    gracefulCloseInstalled = true
    mongoose.connection[PATCHED_CLOSE] = true

    const originalClose = mongoose.connection.close.bind(mongoose.connection)
    mongoose.connection.close = async function closeWithPersistenceFlush(...args) {
        const flushTimeoutMs = boundedMs(
            process.env.PERSISTENCE_FLUSH_TIMEOUT_MS,
            DEFAULT_FLUSH_TIMEOUT_MS
        )
        const closeTimeoutMs = boundedMs(
            process.env.MONGO_CLOSE_TIMEOUT_MS,
            DEFAULT_CLOSE_TIMEOUT_MS
        )

        await flushPersistenceQueues({ timeoutMs: flushTimeoutMs })
        const closeOutcome = await settleWithin(originalClose(...args), closeTimeoutMs, "MongoDB close")
        if (closeOutcome.status === "timeout") {
            console.warn(`⚠️  MongoDB close exceeded ${closeTimeoutMs}ms; allowing process shutdown to continue`)
            return undefined
        }
        if (closeOutcome.status === "rejected") throw closeOutcome.error
        return closeOutcome.value
    }
}

function getPersistenceHealth() {
    return {
        mongoReadyState: mongoose.connection.readyState,
        gracefulCloseInstalled,
        guildConfigQueueInstalled: guildConfigWrapped,
        pendingGuildConfigWrites: pendingGuildConfigs.size,
        loadedFlushers: loadedQueueFlushers().map(item => item.name),
    }
}

module.exports = {
    DEFAULT_FLUSH_TIMEOUT_MS,
    DEFAULT_CLOSE_TIMEOUT_MS,
    installGuildConfigQueue,
    installGracefulMongoClose,
    flushGuildConfigWrites,
    flushPersistenceQueues,
    getPersistenceHealth,
    _pendingGuildConfigs: pendingGuildConfigs,
}
