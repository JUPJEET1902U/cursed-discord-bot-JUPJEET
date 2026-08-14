const assert = require("node:assert/strict")
const { PermissionFlagsBits } = require("discord.js")

const configModule = require("../utils/securityPhase3Config")
const response = require("../utils/securityResponse")
const shield = require("../utils/securityMessageShield")
const protection = require("../utils/securityProtection")
const recoveryListeners = require("../utils/securityRecoveryListeners")

const defaults = configModule.normalizeSecurityPhase3Config({})
assert.equal(defaults.enabled, false)
assert.equal(defaults.antiNuke.enabled, false)
assert.equal(defaults.antiNuke.action, "alert")
assert.equal(defaults.antiNuke.thresholds.channelDeletes, 1)
assert.equal(defaults.antiNuke.thresholds.roleDeletes, 1)
assert.equal(defaults.antiNuke.thresholds.webhookChanges, 1)
assert.equal(defaults.antiNuke.thresholds.botAdds, 1)
assert.equal(defaults.messageShield.enabled, false)
assert.equal(typeof response.neutralizeExecutor, "function")
assert.equal(typeof response.restoreDeletedChannel, "function")
assert.equal(typeof response.restoreDeletedRole, "function")
assert.equal(typeof shield.runSecurityMessageShield, "function")
assert.equal(typeof protection.attachSecurityProtection, "function")
assert.equal(typeof protection.processUnauthorizedBotAdd, "function")
assert.equal(typeof protection.removeUnauthorizedAddedBot, "function")
assert.equal(typeof protection.fetchMatchingAuditEntry, "function")
assert.equal(typeof recoveryListeners.isTamperExecutorExempt, "function")
assert.equal(typeof recoveryListeners.consumeExpectedRoleRecovery, "function")

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

async function testDelayedAuditLogMatching() {
    const targetId = "223456789012345678"
    const unrelated = {
        id: "audit-unrelated",
        targetId: "323456789012345678",
        createdTimestamp: Date.now(),
    }
    const matching = {
        id: "audit-match",
        targetId,
        executorId: "423456789012345678",
        createdTimestamp: Date.now(),
    }
    let calls = 0
    const guild = {
        fetchAuditLogs: async () => {
            calls += 1
            if (calls === 1) return { entries: new Map([[unrelated.id, unrelated]]) }
            if (calls === 2) return { entries: new Map() }
            return { entries: new Map([[matching.id, matching]]) }
        },
    }

    const found = await protection.fetchMatchingAuditEntry(guild, "CHANNEL_DELETE", targetId, [0, 1, 1])
    assert.equal(found, matching, "audit lookup must retry until the matching target appears")
    assert.equal(calls, 3, "audit lookup must not stop on unrelated or temporarily empty audit logs")
}

async function testTamperRecoveryExemptions() {
    const guild = {
        id: "523456789012345678",
        ownerId: "owner-id",
        members: {
            me: { id: "cursed-id" },
            cache: new Map(),
            fetch: async () => null,
        },
    }

    assert.equal(
        await recoveryListeners.isTamperExecutorExempt(guild, { id: "owner-id", bot: false }),
        true,
        "server owner actions must be exempt before any rollback"
    )
    assert.equal(
        await recoveryListeners.isTamperExecutorExempt(guild, { id: "cursed-id", bot: true }),
        true,
        "CURSED's own recovery actions must be exempt before any rollback"
    )
}

function testExpectedRoleRecoverySuppression() {
    const role = {
        id: "role-id",
        guild: { id: "623456789012345678" },
        name: "Protected Role",
        color: 123,
        hoist: false,
        permissions: { bitfield: 8n },
        mentionable: false,
        unicodeEmoji: null,
        position: 5,
    }

    recoveryListeners.rememberRoleRecoveryExpectation(role, 5)
    assert.equal(
        recoveryListeners.consumeExpectedRoleRecovery({ ...role, permissions: { bitfield: 8n } }),
        true,
        "the exact state produced by CURSED's rollback must be suppressed"
    )

    recoveryListeners.rememberRoleRecoveryExpectation(role, 5)
    const attackerState = { ...role, name: "Attacker Edit", permissions: { bitfield: 8n } }
    assert.equal(
        recoveryListeners.consumeExpectedRoleRecovery(attackerState),
        false,
        "a different attacker change must not be hidden by the recovery suppression window"
    )
    assert.equal(
        recoveryListeners.consumeExpectedRoleRecovery({ ...role, permissions: { bitfield: 8n } }),
        true,
        "the original expected rollback state must remain suppressible after an unrelated event"
    )
}

async function run() {
    await testAddedBotRemoval()
    await testDelayedAuditLogMatching()
    await testTamperRecoveryExemptions()
    testExpectedRoleRecoverySuppression()
    console.log("moderation hardening contracts passed")
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
