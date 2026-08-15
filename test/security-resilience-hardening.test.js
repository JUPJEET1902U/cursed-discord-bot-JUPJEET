const assert = require("node:assert/strict")
const { ChannelType, Events, PermissionFlagsBits } = require("discord.js")

const protection = require("../utils/securityProtection")
const response = require("../utils/securityResponse")
const recoveryListeners = require("../utils/securityRecoveryListeners")
const shield = require("../utils/securityMessageShield")
const windowStore = require("../utils/securityWindowStore")

function makeAuditEntry(id, targetId, executorId, createdTimestamp = Date.now()) {
    return {
        id,
        targetId,
        executorId,
        executor: { id: executorId, username: `user-${executorId}`, bot: false },
        createdTimestamp,
    }
}

async function testAuditClaimsAreScopedToClassification() {
    const entry = makeAuditEntry("audit-scope-1", "target-a", "executor-a")
    assert.equal(protection.claimAuditEntry(entry, "roleUpdates"), true)
    assert.equal(protection.claimAuditEntry(entry, "roleUpdates"), false, "same audit entry/classification must be idempotent")
    assert.equal(
        protection.claimAuditEntry(entry, "dangerousRoleChanges"),
        true,
        "one Discord role update must be classifiable as both ordinary and dangerous without being swallowed"
    )
}

async function testSimultaneousAuditCandidatesCanBothBeClaimed() {
    const targetId = "223456789012345678"
    const first = makeAuditEntry("audit-race-new", targetId, "423456789012345678", Date.now())
    const second = makeAuditEntry("audit-race-old", targetId, "523456789012345678", Date.now() - 100)
    const guild = {
        fetchAuditLogs: async () => ({ entries: new Map([[first.id, first], [second.id, second]]) }),
    }

    const claimedFirst = await protection.claimMatchingAuditEntry(guild, "channelUpdates", "CHANNEL_UPDATE", targetId, [0])
    const claimedSecond = await protection.claimMatchingAuditEntry(guild, "channelUpdates", "CHANNEL_UPDATE", targetId, [0])
    assert.equal(claimedFirst.id, first.id)
    assert.equal(claimedSecond.id, second.id, "second simultaneous gateway event must fall through to the next unclaimed audit candidate")
}

async function testStaleAuditEntriesAreRejected() {
    const targetId = "623456789012345678"
    const observedAt = Date.now()
    const stale = makeAuditEntry("audit-stale", targetId, "723456789012345678", observedAt - 15_000)
    const guild = {
        fetchAuditLogs: async () => ({ entries: new Map([[stale.id, stale]]) }),
    }
    const found = await protection.fetchMatchingAuditEntry(guild, "CHANNEL_DELETE", targetId, [0], { observedAt })
    assert.equal(found, null, "an unrelated stale audit entry must not be blamed for the current gateway event")
}

function testMixedAndSlowBurnActionRisk() {
    const current = Date.now()
    const mixed = protection.compositeActionRisk([
        { at: current - 500, eventType: "channelDeletes", auditId: "mix-1", weight: 3 },
        { at: current - 300, eventType: "roleCreates", auditId: "mix-2", weight: 1 },
        { at: current - 100, eventType: "guildUpdates", auditId: "mix-3", weight: 2 },
    ], 10_000, current)
    assert.equal(mixed.triggered, true, "alternating destructive action types must aggregate into one executor risk window")

    const oneDiscordActionClassifiedTwice = protection.compositeActionRisk([
        { at: current - 200, eventType: "roleUpdates", auditId: "same-role-audit", weight: 1 },
        { at: current - 200, eventType: "dangerousRoleChanges", auditId: "same-role-audit", weight: 3 },
        { at: current - 100, eventType: "channelCreates", auditId: "other-audit", weight: 1 },
    ], 10_000, current)
    assert.equal(oneDiscordActionClassifiedTwice.score, 4, "the same audit action must use its highest severity weight, not double count")
    assert.equal(oneDiscordActionClassifiedTwice.triggered, false)

    const slowBurn = protection.slowBurnActionRisk([
        { at: current - 105_000, eventType: "channelDeletes", auditId: "slow-1", weight: 3 },
        { at: current - 75_000, eventType: "roleDeletes", auditId: "slow-2", weight: 3 },
        { at: current - 45_000, eventType: "webhookChanges", auditId: "slow-3", weight: 3 },
        { at: current - 10_000, eventType: "channelDeletes", auditId: "slow-4", weight: 3 },
    ], 120_000, current)
    assert.equal(slowBurn.triggered, true, "high-risk actions deliberately spaced outside the burst window must still correlate")

    const ordinaryAdministration = protection.slowBurnActionRisk([
        { at: current - 100_000, eventType: "roleUpdates", auditId: "admin-1", weight: 1 },
        { at: current - 70_000, eventType: "channelUpdates", auditId: "admin-2", weight: 1 },
        { at: current - 40_000, eventType: "roleUpdates", auditId: "admin-3", weight: 1 },
        { at: current - 10_000, eventType: "guildUpdates", auditId: "admin-4", weight: 2 },
    ], 120_000, current)
    assert.equal(ordinaryAdministration.triggered, false, "normal low-volume administration must not trip slow-burn containment")
}

