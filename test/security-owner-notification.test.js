const assert = require("node:assert/strict")
const {
    cleanAction,
    parseBotAddAlert,
    buildOwnerNotification,
} = require("../utils/securityOwnerNotification")

const removal = "🚨 CURSED detected **ANTI_NUKE_ADDED_BOT_REMOVAL** in **Test Server**. Unauthorized bot addition: inviter added BadBot (123456789012345678). Response: bot banned."
assert.equal(parseBotAddAlert(removal).suppress, true)
assert.equal(buildOwnerNotification({ name: "Test Server" }, removal), null)

const combined = "🚨 CURSED detected **ANTI_NUKE_BOTADDS** in **Test Server**. Unauthorized bot addition: inviter007 added BadBot#0001 (123456789012345678). Added bot response: bot banned. Inviter response: quarantine. Response: quarantine."
const parsed = parseBotAddAlert(combined)
assert.equal(parsed.server, "Test Server")
assert.equal(parsed.inviter, "inviter007")
assert.equal(parsed.bot, "BadBot#0001")
assert.equal(parsed.botId, "123456789012345678")
assert.equal(parsed.botAction, "Banned")
assert.equal(parsed.inviterAction, "Quarantined")

const payload = buildOwnerNotification({ name: "Test Server" }, combined)
assert.equal(payload.embeds.length, 1)
const json = payload.embeds[0].toJSON()
assert.equal(json.title, "🚨 Unauthorized Bot Blocked")
assert.match(json.description, /protected \*\*Test Server\*\*/)
assert.equal(json.fields.find(field => field.name === "Bot action").value, "Banned")
assert.equal(json.fields.find(field => field.name === "Inviter action").value, "Quarantined")
assert.equal(cleanAction("bot kicked"), "Kicked")

console.log("security owner notification formatting passed")
