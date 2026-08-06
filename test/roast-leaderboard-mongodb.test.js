const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const originalMongoUri = process.env.MONGO_URI
delete process.env.MONGO_URI

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const roastSource = read("utils", "roast.js")
const modelSource = read("database", "roastLeaderboardModel.js")
const commandSource = read("commands", "fun.js")
const auditSource = read("docs", "roast-leaderboard-persistence-audit.md")
const roast = require("../utils/roast")

test.beforeEach(() => roast._resetForTests())
test.after(() => {
    roast._resetForTests()
    if (originalMongoUri === undefined) delete process.env.MONGO_URI
    else process.env.MONGO_URI = originalMongoUri
})

test("roast leaderboard uses one global MongoDB collection", () => {
    assert.match(modelSource, /collection:\s*"roast_leaderboard"/)
    assert.match(modelSource, /targetName:[\s\S]*unique:\s*true/)
    assert.match(modelSource, /count:[\s\S]*type:\s*Number/)
    assert.match(modelSource, /order:[\s\S]*type:\s*Number/)
    assert.doesNotMatch(modelSource, /guildId/)
})

test("roast_counts.json is retained as a read-only legacy import", () => {
    assert.match(roastSource, /roast_counts\.json/)
    assert.match(roastSource, /fs\.readFileSync\s*\(/)
    assert.doesNotMatch(roastSource, /fs\.writeFileSync\s*\(/)
    assert.doesNotMatch(roastSource, /fs\.copyFileSync\s*\(/)
    assert.doesNotMatch(roastSource, /fs\.renameSync\s*\(/)
    assert.doesNotMatch(roastSource, /fs\.unlinkSync\s*\(/)
})

test("legacy data cannot overwrite MongoDB and startup increments are queued", () => {
    assert.match(roastSource, /\$setOnInsert/)
    assert.match(roastSource, /pendingIncrements = new Map\(\)/)
    assert.match(roastSource, /\$inc:\s*\{ count: pending\.delta \}/)
    assert.match(roastSource, /Reapply those[\s\S]*increments after hydration/)
    assert.match(roastSource, /queueIncrement\(targetName, 1, orderCache\.get\(targetName\)\)/)
})

test("addRoast and getLeaderboard remain synchronous", () => {
    assert.doesNotMatch(roastSource, /async function addRoast\s*\(/)
    assert.doesNotMatch(roastSource, /async function getLeaderboard\s*\(/)
    assert.equal(roast.addRoast("Sync Target"), undefined)
    const board = roast.getLeaderboard()
    assert.ok(Array.isArray(board))
    assert.equal(typeof board.then, "undefined")
})

test("exact target-name keys and counters are preserved", () => {
    roast.addRoast("Alex")
    roast.addRoast("Alex")
    roast.addRoast("alex")

    assert.deepEqual(roast.getLeaderboard(), [
        ["Alex", 2],
        ["alex", 1],
    ])
})

test("leaderboard remains global, descending and stable for tied counts", () => {
    roast._resetForTests({ First: 2, Second: 2, Third: 3 })
    assert.deepEqual(roast.getLeaderboard(), [
        ["Third", 3],
        ["First", 2],
        ["Second", 2],
    ])
})

test("empty leaderboard still returns null", () => {
    assert.equal(roast.getLeaderboard(), null)
})

test("roast command still increments only after successful AI generation", () => {
    assert.match(commandSource, /msgLower\.startsWith\("!roast"\)/)
    assert.match(commandSource, /checkCooldown\(userId, "roast", 15 \* 1000\)/)
    assert.match(commandSource, /message\.mentions\.users\.first\(\)/)
    assert.match(commandSource, /message\.content\.slice\(6\)\.trim\(\) \|\| senderName/)

    const aiCall = commandSource.indexOf("const result = await callAI")
    const increment = commandSource.indexOf("addRoast(target)")
    assert.ok(aiCall >= 0 && increment > aiCall)
    assert.match(commandSource, /incrementStat\(userId, senderName, "roast"\)/)
    assert.match(commandSource, /updateQuestProgress\(userId, senderName, "roast"\)/)
})

test("leaderboard display contract remains unchanged", () => {
    assert.match(commandSource, /msgLower === "!leaderboard"/)
    assert.match(commandSource, /board\.slice\(0, 10\)/)
    assert.match(commandSource, /MEDALS\[i\]/)
    assert.match(commandSource, /count === 1 \? "" : "s"/)
    assert.match(commandSource, /Nobody has been roasted yet/)
    assert.match(commandSource, /CURSED ROAST LEADERBOARD/)
})

test("audit documents all persistent and runtime state", () => {
    for (const term of [
        "roast_counts.json",
        "roast_leaderboard",
        "targetName",
        "countCache",
        "orderCache",
        "pendingIncrements",
        "$setOnInsert",
        "$inc",
        "global",
        "top ten",
    ]) {
        assert.ok(auditSource.includes(term), `audit is missing ${term}`)
    }
    assert.match(auditSource, /read-only legacy import source/i)
    assert.match(auditSource, /Existing MongoDB counts[\s\S]*always win/)
})
