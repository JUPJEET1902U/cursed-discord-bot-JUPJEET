const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const ROOT = path.resolve(__dirname, "..")

function loadCommonJs(filePath, stubs = {}) {
    const code = fs.readFileSync(filePath, "utf8")
    const module = { exports: {} }
    const wrapper = new vm.Script(`(function (require, module, exports, __filename, __dirname) {\n${code}\n})`, {
        filename: filePath,
    })
    const execute = wrapper.runInThisContext()
    const localRequire = id => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)
    execute(localRequire, module, module.exports, filePath, path.dirname(filePath))
    return module.exports
}

class FakeEmbedBuilder {
    constructor() { this.data = { fields: [] } }
    setColor(value) { this.data.color = value; return this }
    setTitle(value) { this.data.title = value; return this }
    setDescription(value) { this.data.description = value; return this }
    setTimestamp(value = new Date()) { this.data.timestamp = value; return this }
    setThumbnail(value) { this.data.thumbnail = { url: value }; return this }
    setImage(value) { this.data.image = { url: value }; return this }
    setFooter(value) { this.data.footer = value; return this }
    addFields(...values) { this.data.fields.push(...values.flat()); return this }
}

class FakeAttachmentBuilder {
    constructor(buffer, options) { this.buffer = buffer; this.name = options?.name }
}

const PermissionFlagsBits = {
    ViewChannel: 1,
    SendMessages: 2,
    EmbedLinks: 4,
    AttachFiles: 8,
}
const ChannelType = { GuildText: 0, DM: 1, GroupDM: 3, GuildAnnouncement: 5 }

function fakeChannel(id, options = {}) {
    const sends = []
    return {
        id,
        name: options.name || id,
        type: options.type ?? ChannelType.GuildText,
        sends,
        isTextBased: () => options.textBased !== false,
        permissionsFor: () => ({
            has(value) {
                if (Array.isArray(value)) return options.usable !== false
                if (value === PermissionFlagsBits.AttachFiles) return options.attachFiles !== false
                return options.usable !== false
            },
        }),
        async send(payload) {
            if (options.sendError) throw new Error(options.sendError)
            sends.push(payload)
            return { id: `${id}-message` }
        },
    }
}

function fakeMember({ configuredChannel = null, systemChannel = null } = {}) {
    const dmSends = []
    const rules = fakeChannel("333333333333333333", { name: "rules" })
    const roles = new Map([
        ["444444444444444444", { id: "444444444444444444", name: "Staff" }],
    ])
    const member = {
        id: "222222222222222222",
        displayName: "Display Name",
        joinedTimestamp: Date.UTC(2025, 0, 2),
        user: {
            id: "222222222222222222",
            username: "username",
            tag: "username#0001",
            createdTimestamp: Date.UTC(2020, 0, 1),
            displayAvatarURL: () => "https://cdn.discordapp.com/avatar.png",
        },
        async send(payload) { dmSends.push(payload); return { id: "dm-message" } },
        guild: {
            id: "111111111111111111",
            name: "Test Server",
            memberCount: 42,
            systemChannel,
            members: { me: { id: "999999999999999999" } },
            channels: {
                cache: new Map([[rules.id, rules]]),
                fetch: async () => configuredChannel,
            },
            roles: { cache: roles },
        },
        dmSends,
    }
    return member
}

function loadWelcome(options = {}) {
    let generatedCards = 0
    const exports = loadCommonJs(path.join(ROOT, "utils", "welcome.js"), {
        "discord.js": { AttachmentBuilder: FakeAttachmentBuilder, EmbedBuilder: FakeEmbedBuilder, ChannelType, PermissionFlagsBits },
        "./serverConfig": {
            getServerConfig: () => ({ data: {}, config: {} }),
            saveConfig: () => {},
        },
        "./mentionSanitizer": {
            SAFE_ALLOWED_MENTIONS: { parse: [], users: [], roles: [], repliedUser: false },
            sendSafe: (channel, payload) => channel.send(payload),
        },
        "./welcomeCard": {
            generateWelcomeCard: async () => {
                generatedCards += 1
                if (options.cardError) throw new Error(options.cardError)
                return Buffer.from("card")
            },
        },
        "./logger": { child: () => ({ warn() {}, error() {}, info() {} }) },
    })
    return { exports, getGeneratedCards: () => generatedCards }
}

