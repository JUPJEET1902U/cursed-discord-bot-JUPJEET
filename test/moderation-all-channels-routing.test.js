const assert = require("node:assert/strict")
const fs = require("node:fs")
const priority = require("../utils/priorityModerationCommands")

const expectedGlobalModeration = [
    "!warn", "!warnings", "!clearwarns", "!timeout", "!mute", "!untimeout", "!unmute",
    "!kick", "!ban", "!unban", "!case", "!cases", "!purge", "!lock", "!unlock",
    "!slowmode", "!nickname", "!tempban", "!softban", "!note", "!history",
]

assert.deepEqual(
    [...priority.GLOBAL_MODERATION_COMMANDS].sort(),
    [...expectedGlobalModeration].sort(),
    "only the deployed moderation prefix suite may bypass channel restrictions"
)

for (const command of expectedGlobalModeration) {
    assert.equal(priority.commandNameFromCanonical(`${command} test`), command)
}

for (const command of [
    "!balance", "!shop", "!buy", "!imagine", "!meme", "!profile", "!rank",
    "!server", "!stats", "!ticket", "!help", "!daily", "!work",
]) {
    assert.equal(
        priority.commandNameFromCanonical(`${command} test`),
        null,
        `${command} must remain behind the !addchannel restriction`
    )
}

const automodSource = fs.readFileSync(require.resolve("../utils/automod"), "utf8")
const priorityIndex = automodSource.indexOf("handlePriorityModerationCommand(message)")
const shieldIndex = automodSource.indexOf("runSecurityMessageShield(message)")
assert.ok(priorityIndex >= 0 && shieldIndex >= 0 && priorityIndex < shieldIndex)

const indexSource = fs.readFileSync(require.resolve("../index"), "utf8")
const automodIndex = indexSource.indexOf("runAutoMod(message)")
const channelGateIndex = indexSource.indexOf("if (!isChannelAllowed(guildId, channelId)) return")
const dispatchIndex = indexSource.indexOf("dispatchCommand(message, commandModules)")
const aiMentionIndex = indexSource.indexOf("const botMentioned =")

assert.ok(automodIndex >= 0, "AutoMod/global moderation gate missing")
assert.ok(channelGateIndex > automodIndex, "global moderation must run before the channel allow-list")
assert.ok(dispatchIndex > channelGateIndex, "normal prefix commands must remain behind the channel allow-list")
assert.ok(aiMentionIndex > channelGateIndex, "AI chat must remain behind the channel allow-list")

const prioritySource = fs.readFileSync(require.resolve("../utils/priorityModerationCommands"), "utf8")
assert.match(prioritySource, /if \(!match\) return false/)
assert.match(prioritySource, /if \(!handled\)[\s\S]*return true/)
assert.match(prioritySource, /catch \(error\)[\s\S]*return true/)
assert.doesNotMatch(prioritySource, /isChannelAllowed/)

console.log("moderation-only all-channel routing contracts passed")
