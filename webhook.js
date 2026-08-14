const express = require("express")
const crypto = require("crypto")
const rateLimit = require("express-rate-limit")
require("./utils/serverPremium")
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
const { createDashboardBirthdaysRouter } = require("./api/dashboardBirthdays")
const { createDashboardCustomRolesRouter } = require("./api/dashboardCustomRoles")
const { startBirthdayScheduler } = require("./utils/birthdays")
const { grantPremiumUser } = require("./utils/premium")

let discordClient = null

function setClient(client) {
    discordClient = client
    startBirthdayScheduler(client)
}

const DISCORD_EPOCH_MS = 1420070400000
const WEBHOOK_REPLAY_TTL_MS = 24 * 60 * 60 * 1000
const WEBHOOK_REPLAY_MAX = 5000
const processedWebhookEvents = new Map()
const missingSecretWarnings = new Set()

function prepareDashboardApiRequest(req, res, next) {
    // /api/dashboard is a private server-to-server API. Vercel deployment
    // origins are not stable and CORS is not an authentication mechanism.
    // Remove Origin before the individual routers run; every router still
    // requires the timing-safe DASHBOARD_API_SECRET bearer token.
    delete req.headers.origin
    res.set("Cache-Control", "no-store")
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

function warnMissingSecretOnce(name) {
    if (missingSecretWarnings.has(name)) return
    missingSecretWarnings.add(name)
    console.warn(`⚠️  ${name} is not set — the corresponding payment webhook is disabled and will fail closed`)
}

function safeEqual(left, right) {
    try {
        const a = Buffer.from(String(left || ""))
        const b = Buffer.from(String(right || ""))
        return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

function verifyKofiToken(token) {
    const secret = process.env.KOFI_WEBHOOK_SECRET
    if (!secret) {
        warnMissingSecretOnce("KOFI_WEBHOOK_SECRET")
        return false
    }
    return safeEqual(token, secret)
}

function verifyPatreonSignature(rawBody, signature) {
    const secret = process.env.PATREON_WEBHOOK_SECRET
    if (!secret) {
        warnMissingSecretOnce("PATREON_WEBHOOK_SECRET")
        return false
    }
    if (!signature || !rawBody || !/^[a-f0-9]{32}$/i.test(String(signature))) return false
    try {
        const expected = crypto.createHmac("md5", secret).update(rawBody).digest("hex")
        return safeEqual(String(signature).toLowerCase(), expected)
    } catch {
        return false
    }
}

function verifyBmcSignature(rawBody, signature) {
    const secret = process.env.BMC_WEBHOOK_SECRET
    if (!secret) {
        warnMissingSecretOnce("BMC_WEBHOOK_SECRET")
        return false
    }
    if (!signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
        const sig = String(signature).startsWith("sha256=") ? String(signature).slice(7) : String(signature)
        if (!/^[a-f0-9]{64}$/i.test(sig)) return false
        return safeEqual(sig.toLowerCase(), expected)
    } catch {
        return false
    }
}

function pruneWebhookReplayCache(currentTime = Date.now()) {
    const cutoff = currentTime - WEBHOOK_REPLAY_TTL_MS
    for (const [key, timestamp] of processedWebhookEvents) {
        if (timestamp < cutoff) processedWebhookEvents.delete(key)
    }
    while (processedWebhookEvents.size > WEBHOOK_REPLAY_MAX) {
        const oldest = processedWebhookEvents.keys().next().value
        if (!oldest) break
        processedWebhookEvents.delete(oldest)
    }
}

function webhookReplayKey(platform, explicitId, rawBody, body) {
    const stableId = explicitId ? String(explicitId) : ""
    const material = stableId
        || (rawBody && Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "")
        || JSON.stringify(body || {})
    return `${String(platform).toLowerCase()}:${crypto.createHash("sha256").update(material).digest("hex")}`
}

function markWebhookEventOnce(key, currentTime = Date.now()) {
    pruneWebhookReplayCache(currentTime)
    if (!key) return false
    if (processedWebhookEvents.has(key)) return false
    processedWebhookEvents.set(key, currentTime)
    return true
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
    app.disable("x-powered-by")
    app.set("trust proxy", 1)

    app.use(express.json({
        limit: "256kb",
        strict: true,
        verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf) },
    }))
    app.use(express.urlencoded({ extended: true, limit: "128kb", parameterLimit: 100 }))

    const webhookLimiter = rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: "Too many webhook requests",
    })
    app.use("/webhook", webhookLimiter)

    app.get("/", (_req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (_req, res) => {
        res.set("Cache-Control", "no-store")
        const payload = {
            status: "ok",
            bot: discordClient?.isReady() ?? false,
            timestamp: new Date().toISOString(),
        }
        if (process.env.NODE_ENV !== "production") {
            payload.guilds = discordClient?.guilds.cache.size ?? 0
            payload.uptime = Math.floor(process.uptime())
            payload.memory = {
                heapUsed: process.memoryUsage().heapUsed,
                heapTotal: process.memoryUsage().heapTotal,
            }
        }
        return res.json(payload)
    })

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
    app.use("/api/dashboard", createDashboardBirthdaysRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardCustomRolesRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardRouter(() => discordClient))

    app.post("/webhook/kofi", async (req, res) => {
        try {
            const raw = req.body?.data
            if (!raw) return res.status(400).send("No data")
            const data = typeof raw === "string" ? JSON.parse(raw) : raw

            if (!verifyKofiToken(data.verification_token)) {
                console.warn("⚠️  Ko-fi webhook rejected: verification unavailable or token invalid")
                return res.status(401).send("Unauthorized")
            }

            const replayKey = webhookReplayKey("kofi", data.kofi_transaction_id || data.transaction_id, req.rawBody, data)
            if (!markWebhookEventOnce(replayKey)) {
                console.warn("⚠️  Ko-fi duplicate webhook ignored")
                return res.status(200).send("OK")
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
                console.warn("⚠️  Patreon webhook rejected: verification unavailable or signature invalid")
                return res.status(401).send("Unauthorized")
            }

            const event = req.headers["x-patreon-event"]
            const body = req.body
            const replayKey = webhookReplayKey("patreon", null, req.rawBody, body)
            if (!markWebhookEventOnce(replayKey)) {
                console.warn("⚠️  Patreon duplicate webhook ignored")
                return res.status(200).send("OK")
            }
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
                console.warn("⚠️  BMC webhook rejected: verification unavailable or signature invalid")
                return res.status(401).send("Unauthorized")
            }

            const data = req.body
            const replayKey = webhookReplayKey("bmc", data?.support_id || data?.id, req.rawBody, data)
            if (!markWebhookEventOnce(replayKey)) {
                console.warn("⚠️  Buy Me a Coffee duplicate webhook ignored")
                return res.status(200).send("OK")
            }
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
    verifyKofiToken,
    verifyPatreonSignature,
    verifyBmcSignature,
    webhookReplayKey,
    markWebhookEventOnce,
}