function testCoordinatedDestructiveRisk() {
    const current = Date.now()
    const coordinated = protection.coordinatedDestructiveRisk([
        { at: current - 1000, executorId: "attacker-a", eventType: "channelDeletes", auditId: "coord-1", weight: 3 },
        { at: current - 800, executorId: "attacker-b", eventType: "roleDeletes", auditId: "coord-2", weight: 3 },
        { at: current - 600, executorId: "attacker-a", eventType: "channelDeletes", auditId: "coord-3", weight: 3 },
        { at: current - 400, executorId: "attacker-b", eventType: "roleDeletes", auditId: "coord-4", weight: 3 },
    ], 30_000, current)
    assert.equal(coordinated.triggered, true, "multiple untrusted executors sharing destructive work must aggregate")
    assert.equal(coordinated.executors.length, 2)

    const singleExecutor = protection.coordinatedDestructiveRisk([
        { at: current - 1000, executorId: "one-admin", eventType: "channelDeletes", auditId: "one-1", weight: 3 },
        { at: current - 800, executorId: "one-admin", eventType: "roleDeletes", auditId: "one-2", weight: 3 },
        { at: current - 600, executorId: "one-admin", eventType: "channelDeletes", auditId: "one-3", weight: 3 },
        { at: current - 400, executorId: "one-admin", eventType: "roleDeletes", auditId: "one-4", weight: 3 },
    ], 30_000, current)
    assert.equal(singleExecutor.triggered, false, "multi-executor containment must not be mislabeled for one executor")
}

async function testConcurrentExecutorHistoryIsLossless() {
    const config = {
        antiNuke: { windowSeconds: 10 },
        staffLimits: { enabled: false },
    }
    const guildId = "executor-history-guild"
    const executorId = "executor-history-user"
    const [first, second] = await Promise.all([
        protection.addExecutorAction(guildId, executorId, "channelDeletes", "concurrent-audit-1", config),
        protection.addExecutorAction(guildId, executorId, "roleDeletes", "concurrent-audit-2", config),
    ])
    const longest = first.length >= second.length ? first : second
    assert.equal(longest.length, 2, "simultaneous actions for one executor must not overwrite each other in the local rolling window")
    assert.deepEqual(new Set(longest.map(event => event.auditId)), new Set(["concurrent-audit-1", "concurrent-audit-2"]))
}

async function testStateMutationSerialization() {
    const order = []
    const first = windowStore.runSecurityStateMutation("serial-test", async () => {
        order.push("first:start")
        await new Promise(resolve => setTimeout(resolve, 10))
        order.push("first:end")
    })
    const second = windowStore.runSecurityStateMutation("serial-test", async () => {
        order.push("second:start")
        order.push("second:end")
    })
    await Promise.all([first, second])
    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"])
}

function permissionSet(values) {
    return { has: permission => values.includes(permission) }
}

function testDangerousHierarchyCrossing() {
    const botRole = { id: "bot-role", position: 10 }
    const guild = { members: { me: { roles: { highest: botRole } } } }
    const oldRole = {
        id: "danger-role",
        guild,
        position: 9,
        permissions: permissionSet([PermissionFlagsBits.Administrator]),
    }
    const newRole = {
        ...oldRole,
        position: 11,
        permissions: permissionSet([PermissionFlagsBits.Administrator]),
    }
    assert.equal(
        protection.dangerousRoleChange(oldRole, newRole),
        true,
        "moving an already-dangerous role above CURSED must be treated as a dangerous role change"
    )
}

