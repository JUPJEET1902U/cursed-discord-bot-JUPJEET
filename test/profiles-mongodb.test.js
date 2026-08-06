const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const profilesSource = fs.readFileSync(path.join(root, "utils", "profiles.js"), "utf8")
const modelSource = fs.readFileSync(path.join(root, "database", "profileModel.js"), "utf8")
const commandSource = fs.readFileSync(path.join(root, "commands", "profiles.js"), "utf8")

test("profile persistence no longer writes to JSON", () => {
    assert.doesNotMatch(profilesSource, /writeFileSync\s*\(/)
    assert.match(profilesSource, /ProfileData\.bulkWrite\s*\(/)
})

test("legacy profiles are imported without overwriting MongoDB records", () => {
    assert.match(profilesSource, /\$setOnInsert/)
    assert.match(profilesSource, /upsert:\s*true/)
})

test("profile documents preserve the complete legacy profile object", () => {
    assert.match(modelSource, /mongoose\.Schema\.Types\.Mixed/)
    assert.match(modelSource, /collection:\s*"profile_users"/)
})

test("existing synchronous profile API remains available", () => {
    for (const functionName of ["loadProfiles", "saveProfiles", "getProfile", "setProfile"]) {
        assert.match(profilesSource, new RegExp(`function ${functionName}\\(`))
        assert.doesNotMatch(profilesSource, new RegExp(`async function ${functionName}\\(`))
    }
})

test("clear profile keeps the existing null-profile behaviour", () => {
    assert.match(profilesSource, /profileCache\[userId\] = profile/)
    assert.match(profilesSource, /return profileCache\[userId\] \|\| null/)
    assert.match(commandSource, /setProfile\(userId, null\)/)
})

test("profile commands and user-facing profile fields remain unchanged", () => {
    assert.match(commandSource, /setProfile\(userId, \{ personality, updatedAt: new Date\(\)\.toISOString\(\) \}\)/)
    assert.match(commandSource, /if \(profile\?\.personality\)/)
    assert.match(commandSource, /AI Profile:/)
    assert.match(commandSource, /CURSED Profile/)
})

test("separate AI personality settings remain outside profile persistence", () => {
    assert.match(commandSource, /getUserPersonality/)
    assert.match(commandSource, /setUserPersonality/)
    assert.match(commandSource, /resetUserPersonality/)
})

test("profile store initializes automatically and retries temporary failures", () => {
    assert.match(profilesSource, /initializeProfileStore\(\)/)
    assert.match(profilesSource, /scheduleRetry\(\)/)
    assert.match(profilesSource, /pendingWrites/)
})
