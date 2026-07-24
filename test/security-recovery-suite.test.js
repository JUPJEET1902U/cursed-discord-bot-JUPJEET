const assert = require("node:assert/strict")

const configModule = require("../utils/securityPhase3Config")
const suite = require("../utils/securityRecoverySuite")
const listeners = require("../utils/securityRecoveryListeners")
const suiteCommands = require("../commands/securitySuite")
const protection = require("../utils/securityProtection")
const shield = require("../utils/securityMessageShield")
const api = require("../api/dashboardSecuritySuite")

const defaults = configModule.normalizeSecurityPhase3Config({})
assert.equal(defaults.backup.enabled, false)
assert.equal(defaults.backup.intervalHours, 24)
assert.equal(defaults.tamperProtection.enabled, false)
assert.equal(defaults.botApprovals.enabled, false)
assert.equal(defaults.incidentMode.enabled, false)
assert.equal(defaults.staffLimits.enabled, false)
assert.equal(defaults.reports.enabled, false)
assert.equal(defaults.antiRaid.suspiciousNameCheck, false)
assert.equal(defaults.antiRaid.riskScoreThreshold, 2)
assert.ok(configModule.TRUSTED_SCOPES.includes("tamperProtection"))
assert.ok(configModule.TRUSTED_SCOPES.includes("staffLimits"))

const isolated = configModule.normalizeSecurityPhase3Config({
    securityPhase3: {
        enabled: false,
        antiRaid: { enabled: true, joinThreshold: 9, windowSeconds: 20, minAccountAgeHours: 48, action: "quarantine", activeRaidSeconds: 240 },
        antiNuke: { enabled: false },
    },
    securityRecoverySuite: {
        antiRaidAdvanced: { requireAvatar: true, suspiciousNameCheck: false, riskScoreThreshold: 4 },
        backup: { enabled: true, intervalHours: 12, retentionCount: 3, restoreServerSettings: false },
        tamperProtection: { enabled: false, ownerOnlyDisable: true, protectBotRole: true, protectQuarantineRole: false, autoIncidentMode: false },
        botApprovals: { enabled: true, defaultExpiryMinutes: 20, oneTime: true },
        incidentMode: { enabled: true, durationMinutes: 45, autoLockdown: false, strictMessageShield: true, blockUnapprovedBots: true },
        staffLimits: { enabled: true, windowSeconds: 90, action: "quarantine", thresholds: { bans: 4, kicks: 4, channelChanges: 6, roleChanges: 6, webhookChanges: 2 } },
        reports: { enabled: true, maxTimelineEvents: 80, includeAuditDetails: false },
    },
})
assert.equal(isolated.enabled, false)
assert.equal(isolated.antiRaid.joinThreshold, 9)
assert.equal(isolated.antiRaid.riskScoreThreshold, 4)
assert.equal(isolated.backup.intervalHours, 12)
assert.equal(isolated.backup.restoreServerSettings, false)
assert.equal(isolated.tamperProtection.enabled, false)
assert.equal(isolated.staffLimits.action, "quarantine")
assert.equal(isolated.reports.maxTimelineEvents, 80)

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
        username: "test-support-team",
    },
}
const risk = listeners.assessJoinRisk(fakeMember, { antiRaid: { minAccountAgeHours: 72, requireAvatar: true, suspiciousNameCheck: true } }, { active: true })
assert.ok(risk.score >= 6)
assert.ok(risk.signals.length >= 4)
assert.equal(listeners.suspiciousUsername("test-support-team"), true)
assert.equal(listeners.suspiciousUsername("ordinary-member"), false)

assert.equal(typeof api.createDashboardSecuritySuiteRouter, "function")
assert.equal(typeof api.validateSuiteConfig, "function")
assert.equal(typeof api.performAction, "function")

console.log("security recovery suite contracts passed")
