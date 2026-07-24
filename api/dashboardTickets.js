const crypto = require("crypto")
const express = require("express")
const rateLimit = require("express-rate-limit")
const { ChannelType } = require("discord.js")
const { updateGuildConfigAndWait, getGuildConfig } = require("../utils/serverConfig")
const { normalizeTicketConfig } = require("../utils/ticketConfig")
const { getGuildPlanLimits, isGuildPremium } = require("../utils/premium")
const {
    createPanel, updatePanel, deletePanel, publishPanel, listPanels, listTickets,
    ticketAnalytics, getTicket, closeTicket, reopenTicket, deleteTicket, setTicketPriority,
} = require("../utils/ticketService")

const SNOWFLAKE = /^\d{17,20}$/

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ""))
    const y = Buffer.from(String(b || ""))
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

function auth(req, res, next) {
    const secret = process.env.DASHBOARD_API_SECRET
    const provided = (req.get("authorization") || "").replace(/^Bearer /, "")
    if (!secret) return res.status(503).json({ error: "Dashboard API is not configured.", code: "API_NOT_CONFIGURED" })
    if (!safeEqual(provided, secret)) return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" })
    next()
}

function origin(req, res, next) {
    res.set("Cache-Control", "no-store")
    const incoming = req.get("origin")
    const dashboard = process.env.DASHBOARD_URL
    if (incoming && (!dashboard || incoming !== dashboard)) return res.status(403).json({ error: "Origin is not allowed.", code: "ORIGIN_DENIED" })
    next()
}

function guildOr(getClient, id, res) {
    if (!SNOWFLAKE.test(id || "")) {
        res.status(400).json({ error: "Invalid guild ID.", code: "INVALID_GUILD_ID" })
        return null
    }
    const client = getClient()
    if (!client?.isReady()) {
        res.status(503).json({ error: "Bot is not ready.", code: "BOT_NOT_READY" })
        return null
    }
    const guild = client.guilds.cache.get(id)
    if (!guild) {
        res.status(404).json({ error: "CURSED is not added to this server.", code: "BOT_NOT_IN_GUILD" })
        return null
    }
    return guild
}

function panelInput(body = {}, limits) {
    return {
        name: String(body.name || "Support Panel").slice(0, 80),
        title: String(body.title || "✦ CURSED Support Center").slice(0, 256),
        description: String(body.description || "Choose a category to open a private ticket.").slice(0, 4000),
        color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#8B5CF6",
        imageUrl: body.imageUrl ? String(body.imageUrl).slice(0, 1000) : null,
        footer: String(body.footer || "Powered by CURSED Support").slice(0, 2048),
        style: body.style === "buttons" ? "buttons" : "select",
        enabled: body.enabled !== false,
        categories: Array.isArray(body.categories)
            ? body.categories.slice(0, limits.ticketCategoriesPerPanel).map((category, index) => ({
                id: String(category.id || `category-${index + 1}`).replace(/[^a-z0-9_-]/gi, "-").slice(0, 40),
                label: String(category.label || `Category ${index + 1}`).slice(0, 80),
                description: category.description ? String(category.description).slice(0, 100) : null,
                emoji: String(category.emoji || "🎫").slice(0, 50),
                categoryId: SNOWFLAKE.test(String(category.categoryId || "")) ? String(category.categoryId) : null,
                supportRoleIds: Array.isArray(category.supportRoleIds)
                    ? category.supportRoleIds.filter(value => SNOWFLAKE.test(String(value))).slice(0, 10)
                    : [],
                priority: ["low", "normal", "high", "urgent"].includes(category.priority) ? category.priority : "normal",
                questions: Array.isArray(category.questions)
                    ? category.questions.slice(0, limits.ticketQuestionsPerCategory).map((question, questionIndex) => ({
                        id: String(question.id || `question-${questionIndex + 1}`).replace(/[^a-z0-9_-]/gi, "-").slice(0, 40),
                        label: String(question.label || "Question").slice(0, 45),
                        placeholder: question.placeholder ? String(question.placeholder).slice(0, 100) : null,
                        style: question.style === "short" ? "short" : "paragraph",
                        required: question.required !== false,
                    }))
                    : [],
            }))
            : [],
    }
}

