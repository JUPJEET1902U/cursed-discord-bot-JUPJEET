const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

process.env.BOT_OWNER_IDS = "owner-1"

const command = require("../commands/ownerNetwork")
const inspector = require("../utils/ownerNetworkInspector")

function fakeCache(values = []) {
    const map = new Map(values.map(value => [value.id, value]))
    map.get = Map.prototype.get.bind(map)
    return map
}

function makeGuild(overrides = {}) {
    const ownerMember = {
        id: "111111111111111111",
        displayName: "Owner Display",
        user: {
            id: "111111111111111111",
            username: "ownername",
            tag: "ownername",
            bot: false,
        },
    }
    const botMember = {
        id: "999999999999999999",
        joinedAt: new Date("2026-01-02T00:00:00Z"),
        user: { id: "999999999999999999", username: "CURSED", tag: "CURSED", bot: true },
    }
    const members = [ownerMember, botMember]
    return {
        id: "222222222222222222",
        name: "Test @ Server`",
        ownerId: ownerMember.id,
        memberCount: members.length,
        createdAt: new Date("2025-01-01T00:00:00Z"),
        preferredLocale: "en-US",
        verificationLevel: 2,
        premiumTier: 1,
        premiumSubscriptionCount: 3,
        description: "A test server",
        features: ["COMMUNITY"],
        vanityURLCode: null,
        iconURL: () => "https://cdn.example/icon.png",
        bannerURL: () => null,
        fetchOwner: async () => ownerMember,
        fetch: async () => null,
        members: {
            me: botMember,
            cache: fakeCache(members),
            fetch: async () => fakeCache(members),
        },
        channels: {
            cache: fakeCache([
                { id: "1", type: 0 },
                { id: "2", type: 2 },
                { id: "3", type: 4 },
            ]),
        },
        roles: { cache: fakeCache([{ id: "r1" }, { id: "r2" }]) },
        emojis: { cache: fakeCache([{ id: "e1" }]) },
        stickers: { cache: fakeCache([]) },
        systemChannel: null,
        ...overrides,
    }
}

test("owner-only command gate has no admin or server-owner bypass", () => {
    assert.equal(command.isBotOwnerId("owner-1"), true)
    assert.equal(command.isBotOwnerId("someone-else"), false)
    assert.equal(command.isBotOwnerId("owner-2", ["owner-2"]), true)
    assert.deepEqual(command.parseCommand("!servermembers 123 2"), {
        name: "!servermembers",
        args: ["123", "2"],
    })
    assert.ok(command.OWNER_NETWORK_COMMANDS.has("!botservers"))
    assert.ok(command.OWNER_NETWORK_COMMANDS.has("!serverinvite"))
})

test("non-owner receives only a restricted response and no DM", async () => {
    const channelPayloads = []
    const dmPayloads = []
    const handled = await command.handle({
        content: "!serverinfo 222222222222222222",
        author: {
            id: "not-owner",
            send: async payload => dmPayloads.push(payload),
        },
        channel: {
            send: async payload => channelPayloads.push(payload),
        },
        client: { guilds: { cache: new Map() } },
    })

    assert.equal(handled, true)
    assert.equal(dmPayloads.length, 0)
    assert.equal(channelPayloads.length, 1)
    assert.match(channelPayloads[0].content, /restricted to the CURSED bot owner/i)
})

test("owner help sends sensitive output by DM and only a generic public acknowledgement", async () => {
    const channelPayloads = []
    const dmPayloads = []
    const handled = await command.handle({
        content: "!networkhelp",
        author: {
            id: "owner-1",
            send: async payload => dmPayloads.push(payload),
        },
        channel: {
            send: async payload => channelPayloads.push(payload),
        },
        client: { guilds: { cache: new Map() } },
    })

    assert.equal(handled, true)
    assert.equal(dmPayloads.length, 1)
    assert.match(dmPayloads[0].content, /Network Inspector — Owner Only/)
    assert.equal(channelPayloads.length, 1)
    assert.doesNotMatch(channelPayloads[0].content, /server-id|servermembers|serverinvite/i)
})

test("Discord DM chunking stays below the safe message size", () => {
    const chunks = command.splitDiscordContent(Array.from({ length: 80 }, (_, i) => `Line ${i}: ${"x".repeat(60)}`).join("\n"))
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every(chunk => chunk.length <= 1900))
})

