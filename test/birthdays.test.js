const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")
const { ChannelType } = require("discord.js")
const {
    parseBirthdayInput,
    birthdayMatchesDate,
    getDateParts,
    renderTemplate,
    upsertBirthday,
    updateBirthdayConfig,
    runBirthdayCheck,
} = require("../utils/birthdays")
const { normalizeSettings, parseEntryBody } = require("../api/dashboardBirthdays")

const FALLBACK_FILE = path.resolve(process.cwd(), "birthdayData.json")
const GUILD_ONE = "123456789012345678"
const GUILD_TWO = "223456789012345678"
const USER_ID = "323456789012345678"
const CHANNEL_ONE = "423456789012345678"

function fakeGuild(id, announcements, dms) {
    const member = {
        id: USER_ID,
        displayName: "Birthday Member",
        user: {
            username: "birthday-member",
            globalName: "Birthday Member",
            send: async payload => dms.push({ guildId: id, payload }),
        },
    }
    const channel = {
        id: CHANNEL_ONE,
        type: ChannelType.GuildText,
        isTextBased: () => true,
        send: async payload => announcements.push({ guildId: id, payload }),
    }
    return {
        id,
        name: `Guild ${id.slice(0, 3)}`,
        members: {
            cache: new Map([[USER_ID, member]]),
            fetch: async userId => userId === USER_ID ? member : null,
        },
        channels: { cache: new Map([[CHANNEL_ONE, channel]]) },
    }
}

test.after(() => {
    try { fs.unlinkSync(FALLBACK_FILE) } catch {}
})

test("birthday parser accepts optional years and rejects impossible dates", () => {
    assert.deepEqual(parseBirthdayInput("24-07"), { ok: true, day: 24, month: 7, year: null })
    assert.deepEqual(parseBirthdayInput("24/07/2006"), { ok: true, day: 24, month: 7, year: 2006 })
    assert.equal(parseBirthdayInput("31-02").ok, false)
})

test("29 February birthdays move to 28 February in non-leap years", () => {
    const entry = { day: 29, month: 2 }
    assert.equal(birthdayMatchesDate(entry, { year: 2025, month: 2, day: 28 }), true)
    assert.equal(birthdayMatchesDate(entry, { year: 2024, month: 2, day: 28 }), false)
    assert.equal(birthdayMatchesDate(entry, { year: 2024, month: 2, day: 29 }), true)
})

test("timezone conversion and templates are deterministic", () => {
    const parts = getDateParts("Asia/Kolkata", new Date("2026-07-23T19:00:00.000Z"))
    assert.deepEqual(parts, { year: 2026, month: 7, day: 24 })
    const output = renderTemplate("Happy birthday {user} in {server}! {birthday}", {
        userId: USER_ID,
        username: "Birthday Member",
        guildName: "Test Guild",
        entry: { day: 24, month: 7 },
        age: null,
        dm: false,
    })
    assert.match(output, new RegExp(USER_ID))
    assert.match(output, /Test Guild/)
    assert.match(output, /24 July/)
})

test("dashboard validation accepts proper settings and birthday data", () => {
    const settings = normalizeSettings({ timezone: "Asia/Kolkata", announcementChannelId: CHANNEL_ONE }, {
        announcementTemplate: "A",
        dmTemplate: "B",
    })
    assert.equal(settings.timezone, "Asia/Kolkata")
    assert.equal(settings.announcementChannelId, CHANNEL_ONE)
    assert.deepEqual(parseEntryBody({ day: 24, month: 7, year: "" }), { day: 24, month: 7, year: null })
    assert.throws(() => normalizeSettings({ timezone: "Moon/Base" }, {}), /valid IANA timezone/)
})

test("scheduler announces only in the server where the birthday is recorded", async () => {
    const announcements = []
    const dms = []
    const guildOne = fakeGuild(GUILD_ONE, announcements, dms)
    const guildTwo = fakeGuild(GUILD_TWO, announcements, dms)
    const client = {
        isReady: () => true,
        guilds: { cache: new Map([[GUILD_ONE, guildOne], [GUILD_TWO, guildTwo]]) },
    }

    await upsertBirthday(GUILD_ONE, USER_ID, { day: 24, month: 7, year: 2006 }, USER_ID)
    await updateBirthdayConfig(GUILD_ONE, {
        timezone: "UTC",
        announcementChannelId: CHANNEL_ONE,
        announcementEnabled: true,
        dmEnabled: false,
    }, USER_ID)
    await updateBirthdayConfig(GUILD_TWO, {
        timezone: "UTC",
        announcementChannelId: CHANNEL_ONE,
        announcementEnabled: true,
        dmEnabled: false,
    }, USER_ID)

    const first = await runBirthdayCheck(client, new Date("2026-07-24T09:00:00.000Z"))
    assert.equal(first.announcements, 1)
    assert.equal(announcements.length, 1)
    assert.equal(announcements[0].guildId, GUILD_ONE)
    assert.match(announcements[0].payload.content, /HAPPY BIRTHDAY/)

    const second = await runBirthdayCheck(client, new Date("2026-07-24T10:00:00.000Z"))
    assert.equal(second.announcements, 0)
    assert.equal(announcements.length, 1)
})
