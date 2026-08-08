const mongoose = require("mongoose")
const { getServerConfig } = require("./serverConfig")
const { normalizeControlConfig } = require("./dashboardControl")
const { getModerationConfig } = require("./moderationConfig")
const { getSecurityPhase3Config } = require("./securityPhase3Config")
const { getWelcome } = require("./welcome")
const { getAutorole } = require("./autorole")
const { getTicketConfig } = require("./ticketConfig")
const { getGuildPrefix } = require("./prefix")
const { getStatus: getAIStatus } = require("./ai")
const {
    getGuildPermissionReport,
    getChannelPermissionReport,
} = require("./botPermissions")

const STATE = Object.freeze({
    READY: "ready",
    DISABLED: "disabled",
    ATTENTION: "attention",
})

function mongoState() {
    const states = {
        0: "Disconnected / fallback",
        1: "Connected",
        2: "Connecting",
        3: "Disconnecting",
    }
    return states[mongoose.connection.readyState] || "Unknown"
}

function providerState() {
    const ai = getAIStatus()
    const providers = [
        ["Gemini", ai.geminiConfigured],
        ["Groq", ai.groqConfigured],
        ["OpenRouter", ai.openRouterConfigured],
    ]
    const configured = providers.filter(([, enabled]) => enabled).map(([name]) => name)
    return {
        configured,
        count: configured.length,
        order: ai.defaultProviderOrder || ["gemini", "groq", "openrouter"],
        lastUsed: ai.lastUsed || "none",
    }
}

function state(name, status, detail) {
    return { name, status, detail }
}

async function optionalAsync(load, fallback) {
    try {
        return await load()
    } catch {
        return fallback
    }
}

async function getSystemStates(guildId, permissionReport) {
    const raw = getServerConfig(guildId).config
    const control = normalizeControlConfig(raw)
    const moderation = getModerationConfig(guildId)
    const security = getSecurityPhase3Config(guildId)
    const welcome = getWelcome(guildId)
    const autorole = getAutorole(guildId)
    const tickets = getTicketConfig(guildId)

    const [leveling, stats] = await Promise.all([
        optionalAsync(
            () => require("./leveling").getLevelingConfig(guildId, { fresh: true }),
            { enabled: false, levelUpChannelId: null }
        ),
        optionalAsync(
            () => require("./activityTracker").getStatsConfig(guildId, { fresh: true }),
            { enabled: false }
        ),
    ])

    const ai = providerState()
    const systems = []

    if (!control.aiEnabled) systems.push(state("AI chat", STATE.DISABLED, "Disabled by server configuration"))
    else if (!ai.count) systems.push(state("AI chat", STATE.ATTENTION, "Enabled but no provider is configured"))
    else systems.push(state("AI chat", STATE.READY, `${ai.count} provider${ai.count === 1 ? "" : "s"} available`))

    if (!moderation.moderationCommandsEnabled) {
        systems.push(state("Moderation", STATE.DISABLED, "Disabled by server configuration"))
    } else if (!permissionReport.moderation.complete) {
        systems.push(state("Moderation", STATE.ATTENTION, `${permissionReport.moderation.missing.length} bot permission${permissionReport.moderation.missing.length === 1 ? "" : "s"} missing`))
    } else {
        systems.push(state("Moderation", STATE.READY, "Full moderation permission set available"))
    }

    if (!security.enabled) {
        systems.push(state("Server protection", STATE.DISABLED, "Protection is opt-in"))
    } else if (!permissionReport.protection.complete) {
        systems.push(state("Server protection", STATE.ATTENTION, `${permissionReport.protection.missing.length} protection permission${permissionReport.protection.missing.length === 1 ? "" : "s"} missing`))
    } else {
        systems.push(state("Server protection", STATE.READY, "Audit and recovery permissions available"))
    }

    if (!welcome.welcomeEnabled) systems.push(state("Welcome", STATE.DISABLED, "Disabled"))
    else systems.push(state("Welcome", STATE.READY, welcome.welcomeChannelId ? "Configured welcome channel" : "System-channel / DM fallback available"))

    if (!tickets.enabled) systems.push(state("Tickets", STATE.DISABLED, "Not configured"))
    else if (!permissionReport.protection.missingLabels.includes("Manage Channels")) systems.push(state("Tickets", STATE.READY, "Enabled"))
    else systems.push(state("Tickets", STATE.ATTENTION, "Manage Channels is required"))

    if (!autorole.autoroleId) systems.push(state("Autorole", STATE.DISABLED, "Not configured"))
    else if (!permissionReport.protection.missingLabels.includes("Manage Roles")) systems.push(state("Autorole", STATE.READY, "Configured"))
    else systems.push(state("Autorole", STATE.ATTENTION, "Manage Roles is required"))

    if (!leveling.enabled) systems.push(state("Leveling", STATE.DISABLED, "Not enabled"))
    else if (!leveling.levelUpChannelId) systems.push(state("Leveling", STATE.ATTENTION, "Enabled without a level-up channel"))
    else systems.push(state("Leveling", STATE.READY, "Enabled"))

    systems.push(state("Activity statistics", stats.enabled ? STATE.READY : STATE.DISABLED, stats.enabled ? "Privacy-safe tracking enabled" : "Not enabled"))

    return { systems, ai, control, moderation, security, welcome, autorole, tickets, leveling, stats }
}

