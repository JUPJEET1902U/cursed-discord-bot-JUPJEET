const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeFortressConfig } = require("../utils/fortressConfig")
const { calculateJoinRisk, dangerousPermissionsAdded } = require("../utils/securityProtection")
const { resolveAction } = require("../utils/automodHeat")
const { readinessScore } = require("../utils/securityHealth")
const securityCommands = require("../commands/securityProtection")

test("Fortress defaults protect enabled anti-nuke servers without enabling risky message filters", () => {
    const config = normalizeFortressConfig({})
    assert.equal(config.enabled, true)
    assert.equal(config.rollback.enabled, true)
    assert.equal(config.response.neutralizeFirst, true)
    assert.equal(config.automod.enabled, false)
    assert.equal(config.joinGate.enabled, false)
    assert.ok(config.response.order.includes("strip_roles"))
})

test("Fortress normalizer clamps untrusted dashboard values", () => {
    const config = normalizeFortressConfig({
        auditRetryCount: 99,
        heat: { threshold: 1, panicThreshold: 999 },
        response: { order: ["ban", "invalid"], timeoutMinutes: 999999 },
        backups: { intervalMinutes: 1, maxSnapshots: 100 },
        automod: { enabled: true, limits: { mentions: 1000 } },
    })
    assert.equal(config.auditRetryCount, 6)
    assert.equal(config.heat.threshold, 3)
    assert.equal(config.heat.panicThreshold, 150)
    assert.deepEqual(config.response.order, ["ban"])
    assert.equal(config.response.timeoutMinutes, 40320)
    assert.equal(config.backups.intervalMinutes, 30)
    assert.equal(config.backups.maxSnapshots, 25)
    assert.equal(config.automod.limits.mentions, 50)
})

test("Join Gate risk combines account age, missing avatar, and advertising names", () => {
    const config = normalizeFortressConfig({ joinGate: { enabled: true, onlyDuringRaid: false } }).joinGate
    const member = {
        user: {
            createdTimestamp: Date.now() - 60 * 60_000,
            avatar: null,
            username: "free nitro discord.gg/example",
            globalName: null,
        },
    }
    const risk = calculateJoinRisk(member, config)
    assert.ok(risk.score >= config.minimumScore)
    assert.ok(risk.reasons.includes("no custom avatar"))
    assert.ok(risk.reasons.includes("advertising username"))
})

test("AutoMod escalation selects the strongest reached action", () => {
    const actions = [
        { heat: 5, action: "delete" },
        { heat: 10, action: "timeout", durationMinutes: 10 },
        { heat: 20, action: "ban" },
    ]
    assert.equal(resolveAction(actions, 4), null)
    assert.equal(resolveAction(actions, 12).action, "timeout")
    assert.equal(resolveAction(actions, 30).action, "ban")
})

test("Readiness score heavily penalizes critical security failures", () => {
    const score = readinessScore([
        { severity: "critical" },
        { severity: "high" },
        { severity: "medium" },
    ])
    assert.equal(score, 42)
})

test("Security command pack includes recovery and emergency commands", () => {
    const names = securityCommands.commands.map(command => command.toJSON().name)
    for (const name of ["quarantine", "unquarantine", "lockdown", "security-status", "panic", "security-check", "security-snapshot"]) {
        assert.ok(names.includes(name), `${name} command missing`)
    }
    assert.equal(new Set(names).size, names.length)
})

test("dangerous permission additions are detected", () => {
    const { PermissionsBitField, PermissionFlagsBits } = require("discord.js")
    const oldRole = { permissions: new PermissionsBitField(0n) }
    const newRole = { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }
    assert.equal(dangerousPermissionsAdded(oldRole, newRole), true)
})
