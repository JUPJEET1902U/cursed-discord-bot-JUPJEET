const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const {
    MAX_INLINE_IMAGE_BYTES,
    isPrivateAddress,
    validateRemoteImageUrl,
    parseInlineImage,
    fetchRemoteImage,
} = require("../utils/serverAppearanceMedia")
const { BIO_MAX_LENGTH, validateAppearance } = require("../api/dashboardAppearance")

const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk6sAAAAASUVORK5CYII=",
    "base64"
)

function inlinePng(buffer = ONE_PIXEL_PNG) {
    return `data:image/png;base64,${buffer.toString("base64")}`
}

function headers(values = {}) {
    const map = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]))
    return { get: key => map.get(String(key).toLowerCase()) || null }
}

test("appearance validation allows partial avatar, banner, and bio updates", () => {
    assert.deepEqual(validateAppearance({ avatar: "https://cdn.example.com/avatar.png" }), {})
    assert.deepEqual(validateAppearance({ banner: null }), {})
    assert.deepEqual(validateAppearance({ bio: "CURSED protects this server." }), {})
})

test("appearance validation rejects unknown fields, empty updates, and oversized bio", () => {
    assert.ok(validateAppearance({}).body)
    assert.ok(validateAppearance({ nickname: "CURSED" }).nickname)
    assert.ok(validateAppearance({ bio: "x".repeat(BIO_MAX_LENGTH + 1) }).bio)
})

test("inline upload accepts a bounded matching PNG data URI", () => {
    const parsed = parseInlineImage(inlinePng())
    assert.ok(Buffer.isBuffer(parsed))
    assert.equal(parsed.equals(ONE_PIXEL_PNG), true)
})

test("inline upload rejects MIME mismatch and oversized data", () => {
    const mismatch = `data:image/jpeg;base64,${ONE_PIXEL_PNG.toString("base64")}`
    assert.throws(() => parseInlineImage(mismatch), /does not match/i)

    const oversized = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(MAX_INLINE_IMAGE_BYTES),
    ])
    assert.throws(() => parseInlineImage(inlinePng(oversized)), /too large/i)
})

test("remote URL validation requires public HTTPS and blocks private networks", async () => {
    const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }]
    assert.equal(await validateRemoteImageUrl("https://example.com/a.png", { lookup: publicLookup }), true)
    assert.equal(await validateRemoteImageUrl("http://example.com/a.png", { lookup: publicLookup }), false)
    assert.equal(await validateRemoteImageUrl("https://127.0.0.1/a.png", { lookup: publicLookup }), false)
    assert.equal(await validateRemoteImageUrl("https://localhost/a.png", { lookup: publicLookup }), false)
    assert.equal(await validateRemoteImageUrl("https://example.com/a.png", { lookup: async () => [{ address: "10.0.0.5", family: 4 }] }), false)
    assert.equal(isPrivateAddress("169.254.1.1"), true)
    assert.equal(isPrivateAddress("93.184.216.34"), false)
})

test("remote image fetch validates MIME and returned bytes", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }]
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        headers: headers({ "content-type": "image/png", "content-length": ONE_PIXEL_PNG.length }),
        arrayBuffer: async () => ONE_PIXEL_PNG,
    })
    const buffer = await fetchRemoteImage("https://example.com/a.png", { fetchImpl, lookup })
    assert.equal(buffer.equals(ONE_PIXEL_PNG), true)

    const wrongMime = async () => ({
        ok: true,
        status: 200,
        headers: headers({ "content-type": "text/html" }),
        arrayBuffer: async () => ONE_PIXEL_PNG,
    })
    await assert.rejects(() => fetchRemoteImage("https://example.com/a.png", { fetchImpl: wrongMime, lookup }), /JPG, PNG, or GIF/i)
})

test("remote redirects are revalidated and cannot pivot to localhost", async () => {
    const lookup = async hostname => hostname === "example.com"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }]
    const fetchImpl = async () => ({
        ok: false,
        status: 302,
        headers: headers({ location: "https://localhost/secret.png" }),
    })
    await assert.rejects(() => fetchRemoteImage("https://example.com/start", { fetchImpl, lookup }), /public HTTPS/i)
})

test("server appearance API is Premium-gated for updates but factory reset stays available", () => {
    const source = fs.readFileSync(path.join(__dirname, "../api/dashboardAppearance.js"), "utf8")
    const putStart = source.indexOf('router.put("/"')
    const deleteStart = source.indexOf('router.delete("/"')
    assert.ok(putStart >= 0 && deleteStart > putStart)
    const putSection = source.slice(putStart, deleteStart)
    const deleteSection = source.slice(deleteStart)
    assert.match(putSection, /!isGuildPremium\(guild\)/)
    assert.match(putSection, /PREMIUM_REQUIRED/)
    assert.doesNotMatch(deleteSection, /!isGuildPremium\(guild\)/)
    assert.match(deleteSection, /avatar:\s*null/)
    assert.match(deleteSection, /banner:\s*null/)
    assert.match(deleteSection, /bio:\s*null/)
})

test("server appearance uses Discord per-guild profile API and is dashboard-only", () => {
    const appearance = fs.readFileSync(path.join(__dirname, "../api/dashboardAppearance.js"), "utf8")
    const premiumRouter = fs.readFileSync(path.join(__dirname, "../api/dashboardPremium.js"), "utf8")
    const schema = fs.readFileSync(path.join(__dirname, "../database/schemas.js"), "utf8")
    assert.match(appearance, /guild\.members\.editMe\(/)
    assert.match(premiumRouter, /\/guilds\/:guildId\/appearance/)
    assert.match(schema, /serverAppearanceBio/)

    const commandLoader = fs.readFileSync(path.join(__dirname, "../handlers/commandLoader.js"), "utf8")
    assert.doesNotMatch(commandLoader, /serverAppearance|botAppearance|appearance/i)
})
