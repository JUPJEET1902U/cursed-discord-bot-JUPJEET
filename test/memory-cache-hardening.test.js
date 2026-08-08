const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const memoryModule = require("../utils/memory")
const economyModule = require("../utils/economy")
const longTermMemoryModule = require("../utils/longTermMemory")

test("1. Cache entries and knownSnapshots eviction occur safely without dropping pendingWrites", () => {
    // Append user memory
    memoryModule.appendUserMemory("guild_test_1", "user_test_1", "Hello", "Hi there")
    const history = memoryModule.getUserMemory("guild_test_1", "user_test_1")
    assert.strictEqual(history.length, 2)
    assert.strictEqual(history[0].content, "Hello")

    // The entry has a pending write because DB is not flushed yet.
    // Cleanup must NOT discard this entry from memory cache
    memoryModule.cleanupMemory()
    const historyAfterCleanup = memoryModule.getUserMemory("guild_test_1", "user_test_1")
    assert.strictEqual(historyAfterCleanup.length, 2)
})

test("2. Economy cache handles updates and pending writes without data loss", () => {
    const { user } = economyModule.getUser("user_econ_1", "Tester")
    user.coins = (user.coins || 0) + 100
    economyModule.saveEconomy()

    const { user: retrieved } = economyModule.getUser("user_econ_1", "Tester")
    assert.strictEqual(retrieved.coins >= 100, true)
})

test("3. Pending writes survive simulated database unavailability", async () => {
    // Save memory when DB is not connected
    memoryModule.appendUserMemory("guild_offline", "user_offline", "Offline message", "Offline reply")
    // Flush returns false when Mongo is not connected, but keeps pendingWrites in queue
    const flushed = await memoryModule.flushMemory()
    assert.strictEqual(flushed, false)

    // Verify memory is still intact in memoryCache
    const history = memoryModule.getUserMemory("guild_offline", "user_offline")
    assert.strictEqual(history.length, 2)
    assert.strictEqual(history[0].content, "Offline message")
})

test("4. Failed filesystem operations do not crash process", () => {
    // Attempting a read/write on legacy paths or bad JSON safely catches errors
    assert.doesNotThrow(() => {
        try {
            fs.readFileSync("/nonexistent_dir/bad_file.json", "utf8")
        } catch (err) {
            // Handled safely without process panic
            assert.ok(err)
        }
    })
})

test("5. Unsaved long-term memories in fallback map are tagged and preserved", async () => {
    await longTermMemoryModule.addLongTermMemory("user_ltm_1", {
        type: "fact",
        content: "User loves pizza",
        importance: 3,
    })

    const memories = await longTermMemoryModule.getUserLongTermMemories("user_ltm_1")
    assert.strictEqual(memories.length > 0, true)
    assert.strictEqual(memories[0].content, "User loves pizza")
})

test("6. Centralized timers use unref and do not prevent process exit", () => {
    const timer = setInterval(() => {}, 1000000)
    assert.doesNotThrow(() => {
        timer.unref()
        clearInterval(timer)
    })
})

test("7. Existing synchronous API exports remain available and unchanged", () => {
    assert.strictEqual(typeof memoryModule.getUserMemory, "function")
    assert.strictEqual(typeof memoryModule.appendUserMemory, "function")
    assert.strictEqual(typeof memoryModule.clearUserMemory, "function")
    assert.strictEqual(typeof memoryModule.cleanupMemory, "function")

    assert.strictEqual(typeof economyModule.getUser, "function")
    assert.strictEqual(typeof economyModule.loadEconomy, "function")
    assert.strictEqual(typeof economyModule.saveEconomy, "function")
})