function testRaidFalsePositiveAndBotBurstDecisions() {
    const raid = { joinThreshold: 6, riskScoreThreshold: 2 }
    const current = Date.now()
    const legitimate = Array.from({ length: 6 }, (_, index) => ({
        at: current - index * 100,
        userId: `legit-${index}`,
        isBot: false,
        isYoung: false,
        riskScore: 0,
    }))
    const legitDecision = protection.raidDecision(legitimate, raid, { score: 0, isBot: false, isYoung: false }, { currentTime: current })
    assert.equal(legitDecision.thresholdReached, true)
    assert.equal(legitDecision.highConfidenceBurst, false, "join count alone must not classify healthy organic growth as a raid")
    assert.equal(legitDecision.shouldAct, false)

    const bots = Array.from({ length: 6 }, (_, index) => ({
        at: current - index * 100,
        userId: `bot-${index}`,
        isBot: true,
        isYoung: true,
        riskScore: 5,
    }))
    const botDecision = protection.raidDecision(bots, raid, { score: 5, isBot: true, isYoung: true }, { currentTime: current })
    assert.equal(botDecision.highConfidenceBurst, true)
    assert.equal(botDecision.shouldAct, true, "a bot-heavy/high-risk join flood must activate containment")
}

function makeMessage({ guildId, authorId, content, incident = false }) {
    const guild = { id: guildId }
    return {
        guild,
        author: { id: authorId, bot: false },
        content,
        mentions: { users: new Map(), roles: new Map(), everyone: false },
        _incident: incident,
    }
}

function testCoordinatedMessageRaidSignal() {
    const config = {
        messageShield: {
            windowSeconds: 8,
            repeatedMessageThreshold: 3,
            rapidMessageThreshold: 5,
            botInviteThreshold: 2,
            inviteThreshold: 3,
            linkThreshold: 6,
            maxMentions: 5,
        },
        incidentMode: { strictMessageShield: true },
    }
    const normalShield = shield.effectiveShield(config, { active: false })
    const payload = "claim your free reward here now"
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-coord", authorId: "a", content: payload }), normalShield, { active: false }), null)
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-coord", authorId: "b", content: payload }), normalShield, { active: false }), null)
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-coord", authorId: "c", content: payload }), normalShield, { active: false }), null, "three users repeating ordinary text is not enough outside Incident Mode")
    const signal = shield.coordinatedSignalFor(makeMessage({ guildId: "guild-coord", authorId: "d", content: payload }), normalShield, { active: false })
    assert.ok(signal)
    assert.equal(signal.repeatedTrigger, true)
    assert.equal(signal.distinctAuthors, 4)

    const commonPhrase = "happy birthday"
    for (const authorId of ["p1", "p2", "p3", "p4", "p5"]) {
        assert.equal(
            shield.coordinatedSignalFor(makeMessage({ guildId: "guild-common", authorId, content: commonPhrase }), normalShield, { active: false }),
            null,
            "short common phrases must not become a coordinated-raid signal"
        )
    }

    const healthyShield = shield.effectiveShield(config, { active: false })
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-healthy", authorId: "x", content: "hello everyone" }), healthyShield, { active: false }), null)
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-healthy", authorId: "y", content: "how are you" }), healthyShield, { active: false }), null)
    assert.equal(shield.coordinatedSignalFor(makeMessage({ guildId: "guild-healthy", authorId: "z", content: "good morning" }), healthyShield, { active: false }), null)
}

async function testNeutralizationSingleFlight() {
    let timeoutCalls = 0
    const member = {
        id: "823456789012345678",
        user: { bot: false },
        manageable: true,
        moderatable: true,
        roles: { cache: new Map() },
        timeout: async () => {
            timeoutCalls += 1
            await new Promise(resolve => setTimeout(resolve, 5))
        },
    }
    const guild = {
        id: "923456789012345678",
        ownerId: "owner-id",
        members: {
            me: {
                id: "cursed-id",
                permissions: { has: () => false },
            },
        },
    }
    const config = {
        antiNuke: {
            removeDangerousRoles: true,
            neutralizeTimeoutMinutes: 60,
            autoLockdown: false,
        },
        lockdown: { enabled: false },
    }

    const [first, second] = await Promise.all([
        response.neutralizeExecutor(guild, member, config, { reason: "test" }),
        response.neutralizeExecutor(guild, member, config, { reason: "test" }),
    ])
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(timeoutCalls, 1, "simultaneous security events must share one neutralization flight")
}

