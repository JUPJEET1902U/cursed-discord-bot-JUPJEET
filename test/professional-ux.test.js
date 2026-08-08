const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const ui = require("../utils/responseBuilder")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const helpSource = read("commands", "help.js")
const securitySuiteSource = read("commands", "securitySuite.js")
const securityProtectionSource = read("commands", "securityProtection.js")
const modlogSource = read("utils", "modlog.js")

test("shared response builder uses restrained CURSED branding", () => {
    const success = ui.success("Saved successfully.").toJSON()
    assert.equal(success.title, "Success")
    assert.equal(success.footer.text, "CURSED")
    assert.equal(success.color, ui.COLORS.success)

    const failure = ui.error("Role hierarchy prevents this action.").toJSON()
    assert.equal(failure.title, "Action failed")
    assert.equal(failure.footer.text, "CURSED")
    assert.equal(failure.color, ui.COLORS.error)
})

test("plain status messages use one functional status indicator", () => {
    assert.match(ui.statusLine("success", "Done."), /^✅ Done\.$/)
    assert.match(ui.statusLine("error", "Missing permission."), /^❌ Missing permission\.$/)
    assert.match(ui.statusLine("security", "Incident mode active."), /^🛡️ Incident mode active\.$/)
    assert.match(ui.cooldownMessage("Example", 12, "!daily"), /^⏳ /)
    assert.match(ui.permissionDenied("Manage Server"), /^❌ /)
})

test("help center avoids decorative emoji controls and promotional titles", () => {
    assert.match(helpSource, /setTitle\("CURSED Help"\)/)
    assert.doesNotMatch(helpSource, /\.setEmoji\(/)
    assert.doesNotMatch(helpSource, /CURSED • Help Center/)
    assert.doesNotMatch(helpSource, /Popular Commands/)
    assert.match(helpSource, /name: "Syntax"/)
    assert.match(helpSource, /name: "Permissions"/)
})

test("security commands keep their features while using consistent naming", () => {
    for (const command of ["security", "quarantine", "unquarantine", "lockdown", "security-status"]) {
        const source = command === "security" ? securitySuiteSource : securityProtectionSource
        assert.match(source, new RegExp(`setName\\("${command}"\\)`))
    }
    assert.doesNotMatch(securitySuiteSource, /Advanced CURSED/)
    assert.match(securityProtectionSource, /setTitle\("Server protection"\)/)
    assert.match(securitySuiteSource, /CURSED • Server Protection/)
})

test("moderation logs use clean field labels instead of emoji-heavy labels", () => {
    assert.doesNotMatch(modlogSource, /ACTION_EMOJIS/)
    assert.match(modlogSource, /`Moderation • \$\{actionLabel\(normalizedAction\)\}`/)
    assert.match(modlogSource, /\? "Channel" : "User"/)
    assert.match(modlogSource, /name: "Target ID"/)
    assert.match(modlogSource, /\? "Moderator" : "Source"/)
    assert.match(modlogSource, /name: "Reason"/)
    assert.match(modlogSource, /name: "Details"/)
    assert.match(modlogSource, /name: "Evidence"/)
})
