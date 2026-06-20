const express = require("express")
const crypto = require("crypto")
const { getServerConfig } = require("./utils/serverConfig")

let discordClient = null

function setClient(client) {
    discordClient = client
}

/**
 * Verify an HMAC-SHA256 signature.
 * Returns true if the signature matches or if no secret is configured (opt-in).
 */
function verifyHmacSignature(secret, payload, signature) {
    if (!secret) return true // secret not configured — skip verification
    if (!signature) return false
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex")
    // Use timingSafeEqual to prevent timing attacks
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature.replace(/^sha256=/, ""), "hex"),
            Buffer.from(expected, "hex")
        )
    } catch {
        return false
    }
}

/**
 * Extract a Discord snowflake ID from text.
 * Prefers explicitly labelled IDs (e.g. "Discord: 123456789012345678").
 * Falls back to a bare 17-20 digit word-bounded number.
 * Returns null if no valid ID is found.
 */
function extractDiscordId(text) {
    if (!text) return null
    // Prefer explicitly labelled IDs first
    const labelledMatch = text.match(/discord(?:\s*id)?[:\s]+(\d{17,20})\b/i)
    if (labelledMatch) return labelledMatch[1]
    // Fall back to bare snowflake — must be word-bounded and exactly 17-20 digits
    const bareMatch = text.match(/\b(\d{17,20})\b/)
    if (bareMatch) return bareMatch[1]
    return null
}

async function grantPremiumByDiscordId(discordId, platform) {
    if (!discordClient) return false
    let granted = false

    for (const [guildId, guild] of discordClient.guilds.cache) {
        const { config } = getServerConfig(guildId)
        if (!config.premiumRoleId) continue

        try {
            const member = await guild.members.fetch(discordId).catch(() => null)
            if (!member) continue

            await member.roles.add(config.premiumRoleId)
            granted = true
            console.log(`✅ Premium granted to ${discordId} via ${platform} in guild: ${guild.name}`)

            const user = await discordClient.users.fetch(discordId).catch(() => null)
            if (user) {
                await user.send(`💎 Thanks for supporting on **${platform}**! Your **Premium** role has been automatically granted in **${guild.name}**. 🎉`).catch(() => {})
            }
        } catch (err) {
            console.error(`Failed to grant premium to ${discordId} in ${guild.name}:`, err.message)
        }
    }

    return granted
}