test("welcome card publishes all requested themes and keeps midnight compatibility", () => {
    const card = loadCommonJs(path.join(ROOT, "utils", "welcomeCard.js"), {
        "@napi-rs/canvas": { createCanvas: () => { throw new Error("not used") }, loadImage: async () => ({}) },
        "./premium": { isGuildPremium: () => false },
    })
    const expected = ["classic", "modern", "minimal", "glass", "dark", "purple", "neon", "gold", "midnight"]
    assert.deepEqual([...card.SUPPORTED_THEMES], expected)
    for (const theme of expected) assert.equal(card.normalizeTheme(theme), theme)
    assert.equal(card.normalizeTheme("unknown"), "classic")
})

test("premium welcome-card restriction remains unchanged", async () => {
    const card = loadCommonJs(path.join(ROOT, "utils", "welcomeCard.js"), {
        "@napi-rs/canvas": { createCanvas: () => { throw new Error("must not render") }, loadImage: async () => ({}) },
        "./premium": { isGuildPremium: () => false },
    })
    await assert.rejects(
        () => card.generateWelcomeCard({ guild: {}, user: {} }),
        error => error?.code === "PREMIUM_REQUIRED"
    )
})

test("remote image validation blocks local and private destinations", async () => {
    const card = loadCommonJs(path.join(ROOT, "utils", "welcomeCard.js"), {
        "@napi-rs/canvas": { createCanvas: () => ({}), loadImage: async () => ({}) },
        "./premium": { isGuildPremium: () => true },
    })
    assert.equal(await card.validateRemoteImageUrl("http://127.0.0.1/a.png"), false)
    assert.equal(await card.validateRemoteImageUrl("http://localhost/a.png"), false)
    assert.equal(await card.validateRemoteImageUrl("https://images.example/a.png", {
        lookup: async () => [{ address: "10.0.0.7" }],
    }), false)
    assert.equal(await card.validateRemoteImageUrl("https://images.example/a.png", {
        lookup: async () => [{ address: "93.184.216.34" }],
    }), true)
})

test("remote image loader enforces content type and byte limits", async () => {
    const card = loadCommonJs(path.join(ROOT, "utils", "welcomeCard.js"), {
        "@napi-rs/canvas": { createCanvas: () => ({}), loadImage: async () => ({}) },
        "./premium": { isGuildPremium: () => true },
    })
    let decoded = false
    const image = await card.fetchRemoteImage("https://images.example/a.png", {
        lookup: async () => [{ address: "93.184.216.34" }],
        maxBytes: 64 * 1024,
        fetchImpl: async () => ({
            status: 200,
            ok: true,
            headers: { get: name => name === "content-type" ? "image/png" : String(128 * 1024) },
            arrayBuffer: async () => new ArrayBuffer(0),
        }),
        loadImageImpl: async () => { decoded = true; return {} },
    })
    assert.equal(image, null)
    assert.equal(decoded, false)
})

