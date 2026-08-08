const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const giveaway = require("../utils/giveawayService")
const automation = require("../utils/automationStore")
const customCommands = require("../utils/customCommandStore")
const autoroles = require("../utils/autoroleAdvanced")
const reactionRoles = require("../utils/reactionRoleService")
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

test("custom command names are bounded and placeholders render without mentions", () => {
    assert.deepEqual(customCommands.validateName("rules"), { ok: true, name: "rules" })
    assert.equal(customCommands.validateName("bad name").ok, false)
    const rendered = customCommands.renderCustomResponse("Hi {user} in {server} / {channel}", {
        author: { username: "J" },
        member: { displayName: "Jupjeet" },
        guild: { name: "CURSED Lab" },
        channel: { name: "general" },
    })
    assert.equal(rendered, "Hi Jupjeet in CURSED Lab / #general")
})

test("advanced autorole configuration separates humans and bots", () => {
    assert.deepEqual(autoroles.normalizeAdvancedAutorole({ humanRoleIds: ["12345678901234567"], botRoleIds: ["22345678901234567"] }), {
        enabled: true,
        humanRoleIds: ["12345678901234567"],
        botRoleIds: ["22345678901234567"],
    })
    assert.equal(autoroles.MAX_AUTOROLES_PER_TYPE, 10)
})

test("reaction-role panel components are bounded to Discord row limits", () => {
    const options = Array.from({ length: 20 }, (_, index) => ({ roleId: String(10000000000000000n + BigInt(index)), label: `Role ${index + 1}` }))
    const rows = reactionRoles.panelComponents({ panelId: "abc123", options })
    assert.equal(rows.length, 4)
    assert.ok(rows.every(row => row.components.length <= 5))
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
    const custom = read("commands", "customCommands.js")
    const roles = read("commands", "reactionRoles.js")
    const index = read("index.js")

    assert.match(loader, /power-modules/)
    assert.match(loader, /protection-control/)
    assert.match(loader, /autorole-control/)
    assert.match(loader, /reaction-roles/)
    assert.match(loader, /custom-command-admin/)
    assert.match(powers, /setName\("autoresponder"\)/)
    assert.match(powers, /setName\("autoreact"\)/)
    assert.match(powers, /setName\("giveaway"\)/)
    assert.match(powers, /setName\("embed"\)/)
    assert.match(protection, /setName\("automod"\)/)
    assert.match(protection, /setName\("antinuke"\)/)
    assert.match(custom, /setName\("customcommand"\)/)
    assert.match(roles, /setName\("reactionrole"\)/)
    assert.match(index, /startGiveawayScheduler\(client\)/)
    assert.match(index, /assignJoinRoles\(member\)/)
    assert.doesNotMatch(index, /permissions=8/)
})

test("all Reboot slash command builders serialize with unique names", () => {
    require("../handlers/commandLoader").loadCommands()
    const moderation = require("../commands/moderation")
    const payloads = moderation.commands.map(command => command.toJSON())
    const names = payloads.map(command => command.name)
    assert.equal(new Set(names).size, names.length)
    for (const expected of ["automod", "antinuke", "autoresponder", "autoreact", "giveaway", "embed", "customcommand", "reactionrole", "autorole"]) {
        assert.ok(names.includes(expected), `missing slash command: ${expected}`)
    }
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
