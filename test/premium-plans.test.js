const test = require("node:test")
const assert = require("node:assert/strict")

process.env.BOT_OWNER_IDS = "111111111111111111"
const premium = require("../utils/premium")
const serverPremium = require("../utils/serverPremium")

const FREE_USER = "222222222222222222"
const PAID_USER = "333333333333333333"
const GUILD_ID = "444444444444444444"

test.beforeEach(() => {
    premium._resetForTests()
    serverPremium._resetForTests()
})

test("Free AI chat is unlimited but paced per user", () => {
    const first = premium.checkAiReplyCooldown(FREE_USER, GUILD_ID)
    const immediateSecond = premium.checkAiReplyCooldown(FREE_USER, GUILD_ID)
    const anotherUser = premium.checkAiReplyCooldown("555555555555555555", GUILD_ID)

    assert.equal(first.ok, true)
    assert.equal(immediateSecond.ok, false)
    assert.ok(immediateSecond.remainingSeconds >= 1)
    assert.equal(anotherUser.ok, true)
})

test("Bot owners and paid accounts have no AI reply delay", async () => {
    assert.equal(premium.checkAiReplyCooldown("111111111111111111", GUILD_ID).ok, true)
    assert.equal(premium.checkAiReplyCooldown("111111111111111111", GUILD_ID).ok, true)

    await premium.grantPremiumUser(PAID_USER, { source: "test" })
    assert.equal(premium.isPremiumUser(PAID_USER), true)
    assert.equal(premium.checkAiReplyCooldown(PAID_USER, GUILD_ID).ok, true)
    assert.equal(premium.checkAiReplyCooldown(PAID_USER, GUILD_ID).ok, true)
})

test("Free and Premium generation quotas use separate plan limits", async () => {
    for (let index = 0; index < 3; index += 1) {
        assert.equal(premium.consumeFeatureUsage("image", { userId: FREE_USER, guildId: GUILD_ID }).ok, true)
    }
    const freeBlocked = premium.consumeFeatureUsage("image", { userId: FREE_USER, guildId: GUILD_ID })
    assert.equal(freeBlocked.ok, false)
    assert.equal(freeBlocked.scope, "user")
    assert.equal(freeBlocked.limit, 3)

    await premium.grantPremiumUser(PAID_USER, { source: "test" })
    for (let index = 0; index < 20; index += 1) {
        assert.equal(premium.consumeFeatureUsage("image", { userId: PAID_USER, guildId: "666666666666666666" }).ok, true)
    }
    const paidBlocked = premium.consumeFeatureUsage("image", { userId: PAID_USER, guildId: "666666666666666666" })
    assert.equal(paidBlocked.ok, false)
    assert.equal(paidBlocked.limit, 20)
})

test("Guild Premium follows the Discord account of the guild owner", async () => {
    const guild = { id: GUILD_ID, ownerId: PAID_USER }
    assert.equal(premium.isGuildPremium(guild), false)
    await premium.grantPremiumUser(PAID_USER, { source: "test" })
    assert.equal(premium.isGuildPremium(guild), true)
    await premium.revokePremiumUser(PAID_USER)
    assert.equal(premium.isGuildPremium(guild), false)
})

test("Bot owner can grant and revoke Premium directly on a server", async () => {
    const guild = { id: GUILD_ID, ownerId: FREE_USER }
    assert.equal(premium.isGuildPremium(guild), false)

    await serverPremium.grantServerPremium(GUILD_ID, {
        source: "test",
        grantedBy: "111111111111111111",
    })
    assert.equal(serverPremium.isServerPremium(GUILD_ID), true)
    assert.equal(premium.isGuildPremium(guild), true)
    assert.equal(premium.getGuildPlanLimits(guild).ticketPanels, 5)

    await serverPremium.revokeServerPremium(GUILD_ID)
    assert.equal(serverPremium.isServerPremium(GUILD_ID), false)
    assert.equal(premium.isGuildPremium(guild), false)
})
