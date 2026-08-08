const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const ui = require("../utils/responseBuilder")
const product = require("../utils/productSystem")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const helpSource = read("commands", "help.js")
const securitySuiteSource = read("commands", "securitySuite.js")
const securityProtectionSource = read("commands", "securityProtection.js")
const modlogSource = read("utils", "modlog.js")
const economySource = read("commands", "economy.js")
const funSource = read("commands", "fun.js")

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
    assert.match(ui.botPermissionMissing("Manage Messages"), /^❌ /)
})

test("product identity exposes a small stable public hierarchy", () => {
    assert.equal(product.BRAND.name, "CURSED")
    assert.match(product.BRAND.tagline, /server protection/i)
    assert.ok(product.SECTION_DEFINITIONS.length <= 5)
    assert.ok(product.SECTION_DEFINITIONS.some(section => section.name === "Server Management"))
    assert.equal(product.cleanCategoryName("🛡️ Moderation"), "Moderation")
})

test("help center is section-first and avoids decorative emoji controls", () => {
    assert.match(helpSource, /setTitle\("CURSED"\)/)
    assert.match(helpSource, /help_section/)
    assert.match(helpSource, /Choose a section/)
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

test("moderation logs use operational field labels", () => {
    assert.doesNotMatch(modlogSource, /ACTION_EMOJIS/)
    assert.match(modlogSource, /`Moderation • \$\{actionLabel\(normalizedAction\)\}`/)
    assert.match(modlogSource, /\? "Channel" : "User"/)
    assert.match(modlogSource, /name: "Target ID"/)
    assert.match(modlogSource, /\? "Moderator" : "Source"/)
    assert.match(modlogSource, /name: "Reason"/)
    assert.match(modlogSource, /name: "Details"/)
    assert.match(modlogSource, /name: "Evidence"/)
})

test("economy and fun commands use shared presentation instead of insulting boilerplate", () => {
    assert.match(economySource, /responseBuilder/)
    assert.match(funSource, /responseBuilder/)
    assert.doesNotMatch(economySource, /\bbroke\b|\bgenius\b|greedy/i)
    assert.doesNotMatch(funSource, /not as dumb|use your brain next time/i)
})
