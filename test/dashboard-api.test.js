const assert = require("node:assert/strict")
const { after, before, test } = require("node:test")
const express = require("express")
const mongoose = require("mongoose")
const {
    createDashboardRouter,
    validateAutorole,
    validateWelcome,
} = require("../api/dashboard")
const { trustAuthenticatedDashboardRequest } = require("../webhook")

const GUILD_ID = "123456789012345678"
const OTHER_GUILD_ID = "223456789012345678"
const SECRET = "dashboard-api-test-secret"

let server
let baseUrl

before(async () => {
    process.env.DASHBOARD_API_SECRET = SECRET
    process.env.DASHBOARD_URL = "https://dashboard.example.com"
    const client = {
        isReady: () => true,
        ws: { ping: 42 },
        uptime: 120000,
        user: { presence: { status: "online" } },
        guilds: {
            cache: new Map([
                [GUILD_ID, {
                    id: GUILD_ID,
                    name: "Test Guild",
                    memberCount: 10,
                    premiumSubscriptionCount: 2,
                    iconURL: () => null,
                }],
            ]),
        },
    }

    const app = express()
    app.set("trust proxy", 1)
    app.use(express.json())
    app.use("/api/dashboard", trustAuthenticatedDashboardRequest)
    app.use("/api/dashboard", createDashboardRouter(() => client))
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve)
    })
    baseUrl = `http://127.0.0.1:${server.address().port}/api/dashboard`
})

after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve())
    })
})

test("GuildConfig model uses the shared guildConfigs collection", () => {
    assert.equal(mongoose.model("GuildConfig").collection.collectionName, "guildConfigs")
})

test("dashboard API rejects missing server credentials", async () => {
    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 401)
})

test("health returns safe availability data", async () => {
    const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${SECRET}` },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.bot.ready, true)
    assert.equal(body.data.bot.pingMs, 42)
    assert.equal("token" in body.data, false)
})

test("authenticated server request is not rejected for a deployment origin", async () => {
    const response = await fetch(`${baseUrl}/health`, {
        headers: {
            Authorization: `Bearer ${SECRET}`,
            Origin: "https://temporary-preview.vercel.app",
        },
    })
    assert.equal(response.status, 200)
})

test("untrusted browser origin remains rejected", async () => {
    const response = await fetch(`${baseUrl}/health`, {
        headers: {
            Authorization: "Bearer incorrect-secret",
            Origin: "https://temporary-preview.vercel.app",
        },
    })
    assert.equal(response.status, 403)
})

test("guild presence reports only guilds in the live client cache", async () => {
    const response = await fetch(`${baseUrl}/guilds/presence`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${SECRET}`,
            "Content-Type": "application/json",
            Origin: "https://changing-deployment.vercel.app",
        },
        body: JSON.stringify({ guildIds: [GUILD_ID, OTHER_GUILD_ID] }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.data.presentGuildIds, [GUILD_ID])
})

test("welcome validation rejects unknown and unsafe fields", () => {
    const errors = validateWelcome({
        welcomeChannelId: null,
        welcomeMessage: "Welcome {user}",
        welcomeUseAI: false,
        welcomeColor: "#5865F2",
        welcomeThumbnail: true,
        welcomeImageUrl: "javascript:alert(1)",
        welcomeFooter: null,
        botToken: "must-not-be-accepted",
    })
    assert.ok(errors.welcomeImageUrl)
    assert.ok(errors.botToken)
})

test("autorole validation accepts only one nullable role ID", () => {
    assert.deepEqual(validateAutorole({ autoroleId: null }), {})
    assert.ok(validateAutorole({ autoroleId: GUILD_ID, roleIds: [GUILD_ID] }).roleIds)
})