async function testRecoverySingleFlightAndRoleRemap() {
    let channelCreates = 0
    let roleCreates = 0
    let capturedChannelOptions = null
    const rolesCache = new Map()
    const channelsCache = new Map()
    const guild = {
        id: "103456789012345678",
        members: {
            me: {
                roles: { highest: { position: 20 } },
                permissions: {
                    has: permission => permission === PermissionFlagsBits.ManageChannels || permission === PermissionFlagsBits.ManageRoles,
                },
            },
        },
        roles: {
            cache: rolesCache,
            create: async () => {
                roleCreates += 1
                const created = { id: `restored-role-${roleCreates}`, setPosition: async () => {} }
                return created
            },
        },
        channels: {
            cache: channelsCache,
            create: async options => {
                channelCreates += 1
                capturedChannelOptions = options
                await new Promise(resolve => setTimeout(resolve, 5))
                return { id: `restored-channel-${channelCreates}`, setPosition: async () => {} }
            },
        },
    }

    const oldRole = {
        id: "old-role-id",
        name: "Protected",
        color: 0,
        hoist: false,
        permissions: { bitfield: PermissionFlagsBits.ManageChannels },
        mentionable: false,
        unicodeEmoji: null,
        position: 5,
    }
    const roleResult = await response.restoreDeletedRole(guild, oldRole, "test role recovery")
    assert.equal(roleResult.ok, true)
    assert.equal(roleCreates, 1)

    const oldChannel = {
        id: "old-channel-id",
        name: "important",
        type: ChannelType.GuildText,
        parentId: null,
        topic: "keep me",
        nsfw: false,
        rateLimitPerUser: 0,
        rawPosition: 2,
        permissionOverwrites: {
            cache: new Map([["overwrite", {
                id: oldRole.id,
                type: 0,
                allow: { bitfield: 1n },
                deny: { bitfield: 0n },
            }]]),
        },
    }

    const [first, second] = await Promise.all([
        response.restoreDeletedChannel(guild, oldChannel, "test channel recovery"),
        response.restoreDeletedChannel(guild, oldChannel, "test channel recovery"),
    ])
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(channelCreates, 1, "duplicate deletion processing must not create duplicate replacement channels")
    assert.equal(capturedChannelOptions.permissionOverwrites[0].id, roleResult.restoredId, "recovered channels must point overwrites at the recreated role ID")
}

function testOnlyOneLiveAntiRaidJoinListener() {
    const events = []
    const client = { on: event => events.push(event) }
    recoveryListeners.attachSecurityRecoveryListeners(client)
    assert.equal(
        events.includes(Events.GuildMemberAdd),
        false,
        "securityRecoveryListeners must not register a second live GuildMemberAdd anti-raid pipeline"
    )
}

function testWindowPruning() {
    const current = Date.now()
    const pruned = windowStore.pruneSecurityEvents([
        { at: current - 20_000, eventType: "old" },
        { at: current - 100, eventType: "new" },
    ], 10_000, current)
    assert.equal(pruned.length, 1)
    assert.equal(pruned[0].eventType, "new")
}


async function testAuditFutureWindowDoesNotDriftDuringRetry() {
    const targetId = "future-window-target"
    const observedAt = Date.now()
    const future = makeAuditEntry("audit-future", targetId, "future-executor", observedAt + 2500)
    const guild = { fetchAuditLogs: async () => ({ entries: new Map([[future.id, future]]) }) }
    const found = await protection.fetchMatchingAuditEntry(guild, "CHANNEL_UPDATE", targetId, [1000], { observedAt })
    assert.equal(found, null, "retry delay must not expand the audit future window")
}

