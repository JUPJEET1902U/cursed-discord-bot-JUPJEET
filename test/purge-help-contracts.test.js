const assert = require("node:assert/strict")
const fs = require("node:fs")
const { PermissionFlagsBits } = require("discord.js")
const priority = require("../utils/priorityModerationCommands")
const { resolveCommandPrefix } = require("../utils/prefix")
const { COMMAND_REGISTRY } = require("../utils/helpGenerator")
const helpCatalog = require("../commands/helpCatalog")

assert.deepEqual(resolveCommandPrefix("c!purge 10", { commandPrefix: "c!" }), {
    matchedPrefix: "c!",
    configuredPrefix: "c!",
    canonicalContent: "!purge 10",
})
assert.equal(resolveCommandPrefix("!purge 10", { commandPrefix: "c!" }).canonicalContent, "!purge 10")
assert.equal(priority.commandNameFromCanonical("!purge 10"), "!purge")
assert.equal(priority.commandNameFromCanonical("!balance"), null)
assert.equal(priority.parsePurgeAmount("10", 100), 10)
assert.equal(priority.parsePurgeAmount("0", 100), null)
assert.equal(priority.parsePurgeAmount("101", 100), null)
assert.equal(priority.parsePurgeAmount("ten", 100), null)

const permissionSet = new Set([
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ReadMessageHistory,
])
const permissionState = priority.channelPermissionState({
    guild: { members: { me: { permissions: { has: () => false } } } },
    channel: { permissionsFor: () => ({ has: permission => permissionSet.has(permission) }) },
})
assert.deepEqual(permissionState, { manageMessages: true, readMessageHistory: true })
assert.match(priority.purgeFailureMessage({ code: 50013 }), /permission/i)
assert.match(priority.purgeFailureMessage({ code: 50034 }), /14 days/i)

assert.equal(helpCatalog.applyHelpCatalog(), true)
const moderationNames = COMMAND_REGISTRY.moderation.commands.map(command => command.name)
for (const name of [
    "!warn", "!timeout", "!kick", "!ban", "!purge",
    "/warn", "/warnings", "/clearwarns", "/timeout", "/untimeout",
    "/kick", "/ban", "/unban", "/case", "/cases", "/purge",
    "/lock", "/unlock", "/slowmode", "/nickname", "/tempban",
    "/softban", "/note", "/history", "/welcome", "/autorole",
]) {
    assert.ok(moderationNames.includes(name), `missing moderation help entry: ${name}`)
}
assert.equal(moderationNames.includes("!massrole"), false)
assert.equal(moderationNames.includes("!autorole"), false)
assert.equal(new Set(moderationNames).size, moderationNames.length)

const purgePrefixHelp = COMMAND_REGISTRY.moderation.commands.find(command => command.name === "!purge")
assert.match(purgePrefixHelp.usage, /^c!purge/)
assert.ok(purgePrefixHelp.botPermissions.includes("Manage Messages"))
assert.ok(purgePrefixHelp.botPermissions.includes("Read Message History"))

const automodSource = fs.readFileSync(require.resolve("../utils/automod"), "utf8")
const priorityIndex = automodSource.indexOf("handlePriorityModerationCommand(message)")
const shieldIndex = automodSource.indexOf("runSecurityMessageShield(message)")
assert.ok(priorityIndex >= 0 && shieldIndex >= 0 && priorityIndex < shieldIndex, "priority moderation must run before Message Shield")

const loaderSource = fs.readFileSync(require.resolve("../handlers/commandLoader"), "utf8")
assert.ok(loaderSource.indexOf('require("../commands/helpCatalog")') < loaderSource.indexOf('require("../commands/help")'))

console.log("purge routing and help catalog contracts passed")