function recommendations({ channelReport, permissionReport, systems, ai }) {
    const items = []

    if (!channelReport.complete) {
        items.push(`Grant CURSED in this channel: ${channelReport.missingLabels.join(", ")}.`)
    }

    const moderation = systems.find(item => item.name === "Moderation")
    if (moderation?.status === STATE.ATTENTION) {
        items.push(`For full moderation, grant: ${permissionReport.moderation.missingLabels.join(", ")}.`)
    }

    const protection = systems.find(item => item.name === "Server protection")
    if (protection?.status === STATE.ATTENTION) {
        items.push(`For full server protection, grant: ${permissionReport.protection.missingLabels.join(", ")}.`)
    }

    if (mongoose.connection.readyState !== 1) {
        items.push("Restore MongoDB connectivity before relying on restart-safe persistence.")
    }

    if (!ai.count) {
        items.push("Configure at least one AI provider before enabling AI chat.")
    }

    for (const system of systems.filter(item => item.status === STATE.ATTENTION)) {
        if (["Moderation", "Server protection", "AI chat"].includes(system.name)) continue
        items.push(`${system.name}: ${system.detail}.`)
    }

    return [...new Set(items)].slice(0, 8)
}

async function buildGuildHealth(guild, channel) {
    const guildId = String(guild?.id || "")
    if (!guildId) throw new Error("Guild context is required")
    const botMember = guild.members?.me || null
    const permissionReport = getGuildPermissionReport(botMember)
    const channelReport = getChannelPermissionReport(botMember, channel)
    const systemState = await getSystemStates(guildId, permissionReport)
    const issues = recommendations({
        channelReport,
        permissionReport,
        systems: systemState.systems,
        ai: systemState.ai,
    })

    const attentionCount = systemState.systems.filter(item => item.status === STATE.ATTENTION).length
    const overall = !channelReport.complete || mongoose.connection.readyState !== 1 || attentionCount
        ? "attention"
        : "ready"

    return {
        overall,
        prefix: getGuildPrefix(guildId),
        database: mongoState(),
        permissionReport,
        channelReport,
        systems: systemState.systems,
        ai: systemState.ai,
        recommendations: issues,
    }
}

function systemStatusLines(systems = []) {
    const icon = { ready: "✅", disabled: "➖", attention: "⚠️" }
    return systems.map(item => `${icon[item.status] || "•"} **${item.name}** — ${item.detail}`)
}

module.exports = {
    STATE,
    mongoState,
    providerState,
    getSystemStates,
    recommendations,
    buildGuildHealth,
    systemStatusLines,
}
