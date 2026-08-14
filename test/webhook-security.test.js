const assert = require("node:assert/strict")
const crypto = require("crypto")
const {
    verifyKofiToken,
    verifyPatreonSignature,
    verifyBmcSignature,
    webhookReplayKey,
    beginWebhookEvent,
    completeWebhookEvent,
    releaseWebhookEvent,
    markWebhookEventOnce,
    extractPatreonDiscordId,
    isPatreonPaidEntitlement,
    isBmcPremiumGrantEvent,
    extractBmcDiscordId,
    bmcReplayId,
} = require("../webhook")

const DISCORD_ID = "1513802470973898803"
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
    assert.equal(verifyBmcSignature(rawBody, bmcSignature), true)
    assert.equal(verifyBmcSignature(rawBody, `sha256=${bmcSignature}`), true)
    assert.equal(verifyBmcSignature(rawBody, "f".repeat(64)), false)

    const replayKey = webhookReplayKey("test-platform", "unique-event-123", rawBody, {})
    assert.equal(markWebhookEventOnce(replayKey, 1000), true, "first verified event must be accepted")
    assert.equal(markWebhookEventOnce(replayKey, 1001), false, "completed duplicate must be ignored")

    const retryKey = webhookReplayKey("test-platform", "retryable-event", rawBody, {})
    assert.equal(beginWebhookEvent(retryKey, 2000), "reserved", "new event must reserve before processing")
    assert.equal(beginWebhookEvent(retryKey, 2001), "processing", "concurrent duplicate must not run twice")
    assert.equal(releaseWebhookEvent(retryKey), true, "failed processing must release its reservation")
    assert.equal(beginWebhookEvent(retryKey, 2002), "reserved", "provider retry must be accepted after failure")
    assert.equal(completeWebhookEvent(retryKey, 2003), true)
    assert.equal(beginWebhookEvent(retryKey, 2004), "completed", "successful processing must deduplicate later retries")

    const freePatreon = {
        data: {
            attributes: {
                currently_entitled_amount_cents: 0,
                patron_status: null,
                last_charge_status: null,
            },
            relationships: {
                user: { data: { id: DISCORD_ID, type: "user" } },
            },
        },
        included: [],
    }
    assert.equal(isPatreonPaidEntitlement(freePatreon, "members:create"), false, "free Patreon members must not receive Premium")
    assert.equal(extractPatreonDiscordId(freePatreon), null, "Patreon relationship user IDs must never be treated as Discord IDs")

    const paidPatreon = {
        data: {
            attributes: {
                currently_entitled_amount_cents: 500,
                patron_status: "active_patron",
                last_charge_status: "Paid",
            },
            relationships: {
                user: { data: { id: "987654321", type: "user" } },
            },
        },
        included: [{
            id: "987654321",
            type: "user",
            attributes: {
                social_connections: {
                    discord: { user_id: DISCORD_ID },
                },
            },
        }],
    }
    assert.equal(isPatreonPaidEntitlement(paidPatreon, "members:create"), true)
    assert.equal(isPatreonPaidEntitlement(paidPatreon, "members:pledge:create"), true)
    assert.equal(extractPatreonDiscordId(paidPatreon), DISCORD_ID)

    const declinedPatreon = JSON.parse(JSON.stringify(paidPatreon))
    declinedPatreon.data.attributes.patron_status = "declined_patron"
    assert.equal(isPatreonPaidEntitlement(declinedPatreon, "members:create"), false)

    const bmcEnvelope = {
        event_id: 1234,
        type: "donation.created",
        live_mode: true,
        created: 1719825600,
        attempt: 1,
        data: {
            id: 98765,
            transaction_id: "pi_test",
            status: "succeeded",
            refunded: "false",
            supporter_name: "Alex",
            support_note: `Discord ${DISCORD_ID}`,
            message: "Alex bought a coffee",
        },
    }
    assert.equal(isBmcPremiumGrantEvent(bmcEnvelope), true, "live successful BMC donations may grant Premium")
    assert.equal(extractBmcDiscordId(bmcEnvelope), DISCORD_ID, "BMC Discord ID must come from envelope.data supporter fields")
    assert.equal(bmcReplayId(bmcEnvelope), 1234, "BMC event_id must be preferred for replay identity")

    const bmcTestEvent = { ...bmcEnvelope, live_mode: false }
    assert.equal(isBmcPremiumGrantEvent(bmcTestEvent), false, "BMC dashboard test events must never grant Premium")
    const bmcRefund = { ...bmcEnvelope, type: "donation.refunded" }
    assert.equal(isBmcPremiumGrantEvent(bmcRefund), false, "BMC refunds must never grant Premium")
    const bmcMembership = {
        ...bmcEnvelope,
        type: "membership.started",
        data: { ...bmcEnvelope.data, status: "active", canceled: "false", paused: "false" },
    }
    assert.equal(isBmcPremiumGrantEvent(bmcMembership), true)

    console.log("payment webhook security contracts passed")
} finally {
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
}
