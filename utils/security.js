/**
 * Security helpers for CURSED.
 * Keeps optional integrations fail-closed without taking the Discord bot offline.
 */

const crypto = require("crypto")
const { PermissionsBitField } = require("discord.js")
const logger = require("./logger")

const log = logger.child("Security")
const DEFAULT_SECRET_MIN_LENGTH = 24
const replayCache = new Map()
let fatalExitScheduled = false

function isStrongSecret(value, minLength = DEFAULT_SECRET_MIN_LENGTH) {
    return typeof value === "string" && value.trim().length >= minLength
}

function buildInvitePermissions() {
    const flags = PermissionsBitField.Flags
    return new PermissionsBitField([
        flags.ViewChannel,
        flags.SendMessages,
        flags.SendMessagesInThreads,
        flags.EmbedLinks,
        flags.AttachFiles,
        flags.ReadMessageHistory,
        flags.AddReactions,
        flags.ManageMessages,
        flags.ModerateMembers,
        flags.KickMembers,
        flags.BanMembers,
        flags.ManageRoles,
    ]).bitfield.toString()
}

function sanitizeAuditDetails(details = {}) {
    const blocked = /(token|secret|authorization|cookie|password|api.?key|signature)/i
    const safe = {}
    for (const [key, value] of Object.entries(details)) {
        safe[key] = blocked.test(key) ? "[REDACTED]" : value
    }
    return safe
}

function auditSecurityEvent(event, details = {}, level = "info") {
    const method = ["debug", "info", "warn", "error"].includes(level) ? level : "info"
    log[method](event, sanitizeAuditDetails(details))
}

function validateSecurityEnvironment() {
    const status = {
        dashboard: isStrongSecret(process.env.DASHBOARD_API_SECRET, 32),
        kofi: isStrongSecret(process.env.KOFI_WEBHOOK_SECRET),
        patreon: isStrongSecret(process.env.PATREON_WEBHOOK_SECRET),
        bmc: isStrongSecret(process.env.BMC_WEBHOOK_SECRET),
        mongo: Boolean(process.env.MONGO_URI),
        ownerIds: Boolean((process.env.BOT_OWNER_IDS || "").trim()),
        ai: Boolean(process.env.GEMINI_KEY || process.env.GROQ_KEY || process.env.OPENROUTER_KEY),
    }

    if (!status.dashboard) log.warn("Dashboard API disabled until DASHBOARD_API_SECRET is at least 32 characters.")
    if (!status.kofi) log.warn("Ko-fi webhook disabled until KOFI_WEBHOOK_SECRET is configured securely.")
    if (!status.patreon) log.warn("Patreon webhook disabled until PATREON_WEBHOOK_SECRET is configured securely.")
    if (!status.bmc) log.warn("Buy Me a Coffee webhook disabled until BMC_WEBHOOK_SECRET is configured securely.")
    if (!status.mongo) log.warn("MONGO_URI is missing; persistent features may use fallbacks.")
    if (!status.ownerIds) log.warn("BOT_OWNER_IDS is missing; strict owner-only commands will deny access.")
    if (!status.ai) log.warn("No AI provider key is configured; AI features will be unavailable.")

    return status
}

function rawRequestBody(req) {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody
    if (typeof req.rawBody === "string") return Buffer.from(req.rawBody)
    try {
        return Buffer.from(JSON.stringify(req.body ?? null))
    } catch {
        return Buffer.from("")
    }
}

function requestFingerprint(provider, req) {
    const signature =
        req.get?.("x-patreon-signature") ||
        req.get?.("x-bmc-signature") ||
        req.get?.("x-kofi-signature") ||
        ""
    return crypto
        .createHash("sha256")
        .update(String(provider))
        .update("\0")
        .update(String(req.originalUrl || req.path || ""))
        .update("\0")
        .update(String(signature))
        .update("\0")
        .update(rawRequestBody(req))
        .digest("hex")
}

function cleanReplayCache(now = Date.now()) {
    for (const [key, expiresAt] of replayCache) {
        if (expiresAt <= now) replayCache.delete(key)
    }
    while (replayCache.size > 5000) {
        replayCache.delete(replayCache.keys().next().value)
    }
}

function createReplayGuard(provider, ttlMs = 24 * 60 * 60 * 1000) {
    return function replayGuard(req, res, next) {
        const now = Date.now()
        cleanReplayCache(now)
        const fingerprint = requestFingerprint(provider, req)
        const expiresAt = replayCache.get(fingerprint)

        if (expiresAt && expiresAt > now) {
            auditSecurityEvent("webhook_replay_blocked", { provider, path: req.path }, "warn")
            return res.status(409).json({ error: "Duplicate webhook event.", code: "REPLAY_BLOCKED" })
        }

        replayCache.set(fingerprint, now + ttlMs)
        res.once("finish", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) replayCache.delete(fingerprint)
        })
        next()
    }
}

function createSecretGate(envName, label, minLength = DEFAULT_SECRET_MIN_LENGTH) {
    return function secretGate(_req, res, next) {
        if (!isStrongSecret(process.env[envName], minLength)) {
            auditSecurityEvent("integration_disabled", { integration: label, missing: envName }, "warn")
            return res.status(503).json({
                error: `${label} integration is not securely configured.`,
                code: "INTEGRATION_DISABLED",
            })
        }
        next()
    }
}

function installFatalRecovery() {
    process.prependListener("uncaughtException", (err) => {
        if (fatalExitScheduled) return
        fatalExitScheduled = true
        process.exitCode = 1
        auditSecurityEvent("fatal_uncaught_exception", {
            message: err?.message || String(err),
            name: err?.name || "Error",
        }, "error")
        setTimeout(() => process.exit(1), 1000)
    })
}

function installInviteLinkSanitizer() {
    if (console.__cursedInviteSanitizerInstalled) return
    const permissions = buildInvitePermissions()
    const originalLog = console.log.bind(console)
    console.log = (...args) => originalLog(...args.map(value =>
        typeof value === "string"
            ? value.replace(/permissions=8(?=&scope=)/g, `permissions=${permissions}`)
            : value
    ))
    Object.defineProperty(console, "__cursedInviteSanitizerInstalled", { value: true })
}

function installSecurityBootstrap() {
    validateSecurityEnvironment()
    installFatalRecovery()
    installInviteLinkSanitizer()
}

module.exports = {
    DEFAULT_SECRET_MIN_LENGTH,
    isStrongSecret,
    buildInvitePermissions,
    sanitizeAuditDetails,
    auditSecurityEvent,
    validateSecurityEnvironment,
    requestFingerprint,
    createReplayGuard,
    createSecretGate,
    installFatalRecovery,
    installInviteLinkSanitizer,
    installSecurityBootstrap,
}
