const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const economySource = fs.readFileSync(path.join(root, "utils", "economy.js"), "utf8")
const modelSource = fs.readFileSync(path.join(root, "database", "economyModel.js"), "utf8")

test("economy persistence no longer writes to JSON", () => {
    assert.doesNotMatch(economySource, /writeFileSync\s*\(/)
    assert.match(economySource, /EconomyUser\.bulkWrite\s*\(/)
})

test("legacy economy data is imported without overwriting MongoDB records", () => {
    assert.match(economySource, /\$setOnInsert/)
    assert.match(economySource, /upsert:\s*true/)
})

test("economy documents preserve the complete legacy user object", () => {
    assert.match(modelSource, /mongoose\.Schema\.Types\.Mixed/)
    assert.match(modelSource, /collection:\s*"economy_users"/)
})

test("startup uses the legacy cache as a change baseline", () => {
    assert.match(economySource, /const knownSnapshots = new Map\(/)
    assert.match(economySource, /Object\.entries\(economyCache\)/)
})

test("existing synchronous economy command API remains available", () => {
    for (const functionName of ["loadEconomy", "saveEconomy", "getUser", "addXP", "addCoins", "incrementStat", "updateQuestProgress"]) {
        assert.match(economySource, new RegExp(`function ${functionName}\\(`))
    }
})

test("level calculations remain unchanged", () => {
    assert.match(economySource, /Math\.floor\(0\.1 \* Math\.sqrt\(xp\)\)/)
    assert.match(economySource, /Math\.pow\(\(level \+ 1\) \/ 0\.1, 2\)/)
})

test("shop prices and perk values remain unchanged", () => {
    const expectedEntries = [
        /"vip":\s*\{[^\n]*price:\s*500/,
        /"shield":\s*\{[^\n]*price:\s*200[^\n]*value:\s*5/,
        /"xpboost":\s*\{[^\n]*price:\s*400[^\n]*value:\s*10/,
        /"dailyboost":\s*\{[^\n]*price:\s*300[^\n]*value:\s*1/,
        /"badge":\s*\{[^\n]*price:\s*1000/,
        /"prestige":\s*\{[^\n]*price:\s*2000/,
    ]

    for (const pattern of expectedEntries) assert.match(economySource, pattern)
})
