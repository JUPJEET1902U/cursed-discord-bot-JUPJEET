const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const birthdaySource = read("utils", "birthdays.js")
const commandSource = read("commands", "birthdays.js")
const dashboardSource = read("api", "dashboardBirthdays.js")
const auditSource = read("docs", "birthday-persistence-audit.md")

test("birthday data stays in the existing MongoDB collections", () => {
    assert.match(birthdaySource, /collection:\s*"birthdayEntries"/)
    assert.match(birthdaySource, /collection:\s*"birthdayGuildConfigs"/)
    assert.match(birthdaySource, /collection:\s*"birthdayDmDeliveries"/)
    assert.match(birthdaySource, /index\(\{ guildId: 1, userId: 1 \}, \{ unique: true \}\)/)
})

test("birthdayData.json is read-only legacy input", () => {
    assert.match(birthdaySource, /FALLBACK_FILE.*birthdayData\.json/)
    assert.match(birthdaySource, /fs\.readFileSync\(FALLBACK_FILE, "utf8"\)/)
    assert.doesNotMatch(birthdaySource, /fs\.writeFileSync\s*\(/)
    assert.doesNotMatch(birthdaySource, /fs\.copyFileSync\s*\(/)
    assert.doesNotMatch(birthdaySource, /fs\.renameSync\s*\(/)
    assert.doesNotMatch(birthdaySource, /fs\.unlinkSync\s*\(/)
})

test("legacy import is idempotent and existing MongoDB state wins", () => {
    assert.match(birthdaySource, /BirthdayEntry\.bulkWrite/)
    assert.match(birthdaySource, /BirthdayGuildConfig\.bulkWrite/)
    assert.match(birthdaySource, /BirthdayDmDelivery\.bulkWrite/)
    assert.match(birthdaySource, /\$setOnInsert/g)
    assert.match(birthdaySource, /migratedFrom:\s*"birthdayData\.json"/)
    assert.match(birthdaySource, /BirthdayEntry\.find\(\{\}\)\.lean\(\)/)
    assert.match(birthdaySource, /BirthdayDmDelivery\.find\(\{\}\)\.lean\(\)/)
})

test("removed birthdays use tombstones and stay hidden", () => {
    assert.match(birthdaySource, /deleted:\s*\{ type: Boolean, default: false/)
    assert.match(birthdaySource, /\$set:\s*\{ deleted: true, deletedAt: new Date\(\), lastAnnouncementKey: null \}/)
    assert.match(birthdaySource, /deleted:\s*\{ \$ne: true \}/)
    assert.doesNotMatch(birthdaySource, /BirthdayEntry\.deleteOne\s*\(/)
    assert.match(birthdaySource, /entryTombstones/)
})

test("DM delivery releases use retained active-state tombstones", () => {
    assert.match(birthdaySource, /active:\s*\{ type: Boolean, default: true/)
    assert.match(birthdaySource, /releasedAt:\s*\{ type: Date, default: null \}/)
    assert.match(birthdaySource, /BirthdayDmDelivery\.updateMany\(\s*\{ active: \{ \$exists: false \} \}/)
    assert.match(birthdaySource, /active:\s*false/)
    assert.match(birthdaySource, /releasedDmDeliveries/)
    assert.doesNotMatch(birthdaySource, /BirthdayDmDelivery\.deleteOne\s*\(/)
})

test("writes made while MongoDB connects are queued and replayed", () => {
    assert.match(birthdaySource, /pendingEntryWrites = new Map\(\)/)
    assert.match(birthdaySource, /pendingConfigWrites = new Map\(\)/)
    assert.match(birthdaySource, /pendingDmWrites = new Map\(\)/)
    assert.match(birthdaySource, /flushPendingBirthdayWrites/)
    assert.match(birthdaySource, /for \(const \[key, mutation\] of pendingEntryWrites\)/)
    assert.match(birthdaySource, /scheduleRetry\(\)/)
})

test("date, timezone, template, scoping and scheduler behavior remain intact", () => {
    assert.match(birthdaySource, /Use `DD-MM` or `DD-MM-YYYY`/)
    assert.match(birthdaySource, /entry\.month === 2 && entry\.day === 29/)
    assert.match(birthdaySource, /new Intl\.DateTimeFormat\("en-US", \{ timeZone:/)
    for (const placeholder of ["{user}", "{username}", "{server}", "{age}", "{birthday}"]) {
        assert.ok(birthdaySource.includes(placeholder), `missing placeholder ${placeholder}`)
    }
    assert.match(birthdaySource, /entryKey\(guildId, userId\)/)
    assert.match(birthdaySource, /intervalMs = 10 \* 60 \* 1000/)
    assert.match(birthdaySource, /setTimeout\(run, 15_000\)/)
    assert.match(birthdaySource, /Math\.max\(60_000, intervalMs\)/)
    assert.match(birthdaySource, /if \(!client\?\.isReady\?\.\(\) \|\| schedulerRunning\)/)
})

test("commands and dashboard keep using the same birthday facade", () => {
    for (const name of [
        "parseBirthdayInput", "getBirthdayConfig", "updateBirthdayConfig",
        "upsertBirthday", "listBirthdays", "removeBirthday", "formatBirthday",
    ]) {
        assert.ok(commandSource.includes(name), `commands missing ${name}`)
        if (name !== "getBirthdayConfig" || dashboardSource.includes(name)) {
            assert.ok(dashboardSource.includes(name), `dashboard missing ${name}`)
        }
    }
    assert.match(dashboardSource, /Use a valid IANA timezone such as Asia\/Kolkata\./)
    assert.match(dashboardSource, /res\.json\(\{ data: await payload\(guild\) \}\)/)
})

test("audit covers persistent stores, caches, delivery state and scheduler state", () => {
    for (const term of [
        "birthdayEntries", "birthdayGuildConfigs", "birthdayDmDeliveries", "birthdayData.json",
        "entryCache", "entryTombstones", "configCache", "activeDmDeliveries",
        "releasedDmDeliveries", "schedulerHandle", "schedulerRunning",
    ]) {
        assert.ok(auditSource.includes(term), `audit is missing ${term}`)
    }
    assert.match(auditSource, /MongoDB is authoritative/)
    assert.match(auditSource, /read once as a legacy import source/)
})
