const mongoose = require("mongoose")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const quarantineStateSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: { type: String, default: "Unknown user", maxlength: 256 },
    quarantineRoleId: { type: String, required: true },
    originalRoleIds: { type: [String], default: [] },
    status: { type: String, enum: ["applying", "active", "released", "failed"], default: "applying", index: true },
    reason: { type: String, default: "No reason provided", maxlength: 2000 },
    moderatorId: { type: String, default: null },
    moderatorTag: { type: String, default: "System", maxlength: 256 },
    releasedAt: { type: Date, default: null },
    releasedById: { type: String, default: null },
    releaseReason: { type: String, default: null, maxlength: 2000 },
    missingRoleIds: { type: [String], default: [] },
}, { collection: "quarantineStates", timestamps: true, minimize: false })

quarantineStateSchema.index({ guildId: 1, userId: 1 }, { unique: true })
const QuarantineState = getModel("QuarantineState", quarantineStateSchema)

function mongoReady() {
    return mongoose.connection.readyState === 1
}

function identity(value, fallback = "System") {
    return {
        id: value?.id ? String(value.id) : null,
        tag: String(value?.tag || value?.username || fallback).slice(0, 256),
    }
}

async function quarantineMember(guild, member, config, { reason, moderator } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so quarantine was not applied safely." }
    if (!guild || !member) return { ok: false, error: "The member could not be resolved." }
    if (member.id === guild.ownerId) return { ok: false, error: "The server owner cannot be quarantined." }
    if (member.id === guild.members.me?.id) return { ok: false, error: "CURSED cannot quarantine itself." }
    if (!member.manageable) return { ok: false, error: "Discord role hierarchy prevents CURSED from managing that member." }

    const roleId = config?.quarantine?.roleId
    const role = roleId ? guild.roles.cache.get(roleId) : null
    if (!role || role.managed) return { ok: false, error: "Configure a valid quarantine role first." }
    if (!role.editable) return { ok: false, error: "Move the quarantine role below CURSED's highest role." }

    const existing = await QuarantineState.findOne({ guildId: guild.id, userId: member.id }).lean()
    if (existing?.status === "active") return { ok: false, error: "That member is already quarantined.", state: existing }

    const originalRoleIds = [...member.roles.cache.values()]
        .filter(item => item.id !== guild.id && item.id !== role.id && !item.managed)
        .map(item => item.id)
    const actor = identity(moderator)
    const state = await QuarantineState.findOneAndUpdate(
        { guildId: guild.id, userId: member.id },
        {
            $set: {
                userTag: member.user?.tag || member.displayName || "Unknown user",
                quarantineRoleId: role.id,
                originalRoleIds,
                status: "applying",
                reason: String(reason || "Security quarantine").slice(0, 2000),
                moderatorId: actor.id,
                moderatorTag: actor.tag,
                releasedAt: null,
                releasedById: null,
                releaseReason: null,
                missingRoleIds: [],
                updatedAt: new Date(),
            },
            $setOnInsert: { guildId: guild.id, userId: member.id, createdAt: new Date() },
        },
        { upsert: true, new: true }
    ).lean()

    try {
        await member.roles.add(role, String(reason || "Security quarantine").slice(0, 512))
        if (config.quarantine.removeManageableRoles !== false) {
            const removable = originalRoleIds.filter(id => guild.roles.cache.get(id)?.editable === true)
            if (removable.length) await member.roles.remove(removable, String(reason || "Security quarantine").slice(0, 512))
        }
        const active = await QuarantineState.findByIdAndUpdate(
            state._id,
            { $set: { status: "active", updatedAt: new Date() } },
            { new: true }
        ).lean()
        return { ok: true, state: active }
    } catch (err) {
        try {
            if (member.roles.cache.has(role.id)) await member.roles.remove(role, "Quarantine rollback")
            const restorable = originalRoleIds.filter(id => guild.roles.cache.get(id)?.editable === true)
            if (restorable.length) await member.roles.add(restorable, "Quarantine rollback")
        } catch { /* best-effort rollback */ }
        await QuarantineState.findByIdAndUpdate(state._id, { $set: { status: "failed", updatedAt: new Date() } }).catch(() => {})
        return { ok: false, error: `Quarantine failed and was rolled back where possible: ${err.message}` }
    }
}

async function releaseQuarantine(guild, member, { reason, moderator } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so roles cannot be restored safely." }
    if (!guild || !member) return { ok: false, error: "The member could not be resolved." }
    const state = await QuarantineState.findOne({ guildId: guild.id, userId: member.id, status: "active" }).lean()
    if (!state) return { ok: false, error: "That member has no active quarantine record." }
    if (!member.manageable) return { ok: false, error: "Discord role hierarchy prevents CURSED from restoring that member." }

    const quarantineRole = guild.roles.cache.get(state.quarantineRoleId)
    const restorable = []
    const missing = []
    for (const roleId of state.originalRoleIds || []) {
        const role = guild.roles.cache.get(roleId)
        if (!role || !role.editable) missing.push(roleId)
        else restorable.push(roleId)
    }

    try {
        if (quarantineRole && member.roles.cache.has(quarantineRole.id)) {
            await member.roles.remove(quarantineRole, String(reason || "Quarantine released").slice(0, 512))
        }
        if (restorable.length) await member.roles.add(restorable, String(reason || "Quarantine released").slice(0, 512))
    } catch (err) {
        return { ok: false, error: `Could not restore the member's roles: ${err.message}` }
    }

    const actor = identity(moderator)
    const released = await QuarantineState.findByIdAndUpdate(
        state._id,
        {
            $set: {
                status: "released",
                releasedAt: new Date(),
                releasedById: actor.id,
                releaseReason: String(reason || "Quarantine released").slice(0, 2000),
                missingRoleIds: missing,
                updatedAt: new Date(),
            },
        },
        { new: true }
    ).lean()
    return { ok: true, state: released, missingRoleIds: missing }
}

async function getActiveQuarantineCount(guildId) {
    if (!mongoReady()) return 0
    return QuarantineState.countDocuments({ guildId: String(guildId), status: "active" })
}

async function listActiveQuarantines(guildId, limit = 50) {
    if (!mongoReady()) return []
    return QuarantineState.find({ guildId: String(guildId), status: "active" })
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, Math.min(100, Number(limit) || 50)))
        .lean()
}

module.exports = {
    QuarantineState,
    quarantineMember,
    releaseQuarantine,
    getActiveQuarantineCount,
    listActiveQuarantines,
}
