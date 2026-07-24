const express = require("express")
const crypto = require("crypto")
const { createDashboardRouter } = require("./api/dashboard")
const { createDashboardControlRouter } = require("./api/dashboardControl")
const { createDashboardWelcomeRouter } = require("./api/dashboardWelcome")
const { createDashboardModerationRouter } = require("./api/dashboardModeration")
const { createDashboardModerationPhase2Router } = require("./api/dashboardModerationPhase2")
const { createDashboardSecurityRouter } = require("./api/dashboardSecurity")
const { createDashboardSecuritySuiteRouter } = require("./api/dashboardSecuritySuite")
const { createDashboardPrefixRouter } = require("./api/dashboardPrefix")
const { createDashboardTicketsRouter } = require("./api/dashboardTickets")
const { createDashboardPremiumRouter } = require("./api/dashboardPremium")
const { grantPremiumUser } = require("./utils/premium")

let discordClient = null

function setClient(client) {
    discordClient = client
}

const DISCORD_EPOCH_MS = 1420070400000

function prepareDashboardApiRequest(req, _res, next) {
    // /api/dashboard is a private server-to-server API. Vercel deployment
    // origins are not stable and CORS is not an authentication mechanism.
    // Remove Origin before the individual routers run; every router still
    // requires the timing-safe DASHBOARD_API_SECRET bearer token.
    delete req.headers.origin
    next()
}

function isValidDiscordId(id) {
    if (!/^\d{17,19}$/.test(id)) return false
    const timestamp = Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS
    const now = Date.now()
    return timestamp >= DISCORD_EPOCH_MS && timestamp <= now + 5 * 60 * 1000
}

function extractDiscordId(text) {
    const matches = String(text || "").match(/\b(\d{17,19})\b/g) || []
    return matches.find(isValidDiscordId) || null
}

