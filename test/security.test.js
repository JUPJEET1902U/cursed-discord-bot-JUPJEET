const test = require("node:test")
const assert = require("node:assert/strict")
const { PermissionsBitField } = require("discord.js")
const {
    isStrongSecret,
    buildInvitePermissions,
    sanitizeAuditDetails,
    requestFingerprint,
    createSecretGate,
} = require("../utils/security")
const {
    verifyKofiToken,
    verifyPatreonSignature,
    verifyBmcSignature,
    isValidDiscordId,
} = require("../webhook")

test("secret validation rejects missing and short values", () => {
    assert.equal(isStrongSecret(undefined), false)
    assert.equal(isStrongSecret("short"), false)
    assert.equal(isStrongSecret("x".repeat(24)), true)
    assert.equal(isStrongSecret("x".repeat(31), 32), false)
    assert.equal(isStrongSecret("x".repeat(32), 32), true)
})

test("invite permissions never include Administrator", () => {
    const permissions = BigInt(buildInvitePermissions())
    const admin = PermissionsBitField.Flags.Administrator
    assert.equal((permissions & admin) === admin, false)
    assert.equal((permissions & PermissionsBitField.Flags.ViewChannel) !== 0n, true)
    assert.equal((permissions & PermissionsBitField.Flags.SendMessages) !== 0n, true)
})

test("audit details redact secrets", () => {
    const result = sanitizeAuditDetails({
        userId: "123",
        authorization: "Bearer secret",
        apiKey: "abc",
        message: "safe",
    })
    assert.deepEqual(result, {
        userId: "123",
        authorization: "[REDACTED]",
        apiKey: "[REDACTED]",
        message: "safe",
    })
})

test("request fingerprints are stable and body-sensitive", () => {
    const makeReq = body => ({
        rawBody: Buffer.from(body),
        originalUrl: "/webhook/test",
        get: () => "signature",
    })
    assert.equal(requestFingerprint("test", makeReq("one")), requestFingerprint("test", makeReq("one")))
    assert.notEqual(requestFingerprint("test", makeReq("one")), requestFingerprint("test", makeReq("two")))
})

test("secret gate fails closed without stopping the process", () => {
    const old = process.env.TEST_SECURITY_SECRET
    delete process.env.TEST_SECURITY_SECRET
    let status = null
    let payload = null
    let nextCalled = false
    const res = {
        status(code) { status = code; return this },
        json(value) { payload = value; return this },
    }
    createSecretGate("TEST_SECURITY_SECRET", "Test")({}, res, () => { nextCalled = true })
    assert.equal(status, 503)
    assert.equal(payload.code, "INTEGRATION_DISABLED")
    assert.equal(nextCalled, false)
    if (old === undefined) delete process.env.TEST_SECURITY_SECRET
    else process.env.TEST_SECURITY_SECRET = old
})

test("payment verifiers fail closed when secrets are missing", () => {
    const old = {
        kofi: process.env.KOFI_WEBHOOK_SECRET,
        patreon: process.env.PATREON_WEBHOOK_SECRET,
        bmc: process.env.BMC_WEBHOOK_SECRET,
    }
    delete process.env.KOFI_WEBHOOK_SECRET
    delete process.env.PATREON_WEBHOOK_SECRET
    delete process.env.BMC_WEBHOOK_SECRET
    assert.equal(verifyKofiToken("anything"), false)
    assert.equal(verifyPatreonSignature(Buffer.from("{}"), "sig"), false)
    assert.equal(verifyBmcSignature(Buffer.from("{}"), "sig"), false)
    for (const [key, value] of Object.entries(old)) {
        const env = key === "kofi" ? "KOFI_WEBHOOK_SECRET" : key === "patreon" ? "PATREON_WEBHOOK_SECRET" : "BMC_WEBHOOK_SECRET"
        if (value === undefined) delete process.env[env]
        else process.env[env] = value
    }
})

test("Discord ID validation enforces snowflake shape and timestamp", () => {
    assert.equal(isValidDiscordId("1234"), false)
    const currentTimestamp = BigInt(Date.now() - 60_000 - 1420070400000)
    const currentSnowflake = String(currentTimestamp << 22n)
    assert.equal(isValidDiscordId(currentSnowflake), true)
    const futureTimestamp = BigInt(Date.now() + 10 * 60_000 - 1420070400000)
    const futureSnowflake = String(futureTimestamp << 22n)
    assert.equal(isValidDiscordId(futureSnowflake), false)
})
