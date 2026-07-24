const test = require("node:test")
const assert = require("node:assert/strict")
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas")
const {
    generateLevelUpCard,
    ensureDisplayFont,
    drawText,
    normalizeText,
    FONT_FAMILY,
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

test("Russo One loads and renders as the primary level-up font", async () => {
    const loaded = await ensureDisplayFont()
    assert.equal(loaded, true)
    assert.equal(GlobalFonts.has(FONT_FAMILY), true)

    const canvas = createCanvas(520, 120)
    const ctx = canvas.getContext("2d")
    const result = drawText(ctx, "LEVEL 25 UNLOCKED", 18, 82, {
        size: 54,
        minSize: 32,
        color: "#FFFFFF",
        maxWidth: 480,
    })

    assert.equal(result.renderer, "font")
    assert.ok(visiblePixelCount(ctx, 520, 120) > 1_000)
})

test("display names remain normalized for reliable card labels", () => {
    assert.equal(normalizeText("Issue"), "ISSUE")
    assert.equal(normalizeText("ＣＵＲＳＥＤ Member ✦"), "CURSED MEMBER")
    assert.equal(normalizeText("Level 4 → 5"), "LEVEL 4 > 5")
})

test("level-up card renders a valid PNG with modern typography", async () => {
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