test("all professional placeholders resolve in messages, titles, descriptions, and footers", () => {
    const { exports: welcome } = loadWelcome()
    const member = fakeMember()
    const config = {
        rulesChannelId: "333333333333333333",
        staffRoleId: "444444444444444444",
        welcomeEmbedTitle: "Welcome {user} to {server}",
        welcomeFooter: "Joined {joinedAt} • Ask {staffRole}",
        welcomeThumbnail: false,
    }
    const template = "{user}|{username}|{mention}|{user.id}|{user.tag}|{server}|{memberCount}|{createdAt}|{joinedAt}|{rulesChannel}|{staffRole}"
    const resolved = welcome.resolvePlaceholders(template, member, config)
    for (const value of [
        "Display Name", "username", "<@222222222222222222>", "username#0001", "Test Server", "42",
        "<t:1577836800:D>", "<t:1735776000:D>", "<#333333333333333333>", "<@&444444444444444444>",
    ]) assert.match(resolved, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

    const embed = welcome._internals.buildEmbed("Hello {user} in {server}", member, config)
    assert.equal(embed.data.title, "Welcome Display Name to Test Server")
    assert.equal(embed.data.description, "Hello Display Name in Test Server")
    assert.match(embed.data.footer.text, /Ask <@&444444444444444444>/)
})

test("existing welcome configurations keep their default title and message behavior", () => {
    const { exports: welcome } = loadWelcome()
    const member = fakeMember()
    const embed = welcome.buildPreviewEmbed({ welcomeThumbnail: false }, member)
    assert.equal(embed.data.title, "👋 Welcome to Test Server!")
    assert.match(embed.data.description, /Welcome to Test Server, Display Name/)
})

test("configured channel succeeds once without system-channel or DM duplicates", async () => {
    const configured = fakeChannel("configured")
    const system = fakeChannel("system")
    const member = fakeMember({ configuredChannel: configured, systemChannel: system })
    const { exports: welcome } = loadWelcome()
    const result = await welcome.sendWelcome(member, {
        welcomeEnabled: true,
        welcomeChannelId: configured.id,
        welcomeMessage: "Welcome {user}",
        welcomeCardEnabled: false,
    }, null)
    assert.deepEqual(result, { sent: true, destination: "channel", channelId: configured.id })
    assert.equal(configured.sends.length, 1)
    assert.equal(system.sends.length, 0)
    assert.equal(member.dmSends.length, 0)
})

test("missing configured channel falls back to the usable system channel", async () => {
    const system = fakeChannel("system")
    const member = fakeMember({ configuredChannel: null, systemChannel: system })
    const { exports: welcome } = loadWelcome()
    const result = await welcome.sendWelcome(member, {
        welcomeEnabled: true,
        welcomeChannelId: "missing",
        welcomeMessage: "Welcome",
        welcomeCardEnabled: false,
    }, null)
    assert.equal(result.destination, "channel")
    assert.equal(result.channelId, system.id)
    assert.equal(system.sends.length, 1)
    assert.equal(member.dmSends.length, 0)
})

test("unusable server channels fall back to one DM", async () => {
    const configured = fakeChannel("configured", { usable: false })
    const system = fakeChannel("system", { usable: false })
    const member = fakeMember({ configuredChannel: configured, systemChannel: system })
    const { exports: welcome } = loadWelcome()
    const result = await welcome.sendWelcome(member, {
        welcomeEnabled: true,
        welcomeChannelId: configured.id,
        welcomeMessage: "Welcome",
        welcomeCardEnabled: false,
    }, null)
    assert.equal(result.destination, "dm")
    assert.equal(configured.sends.length, 0)
    assert.equal(system.sends.length, 0)
    assert.equal(member.dmSends.length, 1)
})

test("failed configured send proceeds to system channel without duplicate DM", async () => {
    const configured = fakeChannel("configured", { sendError: "Discord rejected send" })
    const system = fakeChannel("system")
    const member = fakeMember({ configuredChannel: configured, systemChannel: system })
    const { exports: welcome } = loadWelcome()
    const result = await welcome.sendWelcome(member, {
        welcomeEnabled: true,
        welcomeChannelId: configured.id,
        welcomeMessage: "Welcome",
        welcomeCardEnabled: false,
    }, null)
    assert.equal(result.channelId, system.id)
    assert.equal(system.sends.length, 1)
    assert.equal(member.dmSends.length, 0)
})

test("missing Attach Files keeps the existing embed-only fallback", async () => {
    const configured = fakeChannel("configured", { attachFiles: false })
    const member = fakeMember({ configuredChannel: configured })
    const loaded = loadWelcome()
    await loaded.exports.sendWelcome(member, {
        welcomeEnabled: true,
        welcomeChannelId: configured.id,
        welcomeMessage: "Welcome",
        welcomeCardEnabled: true,
    }, null)
    assert.equal(loaded.getGeneratedCards(), 0)
    assert.equal(configured.sends.length, 1)
    assert.equal(configured.sends[0].files, undefined)
})

test("dashboard response field set stays stable while accepting expanded themes", () => {
    const source = fs.readFileSync(path.join(ROOT, "api", "dashboardWelcome.js"), "utf8")
    assert.match(source, /const THEME_LIST = Object\.freeze\(\["classic", "modern", "minimal", "glass", "dark", "purple", "neon", "gold", "midnight"\]\)/)
    assert.match(source, /const WELCOME_FIELDS = new Set\(\[/)
    assert.doesNotMatch(source, /WELCOME_FIELDS[\s\S]{0,400}"welcomeEmbedTitle"/)
    assert.match(source, /config: premiumSafeWelcome\(saved, guild\), \.\.\.planPayload\(guild\)/)
})
