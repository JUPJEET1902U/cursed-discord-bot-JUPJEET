const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const {
    DM_SCOPE_ID,
    DM_SERVER_ONLY_MESSAGE,
    isDmCommandAllowed,
    isDmModuleAllowed,
    getDmAiControl,
} = require("../utils/dmSupport")
const { normalizePlanCommandName } = require("../utils/premiumCommandGate")

test("DM command policy allows verified private-safe commands", () => {
    for (const command of [
        "!help",
        "!trivia",
        "!story",
        "!daily",
        "!balance",
        "!shop",
        "!dailygame",
        "!guess",
        "!rps",
        "!blackjack",
        "!mines",
        "!treasure",
        "!gamble",
        "!coinflip",
        "!slots",
    ]) {
        assert.equal(isDmCommandAllowed(command), true, `${command} should work in DMs`)
    }
})

test("DM command policy blocks guild-dependent commands", () => {
    for (const command of [
        "!ban",
        "!kick",
        "!warn",
        "!welcome",
        "!ticket",
        "!duel",
        "!give",
        "!addchannel",
        "!serverinfo",
    ]) {
        assert.equal(isDmCommandAllowed(command), false, `${command} must stay server-only`)
    }
    assert.match(DM_SERVER_ONLY_MESSAGE, /isn't available in DMs/i)
    assert.match(DM_SERVER_ONLY_MESSAGE, /!help/i)
})

test("DM dispatcher only invokes audited modules", () => {
    for (const moduleName of ["help", "fun", "economy", "gambling", "games"]) {
        assert.equal(isDmModuleAllowed(moduleName), true)
    }
    for (const moduleName of ["moderation-prefix", "tickets", "birthdays", "admin", "server-insights", "custom-roles"]) {
        assert.equal(isDmModuleAllowed(moduleName), false)
    }
})

test("DM AI uses isolated memory/rate-limit scope and disables passive legacy XP", () => {
    assert.equal(DM_SCOPE_ID, "dm")
    const control = getDmAiControl()
    assert.equal(control.aiEnabled, true)
    assert.equal(control.aiMemoryEnabled, true)
    assert.equal(control.aiLongTermMemoryEnabled, true)
    assert.equal(control.aiCustomPrompt, null)
    assert.equal(control.legacyEconomyXpEnabled, false)
})

test("Premium command gate normalizes prefix command names before quota checks", () => {
    assert.equal(normalizePlanCommandName("!trivia"), "trivia")
    assert.equal(normalizePlanCommandName("!meme"), "meme")
    assert.equal(normalizePlanCommandName("/trivia"), "trivia")
    assert.equal(normalizePlanCommandName("TRIVIA"), "trivia")
})

test("Discord client is wired for direct messages without replacing guild flow", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8")
    const loaderSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "commandLoader.js"), "utf8")
    const runtimeSource = fs.readFileSync(path.join(__dirname, "..", "utils", "dmRuntime.js"), "utf8")

    assert.match(indexSource, /GatewayIntentBits\.DirectMessages/)
    assert.match(indexSource, /Partials\.Channel/)
    assert.match(indexSource, /registerDmRuntime\(client, commandModules\)/)

    // Server-management application commands must not surface as dead commands
    // in bot DMs.
    assert.match(indexSource, /InteractionContextType/)
    assert.match(indexSource, /contexts:\s*\[InteractionContextType\.Guild\]/)

    // Existing guild listener intentionally still ignores DMs; the dedicated
    // DM runtime handles them separately so server behavior is not rewritten.
    assert.match(indexSource, /if \(!message\.guild\) return/)
    assert.match(runtimeSource, /if \(message\.author\.bot \|\| message\.guild\) return/)
    assert.match(runtimeSource, /getUserMemory\(DM_SCOPE_ID, userId\)/)
    assert.match(runtimeSource, /appendUserMemory\(DM_SCOPE_ID, userId/)
    assert.match(loaderSource, /isDmCommandAllowed/)
    assert.match(loaderSource, /isDmModuleAllowed/)
})

test("DM runtime does not log private message content", () => {
    const runtimeSource = fs.readFileSync(path.join(__dirname, "..", "utils", "dmRuntime.js"), "utf8")
    assert.match(runtimeSource, /log\.info\("DM AI request"/)
    assert.doesNotMatch(runtimeSource, /aiInput\.slice/)
    assert.doesNotMatch(runtimeSource, /rawContent\.slice/)
})
