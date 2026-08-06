const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const Module = require("node:module")

const ROOT = path.resolve(__dirname, "..")

class FakeMessageFlagsBitField {
    constructor(flags = 0) { this.bitfield = Number(flags || 0) }
    add(flag) { this.bitfield |= Number(flag); return this }
    remove(flag) { this.bitfield &= ~Number(flag); return this }
}

class CommandInteraction {
    reply(options) { this.replyOptions = options; return options }
    deferReply(options) { this.deferOptions = options; return options }
    followUp(options) { this.followUpOptions = options; return options }
}
class ChatInputCommandInteraction extends CommandInteraction {}
class ContextMenuCommandInteraction extends CommandInteraction {}
class MessageComponentInteraction {
    reply(options) { this.replyOptions = options; return options }
    deferReply(options) { this.deferOptions = options; return options }
    followUp(options) { this.followUpOptions = options; return options }
}
class ButtonInteraction extends MessageComponentInteraction {}
class ModalSubmitInteraction {
    reply(options) { this.replyOptions = options; return options }
    deferReply(options) { this.deferOptions = options; return options }
    followUp(options) { this.followUpOptions = options; return options }
}

const connection = new EventEmitter()
connection.setMaxListeners(10)
const fakeMongoose = { connection }
const fakeDiscord = {
    MessageFlags: { Ephemeral: 64 },
    MessageFlagsBitField: FakeMessageFlagsBitField,
    CommandInteraction,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    MessageComponentInteraction,
    ButtonInteraction,
    ModalSubmitInteraction,
}

const guardPath = path.join(ROOT, "utils", "runtimeWarningGuards.js")
const originalLoad = Module._load
let guards
try {
    Module._load = function runtimeWarningTestLoader(request, parent, isMain) {
        if (request === "mongoose") return fakeMongoose
        if (request === "discord.js") return fakeDiscord
        return originalLoad.call(this, request, parent, isMain)
    }
    delete require.cache[require.resolve(guardPath)]
    guards = require(guardPath)
} finally {
    Module._load = originalLoad
}

test("sets a finite Mongo listener budget without registering another listener", () => {
    assert.equal(connection.getMaxListeners(), guards.MONGO_LISTENER_BUDGET)
    assert.equal(connection.listenerCount("connected"), 0)
    assert.deepEqual(guards.mongoListenerState, {
        installed: true,
        previousMax: 10,
        maxListeners: guards.MONGO_LISTENER_BUDGET,
    })
    assert.ok(guards.MONGO_LISTENER_BUDGET >= 20)
    assert.ok(guards.MONGO_LISTENER_BUDGET < 100)
})

test("Mongo listener budget installation is idempotent", () => {
    const first = guards.installMongoListenerBudget(connection)
    const second = guards.installMongoListenerBudget(connection)
    assert.strictEqual(first, second)
    assert.equal(connection.getMaxListeners(), guards.MONGO_LISTENER_BUDGET)
})

test("normalizes ephemeral true to MessageFlags.Ephemeral without mutating the caller", () => {
    const input = { content: "private", ephemeral: true }
    const output = guards.normalizeInteractionResponseOptions(input, fakeDiscord)
    assert.deepEqual(output, { content: "private", flags: 64 })
    assert.deepEqual(input, { content: "private", ephemeral: true })
})

test("merges and removes the ephemeral flag without disturbing other flags", () => {
    assert.equal(
        guards.normalizeInteractionResponseOptions({ flags: 4, ephemeral: true }, fakeDiscord).flags,
        68
    )
    assert.equal(
        guards.normalizeInteractionResponseOptions({ flags: 68, ephemeral: false }, fakeDiscord).flags,
        4
    )
})

test("patched reply, deferReply and followUp never pass ephemeral downstream", () => {
    const interaction = new ChatInputCommandInteraction()
    interaction.reply({ content: "a", ephemeral: true })
    interaction.deferReply({ ephemeral: true })
    interaction.followUp({ content: "b", ephemeral: false })

    assert.deepEqual(interaction.replyOptions, { content: "a", flags: 64 })
    assert.deepEqual(interaction.deferOptions, { flags: 64 })
    assert.deepEqual(interaction.followUpOptions, { content: "b" })
})

test("non-object interaction payloads remain unchanged", () => {
    const interaction = new ChatInputCommandInteraction()
    assert.equal(interaction.reply("hello"), "hello")
})

test("Railway and local development preload the guard before index.js", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    assert.equal(packageJson.scripts.start, "node -r ./utils/runtimeWarningGuards.js index.js")
    assert.equal(packageJson.scripts.dev, "node --watch -r ./utils/runtimeWarningGuards.js index.js")
    assert.equal(packageJson.scripts["test:runtime-warnings"], "node --test test/runtime-warning-regressions.test.js")
})

test("custom role audit keeps one TTL index without a duplicate path index", () => {
    const source = fs.readFileSync(path.join(ROOT, "utils", "customRoles.js"), "utf8")
    assert.match(source, /createdAt:\s*\{\s*type:\s*Date,\s*default:\s*Date\.now\s*\}/)
    assert.doesNotMatch(source, /createdAt:\s*\{[^}]*index:\s*true/)
    assert.equal(
        (source.match(/customRoleAuditSchema\.index\(\{\s*createdAt:\s*1\s*\}/g) || []).length,
        1
    )
    assert.match(source, /expireAfterSeconds:\s*AUDIT_TTL_SECONDS/)
})