test("server list and detailed report include useful information without live invite creation", async () => {
    const guild = makeGuild()
    const pages = inspector.buildServerListPages([guild], "CURSED")
    assert.equal(pages.length, 1)
    assert.match(pages[0], /Members: \*\*2\*\*/)
    assert.match(pages[0], /Channels: \*\*3\*\*/)
    assert.match(pages[0], /!serverinfo/)
    assert.doesNotMatch(pages[0], /discord\.gg/)

    const owner = await inspector.fetchOwnerSummary(guild)
    const report = inspector.buildServerInfo(guild, owner)
    assert.match(report, /Owner Display|ownername/)
    assert.match(report, /Cached breakdown: 1 humans • 1 bots/)
    assert.match(report, /Boosts: \*\*3\*\*/)
    assert.match(report, /!servermembers 222222222222222222 1/)
    assert.match(report, /!serverinvite 222222222222222222/)
    assert.doesNotMatch(report, /Test @ Server`/)
})

test("member pages are sorted, paginated, and mark bots", () => {
    const guild = makeGuild({ memberCount: 3 })
    const snapshot = {
        partial: false,
        members: [
            { displayName: "Zulu", user: { id: "1", username: "zulu", tag: "zulu", bot: false } },
            { displayName: "AlphaBot", user: { id: "2", username: "alpha", tag: "alpha", bot: true } },
            { displayName: "Alpha", user: { id: "3", username: "alpha2", tag: "alpha2", bot: false } },
        ],
    }
    const page = inspector.buildMemberPage(guild, snapshot, 1)
    assert.equal(page.page, 1)
    assert.match(page.content, /1\. \*\*Alpha\*\*/)
    assert.ok(page.content.indexOf("Zulu") < page.content.indexOf("AlphaBot"))
    assert.match(page.content, /AlphaBot\*\* 🤖/)
})

test("vanity invite is returned without creating a new invite", async () => {
    let createCalls = 0
    const guild = makeGuild({
        vanityURLCode: "safe-vanity",
        systemChannel: {
            id: "c1",
            createInvite: async () => { createCalls++; return { url: "bad" } },
            isThread: () => false,
            permissionsFor: () => ({ has: () => true }),
        },
    })
    const result = await inspector.createOwnerInvite(guild)
    assert.equal(result.source, "vanity")
    assert.equal(result.url, "https://discord.gg/safe-vanity")
    assert.equal(createCalls, 0)
})

test("created owner invite is permission-gated, one-use, one-hour, and audit-reasoned", async () => {
    let options
    const channel = {
        id: "333333333333333333",
        isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
        createInvite: async received => {
            options = received
            return { url: "https://discord.gg/generated" }
        },
    }
    const guild = makeGuild({
        systemChannel: channel,
        channels: { cache: fakeCache([channel]) },
    })

    const result = await inspector.createOwnerInvite(guild)
    assert.equal(result.created, true)
    assert.equal(result.url, "https://discord.gg/generated")
    assert.equal(options.maxAge, 3600)
    assert.equal(options.maxUses, 1)
    assert.equal(options.unique, true)
    assert.match(options.reason, /owner network inspector/i)
})

test("invite creation refuses servers where CURSED lacks permission", async () => {
    const channel = {
        id: "333333333333333333",
        isThread: () => false,
        permissionsFor: () => ({ has: () => false }),
        createInvite: async () => ({ url: "https://discord.gg/should-not-exist" }),
    }
    const guild = makeGuild({
        systemChannel: channel,
        channels: { cache: fakeCache([channel]) },
    })

    await assert.rejects(
        inspector.createOwnerInvite(guild),
        error => error.code === "OWNER_INVITE_PERMISSION_MISSING"
    )
})

test("command loader registers owner-network before legacy admin handler", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "handlers", "commandLoader.js"), "utf8")
    const ownerIndex = source.indexOf('{ name: "owner-network"')
    const adminIndex = source.indexOf('{ name: "admin"')
    assert.ok(ownerIndex >= 0)
    assert.ok(adminIndex > ownerIndex)
})

test("package exposes focused owner-network test script", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
    assert.equal(pkg.scripts["test:owner-network"], "node --test test/owner-network-inspector.test.js")
})
