const assert = require("node:assert/strict")

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

console.log("moderation hardening contracts passed")
