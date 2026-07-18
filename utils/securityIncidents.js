const mongoose = require("mongoose")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const securityIncidentSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true, maxlength: 64 },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium", index: true },
    executorId: { type: String, default: null, index: true },
    executorTag: { type: String, default: "Unknown executor", maxlength: 256 },
    targetId: { type: String, default: null },
    targetTag: { type: String, default: null, maxlength: 256 },
    actionTaken: { type: String, default: "alert", maxlength: 64 },
    status: { type: String, enum: ["open", "resolved", "ignored"], default: "open", index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    auditLogEntryId: { type: String, default: null, index: true },
    resolvedAt: { type: Date, default: null },
    resolvedById: { type: String, default: null },
    resolutionNote: { type: String, default: null, maxlength: 2000 },
}, { collection: "securityIncidents", timestamps: true, minimize: false })

securityIncidentSchema.index({ guildId: 1, createdAt: -1 })
securityIncidentSchema.index(
    { guildId: 1, auditLogEntryId: 1 },
    { unique: true, partialFilterExpression: { auditLogEntryId: { $type: "string" } } }
)

const SecurityIncident = getModel("SecurityIncident", securityIncidentSchema)

function mongoReady() {
    return mongoose.connection.readyState === 1
}

async function createSecurityIncident(input) {
    if (!mongoReady()) return null
    try {
        const doc = await SecurityIncident.create({
            guildId: String(input.guildId),
            type: String(input.type || "UNKNOWN").slice(0, 64),
            severity: ["low", "medium", "high", "critical"].includes(input.severity) ? input.severity : "medium",
            executorId: input.executorId ? String(input.executorId) : null,
            executorTag: String(input.executorTag || "Unknown executor").slice(0, 256),
            targetId: input.targetId ? String(input.targetId) : null,
            targetTag: input.targetTag ? String(input.targetTag).slice(0, 256) : null,
            actionTaken: String(input.actionTaken || "alert").slice(0, 64),
            status: "open",
            details: input.details && typeof input.details === "object" ? input.details : {},
            auditLogEntryId: input.auditLogEntryId ? String(input.auditLogEntryId) : null,
        })
        return doc.toObject()
    } catch (err) {
        if (err?.code === 11000 && input.auditLogEntryId) {
            return SecurityIncident.findOne({ guildId: String(input.guildId), auditLogEntryId: String(input.auditLogEntryId) }).lean()
        }
        console.error("Security incident persistence error:", err.message)
        return null
    }
}

async function listSecurityIncidents(guildId, { limit = 50, status = null, type = null } = {}) {
    if (!mongoReady()) return []
    const query = { guildId: String(guildId) }
    if (["open", "resolved", "ignored"].includes(status)) query.status = status
    if (type) query.type = String(type).slice(0, 64)
    return SecurityIncident.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(100, Number(limit) || 50)))
        .lean()
}

async function getSecurityIncidentStats(guildId) {
    if (!mongoReady()) {
        return { available: false, total: 0, open: 0, critical: 0, last24Hours: 0 }
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [total, open, critical, last24Hours] = await Promise.all([
        SecurityIncident.countDocuments({ guildId: String(guildId) }),
        SecurityIncident.countDocuments({ guildId: String(guildId), status: "open" }),
        SecurityIncident.countDocuments({ guildId: String(guildId), severity: "critical" }),
        SecurityIncident.countDocuments({ guildId: String(guildId), createdAt: { $gte: since } }),
    ])
    return { available: true, total, open, critical, last24Hours }
}

async function updateSecurityIncident(guildId, incidentId, operation, actor = {}) {
    if (!mongoReady() || !mongoose.isValidObjectId(incidentId)) return null
    const update = {}
    if (operation.action === "resolve" || operation.action === "ignore") {
        update.$set = {
            status: operation.action === "resolve" ? "resolved" : "ignored",
            resolvedAt: new Date(),
            resolvedById: actor.id ? String(actor.id) : null,
            resolutionNote: operation.note ? String(operation.note).slice(0, 2000) : null,
        }
    } else if (operation.action === "reopen") {
        update.$set = {
            status: "open",
            resolvedAt: null,
            resolvedById: null,
            resolutionNote: null,
        }
    } else {
        return null
    }
    return SecurityIncident.findOneAndUpdate(
        { _id: incidentId, guildId: String(guildId) },
        update,
        { new: true }
    ).lean()
}

module.exports = {
    SecurityIncident,
    createSecurityIncident,
    listSecurityIncidents,
    getSecurityIncidentStats,
    updateSecurityIncident,
}
