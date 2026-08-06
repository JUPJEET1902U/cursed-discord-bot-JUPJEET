const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const memorySource = read("utils", "memory.js")
const modelSource = read("database", "shortTermMemoryModel.js")
const commandSource = read("commands", "memory.js")
const indexSource = read("index.js")

test("short-term memory uses a dedicated MongoDB collection", () => {
    assert.match(modelSource, /memoryKey:\s*\{/)
    assert.match(modelSource, /unique:\s*true/)
    assert.match(modelSource, /messages:\s*\{/)
    assert.match(modelSource, /mongoose\.Schema\.Types\.Mixed/)
    assert.match(modelSource, /collection:\s*"short_term_memories"/)
})

test("memory.json is retained as a read-only legacy import source", () => {
    assert.match(memorySource, /LEGACY_MEMORY_PATH\s*=\s*path\.resolve\(__dirname, "\.\.", "memory\.json"\)/)
    assert.match(memorySource, /fs\.readFileSync\(LEGACY_MEMORY_PATH, "utf8"\)/)
    assert.doesNotMatch(memorySource, /fs\.writeFileSync\s*\(/)
    assert.doesNotMatch(memorySource, /fs\.copyFileSync\s*\(/)
})

test("legacy import is idempotent and cannot overwrite MongoDB", () => {
    assert.match(memorySource, /ShortTermMemory\.bulkWrite/)
    assert.match(memorySource, /\$setOnInsert:\s*\{\s*memoryKey,\s*messages:/)
    assert.match(memorySource, /upsert:\s*true/)
    assert.match(memorySource, /ShortTermMemory\.find\(\{\}\)\.lean\(\)/)
    assert.match(memorySource, /if \(!pendingWrites\.has\(key\)\)/)
})

test("existing synchronous memory API names remain available", () => {
    for (const name of ["getUserMemory", "appendUserMemory", "clearUserMemory", "cleanupMemory"]) {
        assert.match(memorySource, new RegExp(`function ${name}\\s*\\(`))
        assert.doesNotMatch(memorySource, new RegExp(`async function ${name}\\s*\\(`))
        assert.ok(memorySource.includes(name), `missing export ${name}`)
    }
})

test("memory limits and Premium fallbacks remain unchanged", () => {
    assert.match(memorySource, /const MAX_MEMORY = 40/)
    assert.match(memorySource, /const MAX_CONTEXT = 20/)
    assert.match(memorySource, /memoryStoredMessages:\s*8/)
    assert.match(memorySource, /memoryContextMessages:\s*4/)
    assert.match(memorySource, /Math\.max\(0, Math\.min\(max, Math\.floor\(parsed\)\)\)/)
})

test("message ordering and trimming behavior remain unchanged", () => {
    const userPush = memorySource.indexOf('push({ role: "user", content: userMsg })')
    const assistantPush = memorySource.indexOf('push({ role: "assistant", content: botReply })')
    assert.ok(userPush >= 0, "user message append is missing")
    assert.ok(assistantPush > userPush, "assistant message must follow user message")
    assert.match(memorySource, /if \(mem\[key\]\.length > limit\) mem\[key\] = mem\[key\]\.slice\(-limit\)/)
    assert.match(memorySource, /if \(mem\[key\]\.length > MAX_MEMORY\) \{\s*mem\[key\] = mem\[key\]\.slice\(-MAX_MEMORY\)/)
})

test("context ordering and guild-user isolation remain unchanged", () => {
    assert.match(memorySource, /return `\$\{guildId\}:\$\{userId\}`/)
    assert.match(memorySource, /const history = mem\[memKey\(guildId, userId\)\] \|\| \[\]/)
    assert.match(memorySource, /return limit === 0 \? \[\] : history\.slice\(-limit\)/)
})

test("clear and cleanup operations persist MongoDB deletions", () => {
    assert.match(memorySource, /delete mem\[memKey\(guildId, userId\)\]/)
    assert.match(memorySource, /pendingWrites\.set\(key, DELETE_MEMORY\)/)
    assert.match(memorySource, /deleteOne:\s*\{\s*filter:\s*\{ memoryKey \}\s*\}/)
    assert.match(memorySource, /if \(!Array\.isArray\(mem\[key\]\) \|\| mem\[key\]\.length === 0\)/)
})

test("AI integration and !clearmemory behavior remain unchanged", () => {
    assert.match(indexSource, /const userHistory = control\.aiMemoryEnabled \? getUserMemory\(guildId, userId\) : \[\]/)
    assert.match(indexSource, /appendUserMemory\(guildId, userId, currentUserMsg, safeOutput\)/)
    assert.match(commandSource, /if \(msgLower === "!clearmemory"\)/)
    assert.match(commandSource, /await clearLongTermMemories\(userId\)/)
    assert.match(commandSource, /clearUserMemory\(message\.guild\.id, userId\)/)
    assert.match(commandSource, /I've wiped ALL memories about you — both short-term and long-term/)
})
