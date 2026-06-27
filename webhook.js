const express = require("express")
const crypto = require("crypto")
const { getServerConfig } = require("./utils/serverConfig")

let discordClient = null

function setClient(client) {
    discordClient = client
}

// ── Discord ID validation ──────────────────────────────────────────────────────
// Discord snowflake IDs are 17-19 digits and must be >= the Discord epoch
// (2015-01-01T00:00:00.000Z = snowflake 0, first real IDs ~2015).
// This rejects phone numbers, credit card numbers, and other numeric strings
// that happen to be 17-20 digits long.
const DISCORD_EPOCH_MS = 1420070400000 // 2015-01-01T00:00:00.000Z

function isValidDiscordId(id) {
    if (!/^\d{17,19}$/.test(id)) return false
    // Extract timestamp from snowflake: top 42 bits >> 22
    const timestamp = Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS
    const now = Date.now()
    // Must be after Discord epoch and not in the future (with 5-minute tolerance)
    return timestamp >= DISCORD_EPOCH_MS && timestamp <= now + 5 * 60 * 1000
}

// Extract the first valid Discord snowflake from a text string
function extractDiscordId(text) {
    const matches = String(text || "").match(/\b(\d{17,19})\b/g) || []
    return matches.find(isValidDiscordId) || null
}

// ── HMAC-SHA256 signature helpers ─────────────────────────────────────────────

/**
 * Verify a Ko-fi webhook token.
 * Ko-fi sends the verification token as a plain string in the JSON payload
 * (data.verification_token). We compare it to our secret using a
 * timing-safe comparison to prevent timing attacks.
 */
function verifyKofiToken(token) {
    const secret = process.env.KOFI_WEBHOOK_SECRET
    if (!secret) {
        console.warn("⚠️  KOFI_WEBHOOK_SECRET not set — skipping Ko-fi signature verification")
        return true // degrade gracefully if secret not configured
    }
    if (!token) return false
    // Use timingSafeEqual to prevent timing attacks
    try {
        const a = Buffer.from(String(token))
        const b = Buffer.from(String(secret))
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

/**
 * Verify a Patreon webhook signature.
 * Patreon signs the raw body with HMAC-MD5 and sends it in X-Patreon-Signature.
 */
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

/**
 * Verify a Buy Me a Coffee webhook signature.
 * BMC sends an HMAC-SHA256 signature in the X-BMC-Signature header.
 */
function verifyBmcSignature(rawBody, signature) {
    const secret = process.env.BMC_WEBHOOK_SECRET
    if (!secret) {
        console.warn("⚠️  BMC_WEBHOOK_SECRET not set — skipping BMC signature verification")
        return true
    }
    if (!signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
        // BMC may prefix with "sha256="
        const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    } catch {
        return false
    }
}

async function grantPremiumByDiscordId(discordId, platform) {
    if (!discordClient) return false

    // Validate the Discord ID before attempting any API calls
    if (!isValidDiscordId(discordId)) {
        console.warn(`⚠️  Rejected invalid Discord ID "${discordId}" from ${platform}`)
        return false
    }

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
    // When API_PORT is set to the same value as PORT (Railway production setup),
    // the API server owns PORT. Use WEBHOOK_PORT for the webhook server, or fall
    // back to PORT+1 so both servers can coexist locally without conflict.
    const mainPort = parseInt(process.env.PORT || '3000')
    const apiPort = process.env.API_PORT ? parseInt(process.env.API_PORT) : null
    const port = process.env.WEBHOOK_PORT
        ? parseInt(process.env.WEBHOOK_PORT)
        : (apiPort === mainPort ? mainPort + 1 : mainPort)
    const app = express()

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
    // Users must include their Discord ID in the donation message.
    // Set KOFI_WEBHOOK_SECRET to your Ko-fi verification token.
    app.post("/webhook/kofi", async (req, res) => {
        try {
            const raw = req.body?.data
            if (!raw) return res.status(400).send("No data")
            const data = typeof raw === "string" ? JSON.parse(raw) : raw

            // Verify Ko-fi verification token
            if (!verifyKofiToken(data.verification_token)) {
                console.warn("⚠️  Ko-fi webhook rejected: invalid verification token")
                return res.status(401).send("Unauthorized")
            }

            console.log(`☕ Ko-fi donation from ${data.from_name} (${data.type})`)

            // Look for a valid Discord snowflake ID in the message
            const searchText = (data.message || "") + " " + (data.from_name || "")
            const discordId = extractDiscordId(searchText)

            if (discordId) {
                const granted = await grantPremiumByDiscordId(discordId, "Ko-fi")
                if (granted) {
                    console.log(`✅ Auto-granted premium for Discord ID ${discordId}`)
                } else {
                    console.log(`⚠️ Could not find Discord user ${discordId} in any guild`)
                }
            } else {
                console.log("⚠️ Ko-fi donation received but no valid Discord ID found in message. Manual grant needed.")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("Ko-fi webhook error: request failed")
            res.status(500).send("Error")
        }
    })

    // Patreon webhook
    // Set your Patreon webhook to: https://your-app.railway.app/webhook/patreon
    // Set PATREON_WEBHOOK_SECRET to your Patreon webhook secret.
    app.post("/webhook/patreon", async (req, res) => {
        try {
            // Verify Patreon HMAC-MD5 signature
            const signature = req.headers["x-patreon-signature"]
            if (!verifyPatreonSignature(req.rawBody, signature)) {
                console.warn("⚠️  Patreon webhook rejected: invalid signature")
                return res.status(401).send("Unauthorized")
            }

            const event = req.headers["x-patreon-event"]
            const body = req.body
            console.log(`🎨 Patreon webhook event: ${event}`)

            if (["members:pledge:create", "members:create"].includes(event)) {
                const rawDiscordId = body?.included?.find(i => i.type === "user")
                    ?.attributes?.social_connections?.discord?.user_id
                    || body?.data?.relationships?.user?.data?.id

                if (rawDiscordId && isValidDiscordId(String(rawDiscordId))) {
                    await grantPremiumByDiscordId(String(rawDiscordId), "Patreon")
                } else {
                    console.log("⚠️ Patreon webhook: no valid Discord ID found. User may need to connect Discord on Patreon.")
                }
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("Patreon webhook error: request failed")
            res.status(500).send("Error")
        }
    })

    // Buy Me a Coffee webhook
    // Set BMC_WEBHOOK_SECRET to your BMC webhook secret.
    app.post("/webhook/bmc", async (req, res) => {
        try {
            // Verify BMC HMAC-SHA256 signature
            const signature = req.headers["x-bmc-signature"]
            if (!verifyBmcSignature(req.rawBody, signature)) {
                console.warn("⚠️  BMC webhook rejected: invalid signature")
                return res.status(401).send("Unauthorized")
            }

            const data = req.body
            console.log(`☕ Buy Me a Coffee webhook from ${data?.supporter_name}`)

            const searchText = (data?.support_note || "") + " " + (data?.supporter_name || "")
            const discordId = extractDiscordId(searchText)
            if (discordId) {
                await grantPremiumByDiscordId(discordId, "Buy Me a Coffee")
            } else {
                console.log("⚠️ BMC donation received but no valid Discord ID in note.")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("BMC webhook error: request failed")
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
