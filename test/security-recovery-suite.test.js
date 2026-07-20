const assert = require("node:assert/strict")

const configModule = require("../utils/securityPhase3Config")
const suite = require("../utils/securityRecoverySuite")
const listeners = require("../utils/securityRecoveryListeners")
const suiteCommands = require("../commands/securitySuite")
const protection = require("../utils/securityProtection")
const shield = require("../utils/securityMessageShield")
const api = require("../api/dashboardSecuritySuite")

const defaults = configModule.normalizeSecurityPhase3Config({})
assert.equal(defaults.backup.enabled, true)
assert.equal(defaults.backup.intervalHours, 24)
assert.equal(defaults.tamperProtection.enabled, true)
assert.equal(defaults.botApprovals.enabled, true)
assert.equal(defaults.incidentMode.enabled, true)
assert.equal(defaults.staffLimits.enabled, true)
assert.equal(defaults.reports.enabled, true)
assert.equal(defaults.antiRaid.suspiciousNameCheck, true)
assert.equal(defaults.antiRaid.riskScoreThreshold, 2)
assert.ok(configModule.TRUSTED_SCOPES.includes("tamperProtection"))
assert.ok(configModule.TRUSTED_SCOPES.includes("staffLimits"))

assert.equal(Array.isArray(suiteCommands.commands), true)
assert.equal(suiteCommands.commands.length, 1)
assert.equal(suiteCommands.commands[0].toJSON().name, "security")
assert.equal(typeof suiteCommands.handleInteraction, "function")

for (const name of [
    "createSecuritySnapshot",
    "listSecuritySnapshots",
    "restoreSecuritySnapshot",
    "approveBot",
    "consumeBotApproval",
    "setIncidentMode",
    "runSecurityHealthAudit",
    "buildIncidentReport",
    "startSecurityRecoveryScheduler",
]) assert.equal(typeof suite[name], "function", `${name} missing`)
assert.equal(typeof listeners.attachSecurityRecoveryListeners, "function")
assert.equal(typeof listeners.processAdvancedJoin, "function")

assert.deepEqual(protection.staffLimitDefinition("bans", defaults), { key: "bans", threshold: 5 })
assert.deepEqual(protection.staffLimitDefinition("channelDeletes", defaults), { key: "channelChanges", threshold: 8 })
assert.equal(protection.staffLimitDefinition("guildUpdates", defaults), null)

const strict = shield.effectiveShield(defaults, { active: true })
assert.equal(strict.botInviteThreshold, 1)
assert.ok(strict.rapidMessageThreshold < defaults.messageShield.rapidMessageThreshold)
assert.ok(strict.maxMentions < defaults.messageShield.maxMentions)

const fakeMember = {
    user: {
        createdTimestamp: Date.now() - 60 * 60 * 1000,
        avatar: null,
        username: "free-nitro-support-team",
    },
}
const risk = listeners.assessJoinRisk(fakeMember, { antiRaid: { minAccountAgeHours: 72, requireAvatar: true, suspiciousNameCheck: true } }, { active: true })
assert.ok(risk.score >= 6)
assert.ok(risk.signals.length >= 4)
assert.equal(listeners.suspiciousUsername("free-nitro-support-team"), true)
assert.equal(listeners.suspiciousUsername("ordinary-member"), false)

assert.equal(typeof api.createDashboardSecuritySuiteRouter, "function")
assert.equal(typeof api.validateSuiteConfig, "function")
assert.equal(typeof api.performAction, "function")

console.log("security recovery suite contracts passed")