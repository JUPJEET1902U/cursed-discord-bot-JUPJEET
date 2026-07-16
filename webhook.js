const crypto = require("crypto")
const express = require("express")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const { PermissionFlagsBits } = require("discord.js")
const { getServerConfig } = require("./utils/serverConfig")
const { createDashboardRouter } = require("./api/dashboard")
const {
    auditSecurityEvent,
    createReplayGuard,
    createSecretGate,
    isStrongSecret,
} = require("./utils/security")

let discordClient = null

function setClient(client) {
    discordClient = client
}

const DISCORD_EPOCH_MS = 1420070400000

function isValidDiscordId(id) {
    if (!/^\d{17,19}$/.test(String(id || ""))) return false
    try {
        const timestamp = Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS
        return timestamp >= DISCORD_EPOCH_MS && timestamp <= Date.now() + 5 * 60 * 1000
    } catch {
        return false
    }
}

function extractDiscordId(text) {
    const matches = String(text || "").match(/\b(\d{17,19})\b/g) || []
    return matches.find(isValidDiscordId) || null
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""))
    const b = Buffer.from(String(right || ""))
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function verifyKofiToken(token) {
    return isStrongSecret(process.env.KOFI_WEBHOOK_SECRET) && safeEqual(token, process.env.KOFI_WEBHOOK_SECRET)
}

function verifyPatreonSignature(rawBody, signature) {
    const secret = process.env.PATREON_WEBHOOK_SECRET
    if (!isStrongSecret(secret) || !signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("md5", secret).update(rawBody).digest("hex")
        return safeEqual(signature, expected)
    } catch {
        return false
    }
}

function verifyBmcSignature(rawBody, signature) {
    const secret = process.env.BMC_WEBHOOK_SECRET
    if (!isStrongSecret(secret) || !signature || !rawBody) return false
    try {
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
        const provided = String(signature).startsWith("sha256=") ? String(signature).slice(7) : String(signature)
        return safeEqual(provided, expected)
    } catch {
        return false
    }
}

async function grantPremiumByDiscordId(discordId, platform) {
    if (!discordClient?.isReady?.() || !isValidDiscordId(discordId)) return false

    let granted = false
    for (const [guildId, guild] of discordClient.guilds.cache) {
        const { config } = getServerConfig(guildId)
        if (!config.premiumRoleId) continue

        try {
            const botMember = guild.members.me
            const role = guild.roles.cache.get(config.premiumRoleId)
            if (!botMember || !role || role.managed) continue
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) continue
            if (role.position >= botMember.roles.highest.position) continue

            const member = await guild.members.fetch(discordId).catch(() => null)
            if (!member) continue

            await member.roles.add(role, `Verified ${platform} supporter webhook`)
            granted = true
            auditSecurityEvent("premium_role_granted", {
                platform,
                guildId,
                userId: discordId,
                roleId: role.id,
            })

            const user = await discordClient.users.fetch(discordId).catch(() => null)
            if (user) {
                await user.send(
                    `💎 Thanks for supporting on **${platform}**! Your **Premium** role has been granted in **${guild.name}**. 🎉`
                ).catch(() => {})
            }
        } catch (err) {
            auditSecurityEvent("premium_role_grant_failed", {
                platform,
                guildId,
                userId: discordId,
                message: err?.message || "Unknown error",
            }, "error")
        }
    }
    return granted
}

function captureRawBody(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer)
}

function webhookLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many webhook requests.", code: "RATE_LIMITED" },
    })
}

