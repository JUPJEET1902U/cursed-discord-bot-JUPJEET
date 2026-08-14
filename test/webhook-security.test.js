const assert = require("node:assert/strict")
const crypto = require("crypto")
const {
    verifyKofiToken,
    verifyPatreonSignature,
    verifyBmcSignature,
    webhookReplayKey,
    markWebhookEventOnce,
} = require("../webhook")

const original = {
    KOFI_WEBHOOK_SECRET: process.env.KOFI_WEBHOOK_SECRET,
    PATREON_WEBHOOK_SECRET: process.env.PATREON_WEBHOOK_SECRET,
    BMC_WEBHOOK_SECRET: process.env.BMC_WEBHOOK_SECRET,
}

try {
    delete process.env.KOFI_WEBHOOK_SECRET
    delete process.env.PATREON_WEBHOOK_SECRET
    delete process.env.BMC_WEBHOOK_SECRET

    assert.equal(verifyKofiToken("anything"), false, "Ko-fi must fail closed when the secret is missing")
    assert.equal(verifyPatreonSignature(Buffer.from("{}"), "abc"), false, "Patreon must fail closed when the secret is missing")
    assert.equal(verifyBmcSignature(Buffer.from("{}"), "abc"), false, "BMC must fail closed when the secret is missing")

    process.env.KOFI_WEBHOOK_SECRET = "kofi-test-secret"
    assert.equal(verifyKofiToken("kofi-test-secret"), true)
    assert.equal(verifyKofiToken("wrong-secret"), false)

    const rawBody = Buffer.from(JSON.stringify({ id: "evt-1", amount: 5 }))

    process.env.PATREON_WEBHOOK_SECRET = "patreon-test-secret"
    const patreonSignature = crypto.createHmac("md5", process.env.PATREON_WEBHOOK_SECRET).update(rawBody).digest("hex")
    assert.equal(verifyPatreonSignature(rawBody, patreonSignature), true)
    assert.equal(verifyPatreonSignature(rawBody, "0".repeat(32)), false)

    process.env.BMC_WEBHOOK_SECRET = "bmc-test-secret"
    const bmcSignature = crypto.createHmac("sha256", process.env.BMC_WEBHOOK_SECRET).update(rawBody).digest("hex")
    assert.equal(verifyBmcSignature(rawBody, `sha256=${bmcSignature}`), true)
    assert.equal(verifyBmcSignature(rawBody, "f".repeat(64)), false)

    const replayKey = webhookReplayKey("test-platform", "unique-event-123", rawBody, {})
    assert.equal(markWebhookEventOnce(replayKey, 1000), true, "first verified event must be accepted")
    assert.equal(markWebhookEventOnce(replayKey, 1001), false, "duplicate verified event must be ignored")

    const anotherKey = webhookReplayKey("test-platform", "unique-event-456", rawBody, {})
    assert.equal(markWebhookEventOnce(anotherKey, 1002), true, "different event IDs must remain independent")

    console.log("payment webhook security contracts passed")
} finally {
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
}
