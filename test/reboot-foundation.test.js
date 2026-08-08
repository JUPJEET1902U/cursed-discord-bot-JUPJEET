const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

process.env.NODE_ENV = "test"

const product = require("../utils/productSystem")
const ui = require("../utils/responseBuilder")
const { evaluateJoinRisk, suspiciousUsername } = require("../utils/antiRaidRisk")
const { selectCandidate } = require("../utils/auditLogResolver")
const { TRUSTED_SCOPES } = require("../utils/securityPhase3Config")
const { recordTiming, getMetric, resetMetrics } = require("../utils/runtimeMetrics")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

test("Reboot product hierarchy stays small and deterministic", () => {
    const categories = [
        { key: "moderation", name: "🛡️ Moderation", commands: [{ name: "/ban" }] },
        { key: "economy", name: "💰 Economy", commands: [{ name: "!daily" }] },
        { key: "memory", name: "🧠 Memory", commands: [{ name: "!remember" }] },
    ]
    const groups = product.groupCategories(categories)
    assert.ok(groups.length <= product.SECTION_DEFINITIONS.length)
    assert.ok(groups.find(group => group.name === "Server Management"))
    assert.ok(groups.find(group => group.name === "Economy & Games"))
    assert.ok(groups.every(group => group.categories.every(category => !/^[^\p{L}\p{N}]+/u.test(category.name))))
})

test("shared embeds enforce bounded clean fields and safe status language", () => {
    const embed = ui.moderation("Moderation result", null, {
        fields: [{ name: "User", value: "Example", inline: true }],
    }).toJSON()
    assert.equal(embed.footer.text, "CURSED • Moderation")
    assert.equal(embed.fields[0].name, "User")
    assert.match(ui.commandDisabled(), /^❌ /)
    assert.match(ui.invalidUsage("!test [value]"), /^⚠️ /)
})

test("Anti-Raid uses existing account, avatar and username risk settings", () => {
    const now = Date.parse("2026-08-08T12:00:00Z")
    const member = {
        user: {
            createdTimestamp: now - 2 * 60 * 60 * 1000,
            username: "free_nitro_99999999",
            avatar: null,
        },
    }
    const result = evaluateJoinRisk(member, {
        minAccountAgeHours: 72,
        requireAvatar: true,
        suspiciousNameCheck: true,
        riskScoreThreshold: 2,
    }, {
        joinCount: 4,
        raidAlreadyActive: true,
        thresholdReached: false,
        nowMs: now,
    })
    assert.ok(result.score >= 4)
    assert.equal(result.shouldAction, true)
    assert.ok(result.reasons.includes("new account"))
    assert.ok(result.reasons.includes("no custom avatar"))
    assert.equal(suspiciousUsername("free_nitro_99999999"), true)
})

test("audit resolver candidate selection requires recency and target match", () => {
    const now = 10_000
    const entries = [
        { id: "old", createdTimestamp: 1_000, targetId: "A" },
        { id: "wrong", createdTimestamp: 9_900, targetId: "B" },
        { id: "right", createdTimestamp: 9_800, targetId: "A" },
    ]
    assert.equal(selectCandidate(entries, { targetId: "A", maxAgeMs: 2_000, nowMs: now }).id, "right")
    assert.equal(selectCandidate(entries, { targetId: "C", maxAgeMs: 2_000, nowMs: now }), null)
})

test("security trust model includes a dedicated server-management scope", () => {
    assert.ok(TRUSTED_SCOPES.includes("manageGuild"))
})

test("runtime metrics are bounded summaries and do not require identifiers", () => {
    resetMetrics()
    recordTiming("security.response", 10)
    recordTiming("security.response", 30)
    const metric = getMetric("security.response")
    assert.equal(metric.count, 2)
    assert.equal(metric.averageMs, 20)
    assert.equal(metric.maxMs, 30)
})

test("AI reliability no longer imports provider clients from aiLegacy", () => {
    const reliability = read("utils", "aiProviderReliability.js")
    const clients = read("utils", "aiClients.js")
    assert.doesNotMatch(reliability, /require\(["']\.\/aiLegacy["']\)/)
    assert.match(reliability, /require\(["']\.\/aiClients["']\)/)
    assert.match(clients, /gemini-2\.0-flash/)
    assert.match(clients, /llama-3\.1-8b-instant/)
    assert.match(clients, /mistralai\/mistral-7b-instruct/)
})

test("dashboard and deployment code are not dependencies of Reboot foundations", () => {
    for (const file of [
        "utils/productSystem.js",
        "utils/responseBuilder.js",
        "utils/auditLogResolver.js",
        "utils/antiRaidRisk.js",
        "utils/runtimeMetrics.js",
    ]) {
        const source = read(...file.split("/"))
        assert.doesNotMatch(source, /dashboard\/src|railway\.json|api\/dashboard/i)
    }
})
