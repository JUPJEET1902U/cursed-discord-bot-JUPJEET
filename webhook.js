const express = require("express")
const crypto = require("crypto")
const { getServerConfig } = require("./utils/serverConfig")
const { createDashboardRouter } = require("./api/dashboard")
const { createDashboardControlRouter } = require("./api/dashboardControl")
const { createDashboardWelcomeRouter } = require("./api/dashboardWelcome")
const { createDashboardModerationRouter } = require("./api/dashboardModeration")
const { createDashboardModerationPhase2Router } = require("./api/dashboardModerationPhase2")
const { createDashboardSecurityRouter } = require("./api/dashboardSecurity")
const { createDashboardPrefixRouter } = require("./api/dashboardPrefix")
const { createDashboardTicketsRouter } = require("./api/dashboardTickets")

let discordClient = null
function setClient(client) { discordClient = client }
const DISCORD_EPOCH_MS = 1420070400000
function isValidDiscordId(id) { if (!/^\d{17,19}$/.test(id)) return false; const timestamp = Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS; return timestamp >= DISCORD_EPOCH_MS && timestamp <= Date.now() + 300000 }
function extractDiscordId(text) { const matches = String(text || "").match(/\b(\d{17,19})\b/g) || []; return matches.find(isValidDiscordId) || null }
function verifyKofiToken(token) { const secret=process.env.KOFI_WEBHOOK_SECRET;if(!secret){console.warn("⚠️  KOFI_WEBHOOK_SECRET not set — skipping Ko-fi signature verification");return true}if(!token)return false;try{const a=Buffer.from(String(token)),b=Buffer.from(String(secret));return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch{return false} }
function verifyPatreonSignature(rawBody, signature) { const secret=process.env.PATREON_WEBHOOK_SECRET;if(!secret){console.warn("⚠️  PATREON_WEBHOOK_SECRET not set — skipping Patreon signature verification");return true}if(!signature||!rawBody)return false;try{const expected=crypto.createHmac("md5",secret).update(rawBody).digest("hex");return crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))}catch{return false} }
function verifyBmcSignature(rawBody, signature) { const secret=process.env.BMC_WEBHOOK_SECRET;if(!secret){console.warn("⚠️  BMC_WEBHOOK_SECRET not set — skipping BMC signature verification");return true}if(!signature||!rawBody)return false;try{const expected=crypto.createHmac("sha256",secret).update(rawBody).digest("hex"),sig=signature.startsWith("sha256=")?signature.slice(7):signature;return crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))}catch{return false} }
async function grantPremiumByDiscordId(discordId, platform) { if(!discordClient)return false;if(!isValidDiscordId(discordId)){console.warn(`⚠️  Rejected invalid Discord ID "${discordId}" from ${platform}`);return false}let granted=false;for(const [guildId,guild] of discordClient.guilds.cache){const {config}=getServerConfig(guildId);if(!config.premiumRoleId)continue;try{const member=await guild.members.fetch(discordId).catch(()=>null);if(!member)continue;await member.roles.add(config.premiumRoleId);granted=true;console.log(`✅ Premium granted to ${discordId} via ${platform} in guild: ${guild.name}`);const user=await discordClient.users.fetch(discordId).catch(()=>null);if(user)await user.send(`💎 Thanks for supporting on **${platform}**! Your **Premium** role has been automatically granted in **${guild.name}**. 🎉`).catch(()=>{})}catch(err){console.error(`Failed to grant premium to ${discordId} in ${guild.name}:`,err.message)}}return granted }

function startWebhookServer() {
    const port = Number(process.env.PORT || 3000)
    const app = express()
    app.set("trust proxy", 1)
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
    app.use(express.urlencoded({ extended: true }))
    app.get("/", (_req, res) => res.send("👹 CURSED Bot is alive!"))
    app.get("/health", (_req, res) => res.json({ status:"ok", bot:discordClient?.isReady()??false, guilds:discordClient?.guilds.cache.size??0, uptime:Math.floor(process.uptime()), memory:{heapUsed:process.memoryUsage().heapUsed,heapTotal:process.memoryUsage().heapTotal}, timestamp:new Date().toISOString() }))
    app.use("/api/dashboard", createDashboardWelcomeRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardControlRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardModerationRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardModerationPhase2Router(() => discordClient))
    app.use("/api/dashboard", createDashboardSecurityRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardPrefixRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardTicketsRouter(() => discordClient))
    app.use("/api/dashboard", createDashboardRouter(() => discordClient))
    app.post("/webhook/kofi", async (req,res)=>{try{const raw=req.body?.data;if(!raw)return res.status(400).send("No data");const data=typeof raw==="string"?JSON.parse(raw):raw;if(!verifyKofiToken(data.verification_token))return res.status(401).send("Unauthorized");const discordId=extractDiscordId(`${data.message||""} ${data.from_name||""}`);if(discordId)await grantPremiumByDiscordId(discordId,"Ko-fi");res.status(200).send("OK")}catch{console.error("Ko-fi webhook error: request failed");res.status(500).send("Error")}})
    app.post("/webhook/patreon", async (req,res)=>{try{if(!verifyPatreonSignature(req.rawBody,req.headers["x-patreon-signature"]))return res.status(401).send("Unauthorized");const event=req.headers["x-patreon-event"],body=req.body;if(["members:pledge:create","members:create"].includes(event)){const id=body?.included?.find(item=>item.type==="user")?.attributes?.social_connections?.discord?.user_id||body?.data?.relationships?.user?.data?.id;if(id&&isValidDiscordId(String(id)))await grantPremiumByDiscordId(String(id),"Patreon")}res.status(200).send("OK")}catch{console.error("Patreon webhook error: request failed");res.status(500).send("Error")}})
    app.post("/webhook/bmc", async (req,res)=>{try{if(!verifyBmcSignature(req.rawBody,req.headers["x-bmc-signature"]))return res.status(401).send("Unauthorized");const data=req.body,id=extractDiscordId(`${data?.support_note||""} ${data?.supporter_name||""}`);if(id)await grantPremiumByDiscordId(id,"Buy Me a Coffee");res.status(200).send("OK")}catch{console.error("BMC webhook error: request failed");res.status(500).send("Error")}})
    app.listen(port,"0.0.0.0",()=>{console.log(`\n🌐 Webhook server running on port ${port}`);console.log("   Ko-fi:   POST /webhook/kofi");console.log("   Patreon: POST /webhook/patreon");console.log("   BMC:     POST /webhook/bmc");console.log("   Health:  GET  /health\n")})
    return app
}
module.exports = { startWebhookServer, setClient, grantPremiumByDiscordId }
