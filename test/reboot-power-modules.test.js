const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const giveaway = require("../utils/giveawayService")
const automation = require("../utils/automationStore")
const { normalizeAutomodPolicy } = require("../utils/automod")

test("giveaway durations are bounded and parse common units", () => {
    assert.equal(giveaway.parseDuration("30m"), 30 * 60 * 1000)
    assert.equal(giveaway.parseDuration("2h"), 2 * 60 * 60 * 1000)
    assert.equal(giveaway.parseDuration("3d"), 3 * 24 * 60 * 60 * 1000)
    assert.equal(giveaway.parseDuration("5s"), null)
    assert.equal(giveaway.parseDuration("forever"), null)
})

test("giveaway winner selection never duplicates entrants", () => {
    const winners = giveaway.chooseWinners(["1", "1", "2", "3", "4"], 4)
    assert.equal(new Set(winners).size, winners.length)
    assert.ok(winners.length <= 4)
    assert.ok(winners.every(id => ["1", "2", "3", "4"].includes(id)))
})

test("automation matching supports exact and contains without regex execution", () => {
    assert.equal(automation.matchesRule("hello", { trigger: "hello", mode: "exact" }), true)
    assert.equal(automation.matchesRule("hello there", { trigger: "hello", mode: "exact" }), false)
    assert.equal(automation.matchesRule("hello there", { trigger: "hello", mode: "contains" }), true)
    assert.equal(automation.matchesRule("[test]", { trigger: "[test]", mode: "exact" }), true)
})

test("automod policy is normalized and bounded", () => {
    assert.equal(normalizeAutomodPolicy({}), null)
    assert.deepEqual(normalizeAutomodPolicy({ automodPolicy: { action: "delete" } }), {
        action: "delete",
        timeoutMinutes: 1,
        timeoutMs: 60_000,
        dmUser: true,
    })
    const policy = normalizeAutomodPolicy({ automodPolicy: { action: "timeout", timeoutMinutes: 999999 } })
    assert.equal(policy.timeoutMinutes, 40320)
})

test("professional command families are wired into the unified command system", () => {
    const loader = read("handlers", "commandLoader.js")
    const powers = read("commands", "powerModules.js")
    const protection = read("commands", "protectionControl.js")
    const index = read("index.js")

    assert.match(loader, /power-modules/)
    assert.match(loader, /protection-control/)
    assert.match(powers, /setName\("autoresponder"\)/)
    assert.match(powers, /setName\("autoreact"\)/)
    assert.match(powers, /setName\("giveaway"\)/)
    assert.match(powers, /setName\("embed"\)/)
    assert.match(protection, /setName\("automod"\)/)
    assert.match(protection, /setName\("antinuke"\)/)
    assert.match(index, /startGiveawayScheduler\(client\)/)
    assert.doesNotMatch(index, /permissions=8/)
})

test("help renders configured prefixes instead of hard-coding legacy exclamation syntax", () => {
    const help = read("commands", "help.js")
    assert.match(help, /getGuildPrefix/)
    assert.match(help, /prefixAware/)
    assert.match(help, /displayCommandName/)
    assert.match(help, /Direct lookup:/)
})

test("reboot power work remains outside dashboard and deployment code", () => {
    const workflow = read(".github", "workflows", "reboot-ci.yml")
    assert.match(workflow, /dashboard\/\*\|api\/\*\|webhook\.js\|railway\.json\|Procfile/)
})
