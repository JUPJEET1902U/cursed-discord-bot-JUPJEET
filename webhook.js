const express = require("express")
const { getServerConfig } = require("./utils/serverConfig")

let discordClient = null

function setClient(client) {
    discordClient = client
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

    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    app.get("/", (req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (req, res) => res.json({
        status: "ok",
        bot: discordClient?.isReady() ?? false,
        guilds: discordClient?.guilds.cache.size ?? 0
    }))

    // Ko-fi webhook
    // Set your Ko-fi webhook to: https://your-app.replit.app/webhook/kofi
    // Users must include their Discord ID in the donation message
    app.post("/webhook/kofi", async (req, res) => {
        try {
            const raw = req.body?.data
            if (!raw) return res.status(400).send("No data")
            const data = typeof raw === "string" ? JSON.parse(raw) : raw

            console.log(`☕ Ko-fi donation from ${data.from_name} (${data.type}): "${data.message}"`)

            // Look for a Discord user ID (17-20 digit number) in the message
            const searchText = (data.message || "") + " " + (data.from_name || "")
            const discordIdMatch = searchText.match(/\b(\d{17,20})\b/)

            if (discordIdMatch) {
                const granted = await grantPremiumByDiscordId(discordIdMatch[1], "Ko-fi")
                if (granted) {
                    console.log(`✅ Auto-granted premium for Discord ID ${discordIdMatch[1]}`)
                } else {
                    console.log(`⚠️ Could not find Discord user ${discordIdMatch[1]} in any guild`)
                }
            } else {
                console.log("⚠️ Ko-fi donation received but no Discord ID found in message. Manual grant needed.")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("Ko-fi webhook error:", err.message)
            res.status(500).send("Error")
        }
    })

    // Patreon webhook
    // Set your Patreon webhook to: https://your-app.replit.app/webhook/patreon
    // Requires Patreon to have Discord connected to member accounts
    app.post("/webhook/patreon", async (req, res) => {
        try {
            const event = req.headers["x-patreon-event"]
            const body = req.body
            console.log(`🎨 Patreon webhook event: ${event}`)

            if (["members:pledge:create", "members:create"].includes(event)) {
                const discordId = body?.included?.find(i => i.type === "user")
                    ?.attributes?.social_connections?.discord?.user_id
                    || body?.data?.relationships?.user?.data?.id

                if (discordId) {
                    await grantPremiumByDiscordId(discordId, "Patreon")
                } else {
                    console.log("⚠️ Patreon webhook: no Discord ID found. User may need to connect Discord on Patreon.")
                }
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("Patreon webhook error:", err.message)
            res.status(500).send("Error")
        }
    })

    // Buy Me a Coffee webhook
    app.post("/webhook/bmc", async (req, res) => {
        try {
            const data = req.body
            console.log(`☕ Buy Me a Coffee webhook from ${data?.supporter_name}: "${data?.support_note}"`)

            const searchText = (data?.support_note || "") + " " + (data?.supporter_name || "")
            const discordIdMatch = searchText.match(/\b(\d{17,20})\b/)
            if (discordIdMatch) {
                await grantPremiumByDiscordId(discordIdMatch[1], "Buy Me a Coffee")
            } else {
                console.log("⚠️ BMC donation received but no Discord ID in note.")
            }

            res.status(200).send("OK")
        } catch (err) {
            console.error("BMC webhook error:", err.message)
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