async function payload(guild) {
    const [panels, tickets, analytics] = await Promise.all([
        listPanels(guild.id),
        listTickets(guild.id, { limit: 100 }),
        ticketAnalytics(guild.id),
    ])
    const limits = getGuildPlanLimits(guild)
    return {
        config: normalizeTicketConfig(getGuildConfig(guild.id)),
        panels,
        tickets,
        analytics,
        plan: isGuildPremium(guild) ? "premium" : "free",
        planLimits: {
            panels: limits.ticketPanels,
            categoriesPerPanel: limits.ticketCategoriesPerPanel,
            questionsPerCategory: limits.ticketQuestionsPerCategory,
            historyDays: limits.ticketHistoryDays,
            ticketCount: "unlimited",
        },
        channels: [...guild.channels.cache.values()]
            .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory].includes(channel.type))
            .map(channel => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null })),
        roles: [...guild.roles.cache.values()]
            .filter(role => role.id !== guild.id && !role.managed)
            .sort((a, b) => b.position - a.position)
            .map(role => ({ id: role.id, name: role.name, color: role.color, editable: role.editable })),
    }
}

function createDashboardTicketsRouter(getClient) {
    const router = express.Router()
    router.use(origin, auth, rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }))

    router.get("/guilds/:guildId/tickets", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try { res.json({ data: await payload(guild) }) }
        catch { res.status(500).json({ error: "Could not load ticket settings.", code: "TICKET_LOAD_FAILED" }) }
    })

    router.put("/guilds/:guildId/tickets", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            await updateGuildConfigAndWait(guild.id, { tickets: normalizeTicketConfig(req.body) })
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(err.code === "MONGO_UNAVAILABLE" ? 503 : 500).json({ error: err.message, code: err.code || "TICKET_SAVE_FAILED" })
        }
    })

    router.post("/guilds/:guildId/tickets/panels", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            const limits = getGuildPlanLimits(guild)
            const existing = await listPanels(guild.id)
            if (existing.length >= limits.ticketPanels) {
                return res.status(403).json({
                    error: `This plan supports ${limits.ticketPanels} ticket panel(s). Ticket creation itself remains unlimited.`,
                    code: "PREMIUM_PANEL_LIMIT",
                })
            }
            const panel = await createPanel(guild.id, panelInput(req.body, limits), { id: req.get("x-dashboard-user-id") })
            res.json({ data: { panel, payload: await payload(guild) } })
        } catch (err) {
            res.status(422).json({ error: err.message, code: err.code || "PANEL_CREATE_FAILED" })
        }
    })

    router.put("/guilds/:guildId/tickets/panels/:panelId", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            const panel = await updatePanel(guild.id, req.params.panelId, panelInput(req.body, getGuildPlanLimits(guild)), { id: req.get("x-dashboard-user-id") })
            if (!panel) return res.status(404).json({ error: "Panel not found.", code: "PANEL_NOT_FOUND" })
            res.json({ data: { panel, payload: await payload(guild) } })
        } catch (err) {
            res.status(422).json({ error: err.message, code: "PANEL_UPDATE_FAILED" })
        }
    })

    router.delete("/guilds/:guildId/tickets/panels/:panelId", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        const panel = await deletePanel(guild, req.params.panelId)
        if (!panel) return res.status(404).json({ error: "Panel not found.", code: "PANEL_NOT_FOUND" })
        res.json({ data: await payload(guild) })
    })

    router.post("/guilds/:guildId/tickets/panels/:panelId/publish", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        try {
            await publishPanel(guild, req.params.panelId, String(req.body?.channelId || ""), { id: req.get("x-dashboard-user-id") })
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: err.code || "PANEL_PUBLISH_FAILED" })
        }
    })

    router.patch("/guilds/:guildId/tickets/:ticketId", async (req, res) => {
        const guild = guildOr(getClient, req.params.guildId, res)
        if (!guild) return
        const ticket = await getTicket(guild.id, req.params.ticketId)
        if (!ticket) return res.status(404).json({ error: "Ticket not found.", code: "TICKET_NOT_FOUND" })
        const actor = guild.members.me
        try {
            if (req.body.action === "close") await closeTicket(guild, ticket, actor, req.body.reason || "Closed from dashboard")
            else if (req.body.action === "reopen") await reopenTicket(guild, ticket, actor)
            else if (req.body.action === "delete") await deleteTicket(guild, ticket, actor)
            else if (req.body.action === "priority") await setTicketPriority(guild, ticket, req.body.priority, actor)
            else return res.status(422).json({ error: "Unknown ticket action.", code: "VALIDATION_ERROR" })
            res.json({ data: await payload(guild) })
        } catch (err) {
            res.status(422).json({ error: err.message, code: "TICKET_ACTION_FAILED" })
        }
    })

    return router
}

module.exports = { createDashboardTicketsRouter }
