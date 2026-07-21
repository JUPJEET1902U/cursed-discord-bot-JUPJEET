const assert = require("node:assert/strict")
const { resolveCommandPrefix } = require("../utils/prefix")
const priority = require("../utils/priorityModerationCommands")
const bridge = require("../commands/moderationPrefixBridge")
const catalog = require("../commands/prefixCommandCatalog")
const publicStats = require("../commands/publicStatsStatus")
const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const expectedCommands = [
    "!warn", "!warnings", "!clearwarns", "!timeout", "!mute", "!untimeout", "!unmute",
    "!kick", "!ban", "!unban", "!case", "!cases", "!purge", "!lock", "!unlock",
    "!slowmode", "!nickname", "!tempban", "!softban", "!note", "!history",
]

for (const command of expectedCommands) {
    assert.ok(priority.PRIORITY_COMMANDS.has(command), `missing priority command: ${command}`)
}
assert.equal(new Set(priority.PRIORITY_COMMANDS).size, expectedCommands.length)
assert.equal(priority.commandNameFromCanonical("!history <@123456789012345678>"), "!history")
assert.equal(priority.commandNameFromCanonical("!balance"), null)

assert.deepEqual(resolveCommandPrefix("x!history <@123456789012345678>", { commandPrefix: "x!" }), {
    matchedPrefix: "x!",
    configuredPrefix: "x!",
    canonicalContent: "!history <@123456789012345678>",
})
assert.equal(resolveCommandPrefix("c!server stats", { commandPrefix: "x!" }).canonicalContent, "!server stats")
assert.equal(resolveCommandPrefix("!server stats", { commandPrefix: "x!" }).canonicalContent, "!server stats")

assert.deepEqual(
    bridge.tokenizeArguments('<@123456789012345678> "New Name" Staff request'),
    ["<@123456789012345678>", "New Name", "Staff", "request"]
)
assert.equal(bridge.parseDurationToMinutes("2h"), 120)
assert.equal(bridge.parseDurationToMinutes("28d"), 40320)
assert.equal(bridge.parseDurationToMinutes("29d"), null)
assert.equal(bridge.parseDurationToMinutes("52w", 525600), 524160)
assert.equal(bridge.parseInteger("10", 1, 20), 10)
assert.equal(bridge.parseInteger("21", 1, 20), null)

assert.equal(catalog.applyPrefixCommandCatalog(), true)
const moderationNames = COMMAND_REGISTRY.moderation.commands.map(command => command.name)
for (const command of expectedCommands) {
    assert.ok(moderationNames.includes(command), `missing moderation help command: ${command}`)
}
assert.equal(new Set(moderationNames).size, moderationNames.length)
assert.ok(COMMAND_REGISTRY.server.commands.some(command => command.name === "!server"))
assert.ok(COMMAND_REGISTRY.server.commands.some(command => command.name === "/stats"))

assert.equal(publicStats.isPublicStatsPrefix("!server stats"), true)
assert.equal(publicStats.isPublicStatsPrefix("!stats status"), true)
assert.equal(publicStats.isPublicStatsPrefix("!server info"), false)

console.log("complete moderation prefix and public server stats contracts passed")
