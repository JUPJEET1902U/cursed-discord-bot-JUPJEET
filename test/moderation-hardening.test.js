const assert = require("node:assert/strict")
const { PermissionFlagsBits } = require("discord.js")

const configModule = require("../utils/securityPhase3Config")
const response = require("../utils/securityResponse")
const shield = require("../utils/securityMessageShield")
const protection = require("../utils/securityProtection")

const defaults = configModule.normalizeSecurityPhase3Config({})
assert.equal(defaults.enabled, true)
assert.equal(defaults.antiNuke.enabled, true)
assert.equal(defaults.antiNuke.action, "neutralize")
assert.equal(defaults.antiNuke.thresholds.channelDeletes, 1)
assert.equal(defaults.antiNuke.thresholds.roleDeletes, 1)
assert.equal(defaults.antiNuke.thresholds.webhookChanges, 1)
assert.equal(defaults.antiNuke.thresholds.botAdds, 1)
assert.equal(defaults.messageShield.enabled, true)
assert.equal(typeof response.neutralizeExecutor, "function")
assert.equal(typeof response.restoreDeletedChannel, "function")
assert.equal(typeof response.restoreDeletedRole, "function")
assert.equal(typeof shield.runSecurityMessageShield, "function")
assert.equal(typeof protection.attachSecurityProtection, "function")
assert.equal(typeof protection.processUnauthorizedBotAdd, "function")
assert.equal(typeof protection.removeUnauthorizedAddedBot, "function")

const legacy = configModule.normalizeSecurityPhase3Config({
    securityPhase3: {
        enabled: false,
        antiNuke: { enabled: false, action: "alert", thresholds: { channelDeletes: 5 } },
    },
})
assert.equal(legacy.enabled, false)
assert.equal(legacy.antiNuke.enabled, false)
assert.equal(legacy.antiNuke.action, "alert")
assert.equal(legacy.antiNuke.thresholds.channelDeletes, 5)

async function testAddedBotRemoval() {
    const calls = []
    const botMember = {
        id: "123456789012345678",
        user: { bot: true },
        bannable: true,
        kickable: true,
        kick: async () => calls.push("kick"),
    }
    const guild = {
        members: {
            me: { permissions: { has: permission => [PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers].includes(permission) } },
            cache: new Map([[botMember.id, botMember]]),
            fetch: async () => botMember,
            ban: async () => calls.push("ban"),
        },
    }
    botMember.guild = guild

    const banned = await protection.removeUnauthorizedAddedBot(botMember, "test")
    assert.equal(banned.ok, true)
    assert.equal(banned.action, "bot banned")
    assert.deepEqual(calls, ["ban"], "ban must happen before kick and stop further removal attempts")

    calls.length = 0
    guild.members.ban = async () => { calls.push("ban"); throw new Error("temporary ban failure") }
    const kicked = await protection.removeUnauthorizedAddedBot(botMember, "test")
    assert.equal(kicked.ok, true)
    assert.equal(kicked.action, "bot kicked")
    assert.deepEqual(calls, ["ban", "kick"], "kick must be used only as the fallback after ban fails")
}

testAddedBotRemoval()
    .then(() => console.log("moderation hardening contracts passed"))
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