function startWebhookServer() {
    const port = Number(process.env.PORT || 3000)
    const app = express()
    app.set("trust proxy", 1)
    app.disable("x-powered-by")
    app.use(helmet({ crossOriginResourcePolicy: false }))
    app.use(rateLimit({
        windowMs: 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => req.path === "/health",
        message: { error: "Too many requests.", code: "RATE_LIMITED" },
    }))
    app.use(express.json({ limit: "100kb", verify: captureRawBody }))
    app.use(express.urlencoded({ extended: true, limit: "100kb", verify: captureRawBody }))

    app.get("/", (_req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }))

    app.use("/api/dashboard", (req, res, next) => {
        if (!isStrongSecret(process.env.DASHBOARD_API_SECRET, 32)) {
            return res.status(503).json({
                error: "Dashboard API is not securely configured.",
                code: "API_NOT_CONFIGURED",
            })
        }
        if (["PUT", "PATCH", "POST", "DELETE"].includes(req.method)) {
            res.once("finish", () => auditSecurityEvent("dashboard_write", {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
            }))
        }
        next()
    }, createDashboardRouter(() => discordClient))

    app.post("/webhook/kofi",
        webhookLimiter(),
        createSecretGate("KOFI_WEBHOOK_SECRET", "Ko-fi"),
        createReplayGuard("kofi"),
        async (req, res) => {
            try {
                const raw = req.body?.data
                if (!raw) return res.status(400).send("No data")
                const data = typeof raw === "string" ? JSON.parse(raw) : raw
                if (!verifyKofiToken(data.verification_token)) {
                    auditSecurityEvent("webhook_rejected", { provider: "Ko-fi", reason: "invalid_token" }, "warn")
                    return res.status(401).send("Unauthorized")
                }

                const discordId = extractDiscordId(`${data.message || ""} ${data.from_name || ""}`)
                if (discordId) await grantPremiumByDiscordId(discordId, "Ko-fi")
                res.status(200).send("OK")
            } catch {
                auditSecurityEvent("webhook_processing_failed", { provider: "Ko-fi" }, "error")
                res.status(500).send("Error")
            }
        }
    )

    app.post("/webhook/patreon",
        webhookLimiter(),
        createSecretGate("PATREON_WEBHOOK_SECRET", "Patreon"),
        createReplayGuard("patreon"),
        async (req, res) => {
            try {
                const signature = req.get("x-patreon-signature")
                if (!verifyPatreonSignature(req.rawBody, signature)) {
                    auditSecurityEvent("webhook_rejected", { provider: "Patreon", reason: "invalid_signature" }, "warn")
                    return res.status(401).send("Unauthorized")
                }

                const event = req.get("x-patreon-event")
                if (["members:pledge:create", "members:create"].includes(event)) {
                    const rawDiscordId = req.body?.included?.find(item => item.type === "user")
                        ?.attributes?.social_connections?.discord?.user_id
                    if (rawDiscordId && isValidDiscordId(rawDiscordId)) {
                        await grantPremiumByDiscordId(String(rawDiscordId), "Patreon")
                    }
                }
                res.status(200).send("OK")
            } catch {
                auditSecurityEvent("webhook_processing_failed", { provider: "Patreon" }, "error")
                res.status(500).send("Error")
            }
        }
    )

    app.post("/webhook/bmc",
        webhookLimiter(),
        createSecretGate("BMC_WEBHOOK_SECRET", "Buy Me a Coffee"),
        createReplayGuard("bmc"),
        async (req, res) => {
            try {
                const signature = req.get("x-bmc-signature")
                if (!verifyBmcSignature(req.rawBody, signature)) {
                    auditSecurityEvent("webhook_rejected", { provider: "Buy Me a Coffee", reason: "invalid_signature" }, "warn")
                    return res.status(401).send("Unauthorized")
                }

                const discordId = extractDiscordId(`${req.body?.support_note || ""} ${req.body?.supporter_name || ""}`)
                if (discordId) await grantPremiumByDiscordId(discordId, "Buy Me a Coffee")
                res.status(200).send("OK")
            } catch {
                auditSecurityEvent("webhook_processing_failed", { provider: "Buy Me a Coffee" }, "error")
                res.status(500).send("Error")
            }
        }
    )

    app.use((err, _req, res, _next) => {
        if (err?.type === "entity.too.large") {
            return res.status(413).json({ error: "Request body too large.", code: "PAYLOAD_TOO_LARGE" })
        }
        auditSecurityEvent("http_request_failed", { message: err?.message || "Unknown error" }, "error")
        res.status(500).json({ error: "Internal server error.", code: "INTERNAL_ERROR" })
    })

    app.listen(port, "0.0.0.0", () => {
        console.log(`\n🌐 CURSED server running on port ${port}`)
        console.log("   Health:    GET  /health")
        console.log("   Dashboard: /api/dashboard/*")
        console.log("   Payments:  POST /webhook/kofi | /webhook/patreon | /webhook/bmc\n")
    })

    return app
}

module.exports = {
    startWebhookServer,
    setClient,
    grantPremiumByDiscordId,
    isValidDiscordId,
    extractDiscordId,
    verifyKofiToken,
    verifyPatreonSignature,
    verifyBmcSignature,
}