async function testDifferentNeutralizationPolicyIsNotReused() {
    let timeoutCalls = 0
    const member = {
        id: "policy-member",
        user: { bot: false },
        manageable: true,
        moderatable: true,
        roles: { cache: new Map() },
        timeout: async () => { timeoutCalls += 1 },
    }
    const guild = {
        id: "policy-guild",
        ownerId: "owner-id",
        members: { me: { id: "cursed-id", permissions: { has: () => false } } },
    }
    const first = { antiNuke: { removeDangerousRoles: true, neutralizeTimeoutMinutes: 1, autoLockdown: false }, lockdown: { enabled: false } }
    const stronger = { antiNuke: { removeDangerousRoles: true, neutralizeTimeoutMinutes: 60, autoLockdown: false }, lockdown: { enabled: false } }
    await response.neutralizeExecutor(guild, member, first, { reason: "first policy" })
    await response.neutralizeExecutor(guild, member, stronger, { reason: "stronger policy" })
    assert.equal(timeoutCalls, 2, "a different neutralization policy must not reuse a previous result")
}

async function testLateRecoveryDependencyRegistration() {
    let capturedOptions = null
    const guild = {
        id: "late-dependency-guild",
        members: { me: { roles: { highest: { position: 20 } }, permissions: { has: p => p === PermissionFlagsBits.ManageChannels || p === PermissionFlagsBits.ManageRoles } } },
        roles: { cache: new Map(), create: async () => ({ id: "late-restored-role", setPosition: async () => {} }) },
        channels: { cache: new Map(), create: async options => { capturedOptions = options; return { id: "late-restored-channel", setPosition: async () => {} } } },
    }
    const oldRole = { id: "late-old-role", name: "Late Role", color: 0, hoist: false, permissions: { bitfield: PermissionFlagsBits.ManageChannels }, mentionable: false, unicodeEmoji: null, position: 5 }
    const oldChannel = {
        id: "late-old-channel", name: "late-channel", type: ChannelType.GuildText, parentId: null, topic: null, nsfw: false, rateLimitPerUser: 0, rawPosition: 1,
        permissionOverwrites: { cache: new Map([["late", { id: oldRole.id, type: 0, allow: { bitfield: 1n }, deny: { bitfield: 0n } }]]) },
    }
    const channelPromise = response.restoreDeletedChannel(guild, oldChannel, "late dependency channel")
    await new Promise(resolve => setTimeout(resolve, 75))
    const roleResult = await response.restoreDeletedRole(guild, oldRole, "late dependency role")
    const channelResult = await channelPromise
    assert.equal(roleResult.ok, true)
    assert.equal(channelResult.ok, true)
    assert.equal(capturedOptions.permissionOverwrites[0].id, roleResult.restoredId)
}

function testDecorativeBotRoleIsNotTamperProtected() {
    const guild = { id: "role-scope-guild" }
    const decorative = { id: "decorative-role", guild, permissions: permissionSet([]) }
    const critical = { id: "critical-role", guild, permissions: permissionSet([PermissionFlagsBits.ManageRoles]) }
    const member = { guild, roles: { cache: new Map([[decorative.id, decorative], [critical.id, critical]]) } }
    assert.equal(recoveryListeners.isBotProtectionRole(member, decorative), false)
    assert.equal(recoveryListeners.isBotProtectionRole(member, critical), true)
}

function testHydrationFailureShortRetryContract() {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../utils/securityProtection.js"), "utf8")
    assert.match(source, /HYDRATION_FAILED = Symbol/)
    assert.match(source, /HYDRATION_FAILURE_RETRY_MS = 5000/)
    assert.match(source, /currentTime - \(60_000 - HYDRATION_FAILURE_RETRY_MS\)/)
}

async function run() {
    await testAuditClaimsAreScopedToClassification()
    await testSimultaneousAuditCandidatesCanBothBeClaimed()
    await testStaleAuditEntriesAreRejected()
    await testAuditFutureWindowDoesNotDriftDuringRetry()
    testMixedAndSlowBurnActionRisk()
    testCoordinatedDestructiveRisk()
    await testConcurrentExecutorHistoryIsLossless()
    await testStateMutationSerialization()
    testDangerousHierarchyCrossing()
    testRaidFalsePositiveAndBotBurstDecisions()
    testCoordinatedMessageRaidSignal()
    await testNeutralizationSingleFlight()
    await testDifferentNeutralizationPolicyIsNotReused()
    await testRecoverySingleFlightAndRoleRemap()
    await testLateRecoveryDependencyRegistration()
    testDecorativeBotRoleIsNotTamperProtected()
    testHydrationFailureShortRetryContract()
    testOnlyOneLiveAntiRaidJoinListener()
    testWindowPruning()
    console.log("security resilience hardening contracts passed")
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
