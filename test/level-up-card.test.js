const test = require("node:test")
const assert = require("node:assert/strict")
const { generateLevelUpCard, WIDTH, HEIGHT } = require("../utils/levelUpCard")

test("level-up card renders a valid PNG with Unicode display names", async () => {
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
    assert.ok(buffer.length > 5_000)
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

    assert.ok(buffer.length > 5_000)
})
