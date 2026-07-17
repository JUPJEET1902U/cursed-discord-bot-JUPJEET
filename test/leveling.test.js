const test = require("node:test")
const assert = require("node:assert/strict")
const {
    xpNeededForNextLevel,
    totalXpForLevel,
    levelFromXp,
    getLevelProgress,
    buildProgressBar,
    normalizeMessageContent,
    isMeaningfulMessage,
} = require("../utils/levelingMath")

test("level thresholds follow the configured curve", () => {
    assert.equal(xpNeededForNextLevel(0), 100)
    assert.equal(xpNeededForNextLevel(1), 155)
    assert.equal(totalXpForLevel(0), 0)
    assert.equal(totalXpForLevel(1), 100)
    assert.equal(totalXpForLevel(2), 255)
})

test("levelFromXp changes only at exact cumulative thresholds", () => {
    assert.equal(levelFromXp(0), 0)
    assert.equal(levelFromXp(99), 0)
    assert.equal(levelFromXp(100), 1)
    assert.equal(levelFromXp(254), 1)
    assert.equal(levelFromXp(255), 2)
})

test("level progress is relative to the current level", () => {
    const progress = getLevelProgress(150)
    assert.equal(progress.level, 1)
    assert.equal(progress.current, 50)
    assert.equal(progress.needed, 155)
    assert.equal(progress.total, 150)
    assert.ok(progress.ratio > 0 && progress.ratio < 1)
})

test("progress bars stay within the requested width", () => {
    assert.equal(buildProgressBar(0, 10), "░".repeat(10))
    assert.equal(buildProgressBar(1, 10), "█".repeat(10))
    assert.equal(buildProgressBar(0.5, 10).length, 10)
})

test("message eligibility rejects commands and obvious spam", () => {
    assert.equal(isMeaningfulMessage("!daily"), false)
    assert.equal(isMeaningfulMessage("aa"), false)
    assert.equal(isMeaningfulMessage("aaaaaa"), false)
    assert.equal(isMeaningfulMessage("hello everyone"), true)
    assert.equal(isMeaningfulMessage("great game 🎮"), true)
})

test("content normalization removes mention IDs and repeated spaces", () => {
    assert.equal(normalizeMessageContent("  HELLO   <@123456789012345678>  "), "hello @user")
})
