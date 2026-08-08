process.env.NODE_ENV = "test"
delete process.env.MONGO_URI

const test = require("node:test")
const assert = require("node:assert/strict")

const memoryModule = require("../utils/memory")
const economyModule = require("../utils/economy")
const longTermMemoryModule = require("../utils/longTermMemory")

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

test("1. Memory and economy snapshots do not create false repeat writes", async () => {
    const memState = memoryModule.__testing.getState()
    const econState = economyModule.__testing.getState()

    const memKey = "guild_snapshot:user_snapshot"
    memoryModule.appendUserMemory("guild_snapshot", "user_snapshot", "Hello", "Hi")
    assert.equal(memState.pendingWrites.has(memKey), true)

    // Simulate a successful persistence cycle while keeping the current snapshot.
    memState.pendingWrites.delete(memKey)
    await memoryModule.saveMemory()
    assert.equal(memState.pendingWrites.has(memKey), false)

    const { user } = economyModule.getUser("user_econ_snapshot", "SnapshotTester")
    user.coins = 500
    await economyModule.saveEconomy()
    assert.equal(econState.pendingWrites.has("user_econ_snapshot"), true)

    econState.pendingWrites.delete("user_econ_snapshot")
    await economyModule.saveEconomy()
    assert.equal(econState.pendingWrites.has("user_econ_snapshot"), false)
})

test("2. Pending short-term memory writes survive database unavailability", async () => {
    const state = memoryModule.__testing.getState()
    const key = "guild_offline:user_offline"

    memoryModule.appendUserMemory("guild_offline", "user_offline", "Offline message", "Offline reply")
    const flushed = await memoryModule.flushMemory()

    assert.equal(flushed, false)
    assert.equal(state.pendingWrites.has(key), true)
    assert.equal(Array.isArray(state.memoryCache[key]), true)
    assert.equal(state.memoryCache[key][0].content, "Offline message")
})

test("3. Long-term fallback sync is single-flight and marks data saved only after persistence", async () => {
    const hooks = longTermMemoryModule.__testing
    const state = hooks.getFallbackState()
    state.memoryFallback.clear()
    state.fallbackLastAccess.clear()

    hooks.setMongoConnected(false)
    await longTermMemoryModule.addLongTermMemory("user_ltm_concurrency", {
        type: "fact",
        content: "User prefers dark mode",
        importance: 4,
    })

    const list = state.memoryFallback.get("user_ltm_concurrency")
    assert.ok(list && list.length === 1)
    assert.equal(list[0]._unsaved, true)

    const gate = deferred()
    let updateCalls = 0
    hooks.setMemoryModel({
        updateOne: async () => {
            updateCalls++
            await gate.promise
            return { acknowledged: true }
        },
    })
    hooks.setMongoConnected(true)

    const sync1 = hooks.syncFallbackToMongo()
    const sync2 = hooks.syncFallbackToMongo()
    assert.equal(sync1, sync2, "concurrent callers must share one in-flight sync")

    gate.resolve()
    await Promise.all([sync1, sync2])

    assert.equal(updateCalls, 1)
    assert.equal(list[0]._unsaved, false)

    hooks.resetMemoryModel()
    hooks.setMongoConnected(false)
})

test("4. A fallback entry changed during persistence remains unsaved for the next sync", async () => {
    const hooks = longTermMemoryModule.__testing
    const state = hooks.getFallbackState()
    state.memoryFallback.clear()
    state.fallbackLastAccess.clear()

    hooks.setMongoConnected(false)
    await longTermMemoryModule.addLongTermMemory("user_ltm_race", {
        type: "fact",
        content: "User likes blue",
        importance: 3,
    })

    const entry = state.memoryFallback.get("user_ltm_race")[0]
    const gate = deferred()
    let updateCalls = 0
    hooks.setMemoryModel({
        updateOne: async () => {
            updateCalls++
            if (updateCalls === 1) await gate.promise
            return { acknowledged: true }
        },
    })
    hooks.setMongoConnected(true)

    const firstSync = hooks.syncFallbackToMongo()

    // Simulate a newer local update arriving while the first database write is in flight.
    entry.content = "User likes navy blue"
    entry._unsaved = true
    entry._syncVersion += 1

    gate.resolve()
    await firstSync
    assert.equal(entry._unsaved, true, "newer local data must not be marked saved by an older write")

    await hooks.syncFallbackToMongo()
    assert.equal(entry._unsaved, false)
    assert.equal(updateCalls, 2)

    hooks.resetMemoryModel()
    hooks.setMongoConnected(false)
})

test("5. Fallback trimming never discards unsaved long-term memory", () => {
    const hooks = longTermMemoryModule.__testing

    const allUnsaved = Array.from({ length: 101 }, (_, index) => ({
        content: `unsaved-${index}`,
        _unsaved: true,
    }))
    hooks.trimFallbackListSafely("user_all_unsaved", allUnsaved)
    assert.equal(allUnsaved.length, 101, "unsaved entries must be retained even above the soft cap")

    const mixed = [
        ...Array.from({ length: 10 }, (_, index) => ({ content: `persisted-${index}`, _unsaved: false })),
        ...Array.from({ length: 95 }, (_, index) => ({ content: `pending-${index}`, _unsaved: true })),
    ]
    hooks.trimFallbackListSafely("user_mixed", mixed)
    assert.equal(mixed.length, 100)
    assert.equal(mixed.filter(item => item._unsaved).length, 95)
})

test("6. The actual long-term cleanup timer is non-blocking", () => {
    const timer = longTermMemoryModule.__testing.getCleanupInterval()
    assert.ok(timer)
    if (typeof timer.hasRef === "function") {
        assert.equal(timer.hasRef(), false)
    }
})

test("7. Snapshot fingerprints are stable for unchanged data and change with state", () => {
    const memFingerprint = memoryModule.__testing.snapshotFingerprint
    const econFingerprint = economyModule.__testing.snapshotFingerprint

    const history = [{ role: "user", content: "hello" }]
    assert.equal(memFingerprint(history), memFingerprint(history))
    assert.notEqual(memFingerprint(history), memFingerprint([...history, { role: "assistant", content: "hi" }]))

    const economy = { coins: 100, xp: 5 }
    assert.equal(econFingerprint(economy), econFingerprint(economy))
    assert.notEqual(econFingerprint(economy), econFingerprint({ coins: 101, xp: 5 }))
})

test("8. Existing public synchronous APIs remain available", () => {
    assert.equal(typeof memoryModule.getUserMemory, "function")
    assert.equal(typeof memoryModule.appendUserMemory, "function")
    assert.equal(typeof memoryModule.clearUserMemory, "function")
    assert.equal(typeof memoryModule.cleanupMemory, "function")

    assert.equal(typeof economyModule.getUser, "function")
    assert.equal(typeof economyModule.loadEconomy, "function")
    assert.equal(typeof economyModule.saveEconomy, "function")

    assert.equal(typeof longTermMemoryModule.getUserLongTermMemories, "function")
    assert.equal(typeof longTermMemoryModule.addLongTermMemory, "function")
})