function verifyKofiToken(token) {
    const secret = process.env.KOFI_WEBHOOK_SECRET
    if (!secret) {
        console.warn("⚠️  KOFI_WEBHOOK_SECRET not set — skipping Ko-fi signature verification")
        return true
    }
    if (!token) return false
    try {
        const a = Buffer.from(String(token))
        const b = Buffer.from(String(secret))
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

function verifyPatreonSignature(rawBody, signature) {
    const secret = process.env.PATREON_WEBHOOK_SECRET
    if (!secret) {
        console.warn("⚠️  PATREON_WEBHOOK_SECRET not set — skipping Patreon signature verification")
        return true
    }
    if (!signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("md5", secret).update(rawBody).digest("hex")
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
        return false
    }
}

function verifyBmcSignature(rawBody, signature) {
    const secret = process.env.BMC_WEBHOOK_SECRET
    if (!secret) {
        console.warn("⚠️  BMC_WEBHOOK_SECRET not set — skipping BMC signature verification")
        return true
    }
    if (!signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
        const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    } catch {
        return false
    }
}

async function grantPremiumByDiscordId(discordId, platform) {
    if (!discordClient) return false
    if (!isValidDiscordId(discordId)) {
        console.warn(`⚠️  Rejected invalid Discord ID "${discordId}" from ${platform}`)
        return false
    }

    try {
        const result = await grantPremiumUser(discordId, {
            client: discordClient,
            source: `payment-webhook:${String(platform).toLowerCase().replace(/\s+/g, "-")}`,
            note: `Verified ${platform} payment webhook`,
        })
        const user = await discordClient.users.fetch(discordId).catch(() => null)
        if (user) {
            await user.send(`💎 Thanks for supporting CURSED on **${platform}**! Premium is now active on your Discord account. 🎉`).catch(() => {})
        }
        const roleFailures = result.roleResults.filter(item => !item.ok).length
        console.log(`✅ Premium account activated for ${discordId} via ${platform}${roleFailures ? ` (${roleFailures} role sync warning(s))` : ""}`)
        return true
    } catch (err) {
        console.error(`Failed to activate Premium for ${discordId} via ${platform}:`, err.message)
        return false
    }
}

function startWebhookServer() {
    const port = Number(process.env.PORT || 3000)
    const app = express()
    app.set("trust proxy", 1)

    app.use(express.json({
        verify: (req, _res, buf) => { req.rawBody = buf },
    }))
    app.use(express.urlencoded({ extended: true }))

    app.get("/", (_req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (_req, res) => res.json({
        status: "ok",
        bot: discordClient?.isReady() ?? false,
        guilds: discordClient?.guilds.cache.size ?? 0,
        uptime: Math.floor(process.uptime()),
        memory: {
            heapUsed: process.memoryUsage().heapUsed,
            heapTotal: process.memoryUsage().heapTotal,
        },
        timestamp: new Date().toISOString(),
    }))

    app.use("/api/dashboard", prepareDashboardApiRequest)
    app.use("/api/dashboard", createDashboardPremiumRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardWelcomeRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardControlRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardModerationRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardModerationPhase2Router(() => discordClient))
    app.use("/api/dashboard", createDashboardSecurityRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardSecuritySuiteRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardPrefixRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardTicketsRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardRouter(() => discordClient))

    app.post("/webhook/kofi", async (req, res) => {
        try {
            const raw = req.body?.data
            if (!raw) return res.status(400).send("No data")
            const data = typeof raw === "string" ? JSON.parse(raw) : raw

            if (!verifyKofiToken(data.verification_token)) {
                console.warn("⚠️  Ko-fi webhook rejected: invalid verification token")
                return res.status(401).send("Unauthorized")
            }

            console.log(`☕ Ko-fi donation from ${data.from_name} (${data.type})`)
            const searchText = `${data.message || ""} ${data.from_name || ""}`
            const discordId = extractDiscordId(searchText)

            if (discordId) {
                const granted = await grantPremiumByDiscordId(discordId, "Ko-fi")
                if (!granted) console.log(`⚠️ Could not activate Premium for Discord ID ${discordId}`)
            } else {
                console.log("⚠️ Ko-fi donation received but no valid Discord ID found in message. Manual grant needed.")
            }
            res.status(200).send("OK")
        } catch {
            console.error("Ko-fi webhook error: request failed")
            res.status(500).send("Error")
        }
    })

    app.post("/webhook/patreon", async (req, res) => {
        try {
            const signature = req.headers["x-patreon-signature"]
            if (!verifyPatreonSignature(req.rawBody, signature)) {
                console.warn("⚠️  Patreon webhook rejected: invalid signature")
                return res.status(401).send("Unauthorized")
            }

            const event = req.headers["x-patreon-event"]
            const body = req.body
            console.log(`🎨 Patreon webhook event: ${event}`)

            if (["members:pledge:create", "members:create"].includes(event)) {
                const rawDiscordId = body?.included?.find(item => item.type === "user")
                    ?.attributes?.social_connections?.discord?.user_id
                    || body?.data?.relationships?.user?.data?.id

                if (rawDiscordId && isValidDiscordId(String(rawDiscordId))) {
                    await grantPremiumByDiscordId(String(rawDiscordId), "Patreon")
                } else {
                    console.log("⚠️ Patreon webhook: no valid Discord ID found. User may need to connect Discord on Patreon.")
                }
            }
            res.status(200).send("OK")
        } catch {
            console.error("Patreon webhook error: request failed")
            res.status(500).send("Error")
        }
    })

    app.post("/webhook/bmc", async (req, res) => {
        try {
            const signature = req.headers["x-bmc-signature"]
            if (!verifyBmcSignature(req.rawBody, signature)) {
                console.warn("⚠️  BMC webhook rejected: invalid signature")
                return res.status(401).send("Unauthorized")
            }

            const data = req.body
            console.log(`☕ Buy Me a Coffee webhook from ${data?.supporter_name}`)
            const searchText = `${data?.support_note || ""} ${data?.supporter_name || ""}`
            const discordId = extractDiscordId(searchText)
            if (discordId) await grantPremiumByDiscordId(discordId, "Buy Me a Coffee")
            else console.log("⚠️ BMC donation received but no valid Discord ID in note.")
            res.status(200).send("OK")
        } catch {
            console.error("BMC webhook error: request failed")
            res.status(500).send("Error")
        }
    })

    app.listen(port, "0.0.0.0", () => {
        console.log(`\n🌐 Webhook server running on port ${port}`)
        console.log("   Ko-fi:   POST /webhook/kofi")
        console.log("   Patreon: POST /webhook/patreon")
        console.log("   BMC:     POST /webhook/bmc")
        console.log("   Health:  GET  /health\n")
    })

    return app
}

module.exports = {
    startWebhookServer,
    setClient,
    grantPremiumByDiscordId,
    prepareDashboardApiRequest,
}