function startWebhookServer() {
    const port = process.env.PORT || 3000
    const app = express()

    // ── In-process rate limiter for webhook endpoints ──────────────────────────
    const webhookHits = new Map()
    const WEBHOOK_RATE_WINDOW_MS = 60 * 1000 // 1 minute
    const WEBHOOK_RATE_MAX = 30              // max 30 requests per minute per IP

    function webhookRateLimit(req, res, next) {
        const ip = req.ip || req.connection.remoteAddress || "unknown"
        const now = Date.now()
        const entry = webhookHits.get(ip) || { count: 0, windowStart: now }

        if (now - entry.windowStart > WEBHOOK_RATE_WINDOW_MS) {
            entry.count = 0
            entry.windowStart = now
        }

        entry.count++
        webhookHits.set(ip, entry)

        if (entry.count > WEBHOOK_RATE_MAX) {
            console.warn(`[Webhook] Rate limit exceeded for IP ${ip}`)
            return res.status(429).send("Too Many Requests")
        }
        next()
    }

    // Periodically clean up stale rate-limit entries
    setInterval(() => {
        const now = Date.now()
        for (const [ip, entry] of webhookHits) {
            if (now - entry.windowStart > WEBHOOK_RATE_WINDOW_MS * 2) {
                webhookHits.delete(ip)
            }
        }
    }, WEBHOOK_RATE_WINDOW_MS * 2)

    // Parse raw body for signature verification before JSON parsing
    app.use(express.json({
        verify: (req, _res, buf) => { req.rawBody = buf }
    }))
    app.use(express.urlencoded({ extended: true }))

    app.get("/", (req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (req, res) => res.json({
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

    // Ko-fi webhook
    // Set your Ko-fi webhook to: https://your-app.railway.app/webhook/kofi
    // Users must include their Discord ID in the donation message
    app.post("/webhook/kofi", webhookRateLimit, async (req, res) => {
        const ip = req.ip || "unknown"
        try {
            // Verify HMAC-SHA256 signature if secret is configured
            const secret = process.env.WEBHOOK_KOFI_SECRET
            const signature = req.headers["x-kofi-signature"] || req.headers["x-signature"]
            const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body)
            if (!verifyHmacSignature(secret, rawBody, signature)) {
                console.warn(`[Webhook] Ko-fi: signature verification failed from IP ${ip}`)
                return res.status(401).send("Invalid signature")
            }

            const raw = req.body?.data
            if (!raw) return res.status(400).send("No data")
            const data = typeof raw === "string" ? JSON.parse(raw) : raw

            console.log(`[Webhook] Ko-fi donation from ${data.from_name} (${data.type})`)

            // Extract Discord ID from message/name — prefer labelled format
            const searchText = (data.message || "") + " " + (data.from_name || "")
            const discordId = extractDiscordId(searchText)

            if (discordId) {
                const granted = await grantPremiumByDiscordId(discordId, "Ko-fi")
                if (granted) {
                    console.log(`[Webhook] Ko-fi: premium granted for Discord ID ${discordId}`)
                } else {
                    console.log(`[Webhook] Ko-fi: Discord ID ${discordId} not found in any guild`)
                }
            } else {
                console.log("[Webhook] Ko-fi: no Discord ID found in message — manual grant needed")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("[Webhook] Ko-fi error:", err.message)
            res.status(500).send("Error")
        }
    })

    // Patreon webhook
    // Set your Patreon webhook to: https://your-app.railway.app/webhook/patreon
    // Requires Patreon to have Discord connected to member accounts
    app.post("/webhook/patreon", webhookRateLimit, async (req, res) => {
        const ip = req.ip || "unknown"
        try {
            // Verify MD5 HMAC signature (Patreon uses MD5)
            const secret = process.env.WEBHOOK_PATREON_SECRET
            const signature = req.headers["x-patreon-signature"]
            const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body)
            if (secret) {
                if (!signature) {
                    console.warn(`[Webhook] Patreon: missing signature from IP ${ip}`)
                    return res.status(401).send("Missing signature")
                }
                const expected = crypto.createHmac("md5", secret).update(rawBody).digest("hex")
                let valid = false
                try {
                    const sigBuffer = Buffer.from(signature, "hex")
                    const expBuffer = Buffer.from(expected, "hex")
                    valid = sigBuffer.length === expBuffer.length &&
                        crypto.timingSafeEqual(sigBuffer, expBuffer)
                } catch { valid = false }
                if (!valid) {
                    console.warn(`[Webhook] Patreon: signature verification failed from IP ${ip}`)
                    return res.status(401).send("Invalid signature")
                }
            }

            const event = req.headers["x-patreon-event"]
            const body = req.body
            console.log(`[Webhook] Patreon event: ${event}`)

            if (["members:pledge:create", "members:create"].includes(event)) {
                const discordId = body?.included?.find(i => i.type === "user")
                    ?.attributes?.social_connections?.discord?.user_id
                    || body?.data?.relationships?.user?.data?.id

                if (discordId && /^\d{17,20}$/.test(discordId)) {
                    await grantPremiumByDiscordId(discordId, "Patreon")
                    console.log(`[Webhook] Patreon: premium granted for Discord ID ${discordId}`)
                } else {
                    console.log("[Webhook] Patreon: no valid Discord ID found — user may need to connect Discord on Patreon")
                }
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("[Webhook] Patreon error:", err.message)
            res.status(500).send("Error")
        }
    })

    // Buy Me a Coffee webhook
    app.post("/webhook/bmc", webhookRateLimit, async (req, res) => {
        const ip = req.ip || "unknown"
        try {
            // Verify HMAC-SHA256 signature if secret is configured
            const secret = process.env.WEBHOOK_BMC_SECRET
            const signature = req.headers["x-bmc-signature"] || req.headers["x-signature"]
            const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body)
            if (!verifyHmacSignature(secret, rawBody, signature)) {
                console.warn(`[Webhook] BMC: signature verification failed from IP ${ip}`)
                return res.status(401).send("Invalid signature")
            }

            const data = req.body
            console.log(`[Webhook] BMC donation from ${data?.supporter_name}`)

            const searchText = (data?.support_note || "") + " " + (data?.supporter_name || "")
            const discordId = extractDiscordId(searchText)
            if (discordId) {
                await grantPremiumByDiscordId(discordId, "Buy Me a Coffee")
                console.log(`[Webhook] BMC: premium granted for Discord ID ${discordId}`)
            } else {
                console.log("[Webhook] BMC: no Discord ID found in note")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("[Webhook] BMC error:", err.message)
            res.status(500).send("Error")
        }
    })

    app.listen(port, "0.0.0.0", () => {
        console.log(`\n🌐 Webhook server running on port ${port}`)
        console.log(`   Ko-fi:   POST /webhook/kofi`)
        console.log(`   Patreon: POST /webhook/patreon`)
        console.log(`   BMC:     POST /webhook/bmc`)
        console.log(`   Health:  GET  /health\n`)
    })

    return app
}

module.exports = { startWebhookServer, setClient, grantPremiumByDiscordId }
