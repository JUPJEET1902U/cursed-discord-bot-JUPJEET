const test = require("node:test")
const assert = require("node:assert/strict")
const {
    utcDateKey,
    splitDurationByUtcDay,
    formatDuration,
    humanizeEnum,
} = require("../utils/activityStatsHelpers")

test("utcDateKey uses UTC calendar dates", () => {
    assert.equal(utcDateKey("2026-07-17T23:59:59.999Z"), "2026-07-17")
})

test("splitDurationByUtcDay separates a voice session at midnight UTC", () => {
    const segments = splitDurationByUtcDay(
        Date.parse("2026-07-17T23:59:30Z"),
        Date.parse("2026-07-18T00:01:00Z")
    )
    assert.deepEqual(segments, [
        { date: "2026-07-17", seconds: 30 },
        { date: "2026-07-18", seconds: 60 },
    ])
})

test("formatDuration is compact and stable", () => {
    assert.equal(formatDuration(0), "0m")
    assert.equal(formatDuration(3660), "1h 1m")
    assert.equal(formatDuration(90000), "1d 1h")
})

test("humanizeEnum formats Discord enum-style values", () => {
    assert.equal(humanizeEnum("VERY_HIGH"), "Very High")
    assert.equal(humanizeEnum("explicitContentFilter"), "Explicit Content Filter")
})
