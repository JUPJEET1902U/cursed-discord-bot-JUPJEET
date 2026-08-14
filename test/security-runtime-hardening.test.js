const assert = require("node:assert/strict")
const { PermissionFlagsBits } = require("discord.js")
const runtime = require("../utils/securityRuntimeHardening")

function makeRole({ id, name, position, permissions = [] }) {
    return {
        id,
        name,
        position,
        permissions: { has: permission => permissions.includes(permission) },
    }
}

function makeGuild({ missing = [], extraRoles = [] } = {}) {
    const botRole = makeRole({ id: "bot-role", name: "CURSED", position: 10 })
    const roles = new Map([[botRole.id, botRole], ...extraRoles.map(role => [role.id, role])])
    const member = {
        id: "123456789012345678",
        permissions: {
            has: permission => !missing.includes(permission),
        },
        roles: {
            highest: botRole,
            cache: new Map([[botRole.id, botRole]]),
        },
    }
    return {
        id: "223456789012345678",
        members: { me: member },
        roles: { cache: roles },
    }
}

const healthy = runtime.permissionSnapshot(makeGuild())
assert.equal(healthy.ready, true)
assert.deepEqual(healthy.missing, [])
assert.equal(runtime.permissionFingerprint(healthy), "healthy")

const degraded = runtime.permissionSnapshot(makeGuild({ missing: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ManageRoles] }))
assert.equal(degraded.ready, false)
assert.ok(degraded.missing.includes("View Audit Log"))
assert.ok(degraded.missing.includes("Manage Roles"))
assert.notEqual(runtime.permissionFingerprint(degraded), "healthy")

const dangerousRole = makeRole({
    id: "danger-role",
    name: "Dangerous Admin",
    position: 11,
    permissions: [PermissionFlagsBits.Administrator],
})
const hierarchyRisks = runtime.dangerousRolesAtOrAboveBot(makeGuild({ extraRoles: [dangerousRole] }))
assert.equal(hierarchyRisks.length, 1)
assert.equal(hierarchyRisks[0].id, dangerousRole.id)

const botId = "323456789012345678"
assert.equal(runtime.recentOrActiveApproval([{ botId, active: true, usedAt: null }], botId), true)
assert.equal(runtime.recentOrActiveApproval([{ botId, active: false, usedAt: new Date().toISOString() }], botId), true)
assert.equal(runtime.recentOrActiveApproval([{ botId, active: false, usedAt: new Date(Date.now() - 120000).toISOString() }], botId), false)

const warnings = runtime.runtimeSecurityWarnings({ NODE_ENV: "production" })
assert.ok(warnings.some(item => item.includes("MONGO_URI")))
assert.ok(warnings.some(item => item.includes("DASHBOARD_API_SECRET")))
assert.ok(warnings.some(item => item.includes("KOFI_WEBHOOK_SECRET")))

console.log("security runtime hardening contracts passed")
