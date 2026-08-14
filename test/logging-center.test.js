const test = require("node:test")
const assert = require("node:assert/strict")

const {
    LOG_CATEGORY_KEYS,
    categoryDefaults,
    normalizeLogsConfig,
} = require("../utils/loggingConfig")
const {
    synchronizedPatch,
    validateConfig,
} = require("../api/dashboardLogging")

function fullConfig(overrides = {}) {
    return Object.fromEntries(LOG_CATEGORY_KEYS.map(key => [
        key,
        { ...categoryDefaults(key), ...(overrides[key] || {}) },
    ]))
}

test("legacy logging destinations are preserved before unified config exists", () => {
    const config = normalizeLogsConfig({
        moderationPhase2: {
            logging: {
                messageDeleteEnabled: true,
                messageEditEnabled: false,
                memberUpdateEnabled: true,
                storeDeletedMessageContent: true,
                messageLogChannelId: "12345678901234567",
                memberLogChannelId: "22345678901234567",
            },
        },
        modLogChannelId: "32345678901234567",
        securityPhase3: { securityLogChannelId: "42345678901234567" },
        tickets: { logChannelId: "52345678901234567" },
    })

    assert.equal(config.messageDelete.enabled, true)
    assert.equal(config.messageDelete.channelId, "12345678901234567")
    assert.equal(config.messageDelete.includeContent, true)
    assert.equal(config.messageEdit.enabled, false)
    assert.equal(config.memberNicknameChange.channelId, "22345678901234567")
    assert.equal(config.moderationAction.channelId, "32345678901234567")
    assert.equal(config.securityAlert.channelId, "42345678901234567")
    assert.equal(config.ticketEvent.channelId, "52345678901234567")
    assert.equal(config.voiceJoin.enabled, false)
})

test("explicit unified config overrides legacy routing", () => {
    const config = normalizeLogsConfig({
        modLogChannelId: "32345678901234567",
        logs: {
            moderationAction: {
                ...categoryDefaults("moderationAction"),
                enabled: false,
                channelId: null,
            },
            voiceJoin: {
                ...categoryDefaults("voiceJoin"),
                enabled: true,
                channelId: "62345678901234567",
                color: "#123ABC",
            },
        },
    })

    assert.equal(config.moderationAction.enabled, false)
    assert.equal(config.moderationAction.channelId, null)
    assert.equal(config.voiceJoin.enabled, true)
    assert.equal(config.voiceJoin.channelId, "62345678901234567")
    assert.equal(config.voiceJoin.color, "#123ABC")
})

test("dashboard validation requires a sendable channel for enabled logs", () => {
    const config = fullConfig({
        memberJoin: { enabled: true, channelId: null },
    })
    const channels = [{ id: "72345678901234567" }]
    const errors = validateConfig(config, channels)
    assert.match(errors.memberJoin[0], /Choose a log channel/i)
})

test("dashboard validation accepts complete unified config", () => {
    const channelId = "82345678901234567"
    const config = fullConfig({
        memberJoin: { enabled: true, channelId },
        messageDelete: { enabled: true, channelId, includeContent: true },
    })
    const errors = validateConfig(config, [{ id: channelId }])
    assert.deepEqual(errors, {})
})

test("saving logs mirrors legacy subsystem destinations without dropping unrelated fields", () => {
    const channelId = "92345678901234567"
    const config = fullConfig({
        messageDelete: { enabled: true, channelId, includeContent: true },
        memberNicknameChange: { enabled: true, channelId },
        moderationAction: { enabled: true, channelId },
        securityAlert: { enabled: true, channelId },
        ticketEvent: { enabled: true, channelId },
    })

    const patch = synchronizedPatch({
        moderationPhase2: {
            advancedModerationEnabled: true,
            logging: { keepMe: "yes" },
        },
        securityPhase3: { enabled: true, keepSecurity: 1 },
        tickets: { enabled: true, keepTickets: 2 },
    }, config)

    assert.equal(patch.moderationPhase2.advancedModerationEnabled, true)
    assert.equal(patch.moderationPhase2.logging.keepMe, "yes")
    assert.equal(patch.moderationPhase2.logging.storeDeletedMessageContent, true)
    assert.equal(patch.modLogChannelId, channelId)
    assert.equal(patch.securityPhase3.securityLogChannelId, channelId)
    assert.equal(patch.securityPhase3.keepSecurity, 1)
    assert.equal(patch.tickets.logChannelId, channelId)
    assert.equal(patch.tickets.keepTickets, 2)
})

test("logging runtime registers only valid Discord event names", () => {
    const { attachLoggingCenter } = require("../utils/loggingRuntime")
    const events = []
    attachLoggingCenter({
        on(event, listener) {
            assert.equal(typeof event, "string")
            assert.equal(typeof listener, "function")
            events.push(event)
        },
    })
    assert.ok(events.length >= 18)
})
