const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")
const { createCanvas } = require("@napi-rs/canvas")
const {
    generateLevelUpCard,
    drawVectorText,
    normalizeText,
    WIDTH,
    HEIGHT,
} = require("../utils/levelUpCard")

function visiblePixelCount(ctx, width, height) {
    const pixels = ctx.getImageData(0, 0, width, height).data
    let visible = 0
    for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 20) visible += 1
    }
    return visible
}

test("critical card text is rendered without system fonts", () => {
    const source = fs.readFileSync(path.join(__dirname, "../utils/levelUpCard.js"), "utf8")
    assert.doesNotMatch(source, /\.fillText\s*\(/)
    assert.doesNotMatch(source, /\.measureText\s*\(/)

    const canvas = createCanvas(420, 100)
    const ctx = canvas.getContext("2d")
    drawVectorText(ctx, "LEVEL 25 UNLOCKED", 10, 78, {
        height: 52,
        color: "#FFFFFF",
        weight: 900,
    })

    assert.ok(visiblePixelCount(ctx, 420, 100) > 1_000)
})

test("display names are normalized into visible Railway-safe glyphs", () => {
    assert.equal(normalizeText("Issue"), "ISSUE")
    assert.equal(normalizeText("ＣＵＲＳＥＤ Member ✦"), "CURSED MEMBER")
    assert.equal(normalizeText("Level 4 → 5"), "LEVEL 4 > 5")
})

test("level-up card renders a valid PNG with all text sections", async () => {
    const user = {
        username: "cursed-user",
        globalName: "ＣＵＲＳＥＤ Member",
        displayAvatarURL: () => null,
    }
    const buffer = await generateLevelUpCard({
        user,
        displayName: "ＣＵＲＳＥＤ Member ✦",
        guildName: "/Hotstar Chilling • Active • Gaming • Dating",
        oldLevel: 4,
        newLevel: 5,
        xp: 680,
        xpGain: 22,
    })

    assert.equal(WIDTH, 1000)
    assert.equal(HEIGHT, 360)
    assert.ok(Buffer.isBuffer(buffer))
    assert.ok(buffer.length > 8_000)
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

test("level-up card derives milestone XP when totals are not supplied", async () => {
    const buffer = await generateLevelUpCard({
        user: { username: "preview", displayAvatarURL: () => null },
        displayName: "Preview Member",
        guildName: "CURSED Test Server",
        oldLevel: 1,
        newLevel: 2,
    })

    assert.ok(buffer.length > 8_000)
})
