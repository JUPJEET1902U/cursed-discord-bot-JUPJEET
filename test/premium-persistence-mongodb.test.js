const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const premiumSource = read("utils", "premium.js")
const serverSource = read("utils", "serverPremium.js")
const auditSource = read("docs", "premium-persistence-audit.md")
const commandSource = read("commands", "premium.js")
const dashboardSource = read("api", "dashboardPremium.js")

test("Premium data uses the existing Mongo collections plus Mongo-backed codes", () => {
    assert.match(premiumSource, /collection:\s*"premiumAccounts"/)
    assert.match(premiumSource, /collection:\s*"premiumSettings"/)
    assert.match(premiumSource, /collection:\s*"premiumCodes"/)
    assert.match(serverSource, /collection:\s*"premiumGuildAccounts"/)
})

test("Premium JSON files are retained as read-only legacy imports", () => {
    for (const source of [premiumSource, serverSource]) {
        assert.match(source, /fs\.readFileSync\s*\(/)
        assert.doesNotMatch(source, /fs\.writeFileSync\s*\(/)
        assert.doesNotMatch(source, /fs\.copyFileSync\s*\(/)
    }
    assert.match(premiumSource, /premiumData\.json/)
    assert.match(premiumSource, /premiumCodes\.json/)
    assert.match(serverSource, /serverPremiumData\.json/)
})

test("legacy migration cannot overwrite MongoDB entitlement state", () => {
    assert.match(premiumSource, /\$setOnInsert/)
    assert.match(serverSource, /\$setOnInsert/)
    assert.match(premiumSource, /PremiumAccount\.find\(\{\}\)\.lean\(\)/)
    assert.match(serverSource, /PremiumGuildAccount\.find\(\{\}\)\.lean\(\)/)
    assert.doesNotMatch(premiumSource, /PremiumAccount\.find\(\{ active: true \}\)/)
    assert.doesNotMatch(serverSource, /PremiumGuildAccount\.find\(\{ active: true \}\)/)
})

test("revocation and expiry eligibility rules remain unchanged", () => {
    for (const source of [premiumSource, serverSource]) {
        assert.match(source, /if \(!account \|\| account\.active !== true\) return false/)
        assert.match(source, /if \(!account\.expiresAt\) return true/)
        assert.match(source, /new Date\(account\.expiresAt\)\.getTime\(\) > Date\.now\(\)/)
        assert.match(source, /active:\s*false/)
        assert.match(source, /revokedAt:\s*new Date\(\)/)
    }
})

test("writes made while MongoDB connects are queued", () => {
    assert.match(premiumSource, /pendingAccountWrites = new Map\(\)/)
    assert.match(premiumSource, /pendingSettingsWrite/)
    assert.match(premiumSource, /pendingCodeWrites = new Map\(\)/)
    assert.match(premiumSource, /flushPendingPremiumWrites/)
    assert.match(serverSource, /pendingGuildWrites = new Map\(\)/)
    assert.match(serverSource, /flushPendingServerPremiumWrites/)
})

test("redemption-code APIs remain synchronous and preserve return shapes", () => {
    for (const name of ["loadCodes", "saveCodes", "generateCode", "createCode", "useCode", "listCodes"]) {
        assert.match(premiumSource, new RegExp(`function ${name}\\s*\\(`))
        assert.doesNotMatch(premiumSource, new RegExp(`async function ${name}\\s*\\(`))
    }
    assert.match(premiumSource, /return \{ ok: false, reason: "invalid" \}/)
    assert.match(premiumSource, /return \{ ok: false, reason: "used" \}/)
    assert.match(premiumSource, /return \{ ok: true \}/)
    assert.match(premiumSource, /deleted:\s*true/)
})

test("plan limits and runtime quota caches remain unchanged", () => {
    assert.match(premiumSource, /aiReplyCooldownMs:\s*5_000/)
    assert.match(premiumSource, /aiReplyCooldownMs:\s*0/)
    assert.match(premiumSource, /memoryStoredMessages:\s*8/)
    assert.match(premiumSource, /memoryStoredMessages:\s*40/)
    assert.match(premiumSource, /imageUserDaily:\s*3/)
    assert.match(premiumSource, /imageUserDaily:\s*20/)
    assert.match(premiumSource, /const aiCooldowns = new Map\(\)/)
    assert.match(premiumSource, /const usageCounters = new Map\(\)/)
})

test("commands and dashboard continue using the same Premium facade", () => {
    for (const name of [
        "getPaymentSettings", "updatePaymentSettings", "grantPremiumUser",
        "revokePremiumUser", "listPremiumUsers", "grantServerPremium",
        "revokeServerPremium", "listServerPremiumAccounts",
    ]) {
        assert.ok(commandSource.includes(name), `command facade missing ${name}`)
        assert.ok(dashboardSource.includes(name), `dashboard facade missing ${name}`)
    }
})

test("the audit records all persistent and in-memory stores", () => {
    for (const term of [
        "premiumAccounts", "premiumSettings", "premiumCodes", "premiumGuildAccounts",
        "premiumData.json", "premiumCodes.json", "serverPremiumData.json",
        "accountCache", "paymentSettingsCache", "codeCache", "guildCache",
        "aiCooldowns", "usageCounters",
    ]) {
        assert.ok(auditSource.includes(term), `audit is missing ${term}`)
    }
    assert.match(auditSource, /read-only legacy import sources/i)
    assert.match(auditSource, /Existing MongoDB documents always win/)
})
