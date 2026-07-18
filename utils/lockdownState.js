const mongoose = require("mongoose")
const { ChannelType, PermissionFlagsBits } = require("discord.js")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const permissionSnapshotSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    sendMessages: { type: String, enum: ["allow", "deny", "unset"], required: true },
    addReactions: { type: String, enum: ["allow", "deny", "unset"], required: true },
    sendMessagesInThreads: { type: String, enum: ["allow", "deny", "unset"], required: true },
    createPublicThreads: { type: String, enum: ["allow", "deny", "unset"], required: true },
    createPrivateThreads: { type: String, enum: ["allow", "deny", "unset"], required: true },
}, { _id: false })

const lockdownStateSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ["inactive", "applying", "active", "restoring", "failed"], default: "inactive" },
    reason: { type: String, default: null, maxlength: 2000 },
    actorId: { type: String, default: null },
    actorTag: { type: String, default: "System", maxlength: 256 },
    previousVerificationLevel: { type: Number, default: null },
    snapshots: { type: [permissionSnapshotSchema], default: [] },
    missingChannelIds: { type: [String], default: [] },
    activatedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
}, { collection: "securityLockdownStates", timestamps: true, minimize: false })

const SecurityLockdownState = getModel("SecurityLockdownState", lockdownStateSchema)

function mongoReady() {
    return mongoose.connection.readyState === 1
}

function permissionState(overwrite, permission) {
    if (!overwrite) return "unset"
    if (overwrite.allow.has(permission)) return "allow"
    if (overwrite.deny.has(permission)) return "deny"
    return "unset"
}

function restoreValue(value) {
    if (value === "allow") return true
    if (value === "deny") return false
    return null
}

function snapshotChannel(guild, channel) {
    const overwrite = channel.permissionOverwrites.cache.get(guild.id)
    return {
        channelId: channel.id,
        sendMessages: permissionState(overwrite, PermissionFlagsBits.SendMessages),
        addReactions: permissionState(overwrite, PermissionFlagsBits.AddReactions),
        sendMessagesInThreads: permissionState(overwrite, PermissionFlagsBits.SendMessagesInThreads),
        createPublicThreads: permissionState(overwrite, PermissionFlagsBits.CreatePublicThreads),
        createPrivateThreads: permissionState(overwrite, PermissionFlagsBits.CreatePrivateThreads),
    }
}

function lockdownChannels(guild, config) {
    const selected = new Set(config?.lockdown?.channelIds || [])
    return [...guild.channels.cache.values()]
        .filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .filter(channel => selected.size === 0 || selected.has(channel.id))
        .filter(channel => channel.manageable !== false)
}

async function applySnapshot(guild, snapshot, reason) {
    const channel = guild.channels.cache.get(snapshot.channelId)
    if (!channel?.permissionOverwrites) return false
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: restoreValue(snapshot.sendMessages),
        AddReactions: restoreValue(snapshot.addReactions),
        SendMessagesInThreads: restoreValue(snapshot.sendMessagesInThreads),
        CreatePublicThreads: restoreValue(snapshot.createPublicThreads),
        CreatePrivateThreads: restoreValue(snapshot.createPrivateThreads),
    }, { reason })
    return true
}

async function enableEmergencyLockdown(guild, config, { reason, actor } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so lockdown was not started safely." }
    if (!guild?.members?.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, error: "CURSED needs Manage Channels permission for emergency lockdown." }
    }
    const current = await SecurityLockdownState.findOne({ guildId: guild.id }).lean()
    if (current?.active || current?.status === "applying") return { ok: false, error: "Emergency lockdown is already active.", state: current }

    const channels = lockdownChannels(guild, config)
    if (!channels.length) return { ok: false, error: "No manageable text channels are configured for lockdown." }
    const snapshots = channels.map(channel => snapshotChannel(guild, channel))
    const previousVerificationLevel = Number(guild.verificationLevel)
    const actorId = actor?.id ? String(actor.id) : null
    const actorTag = String(actor?.tag || actor?.username || "System").slice(0, 256)

    const state = await SecurityLockdownState.findOneAndUpdate(
        { guildId: guild.id },
        {
            $set: {
                active: false,
                status: "applying",
                reason: String(reason || "Emergency security lockdown").slice(0, 2000),
                actorId,
                actorTag,
                previousVerificationLevel,
                snapshots,
                missingChannelIds: [],
                activatedAt: null,
                releasedAt: null,
                updatedAt: new Date(),
            },
            $setOnInsert: { guildId: guild.id, createdAt: new Date() },
        },
        { upsert: true, new: true }
    ).lean()

    const changed = []
    try {
        for (const channel of channels) {
            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
            }, { reason: String(reason || "Emergency security lockdown").slice(0, 512) })
            changed.push(channel.id)
        }
        if (config?.lockdown?.raiseVerificationLevel !== false && typeof guild.setVerificationLevel === "function") {
            await guild.setVerificationLevel(3, String(reason || "Emergency security lockdown").slice(0, 512)).catch(() => {})
        }
        const active = await SecurityLockdownState.findByIdAndUpdate(
            state._id,
            { $set: { active: true, status: "active", activatedAt: new Date(), updatedAt: new Date() } },
            { new: true }
        ).lean()
        return { ok: true, state: active, affectedChannels: changed.length }
    } catch (err) {
        for (const snapshot of snapshots.filter(item => changed.includes(item.channelId))) {
            await applySnapshot(guild, snapshot, "Emergency lockdown rollback").catch(() => {})
        }
        if (typeof guild.setVerificationLevel === "function" && Number.isFinite(previousVerificationLevel)) {
            await guild.setVerificationLevel(previousVerificationLevel, "Emergency lockdown rollback").catch(() => {})
        }
        await SecurityLockdownState.findByIdAndUpdate(state._id, { $set: { active: false, status: "failed", updatedAt: new Date() } }).catch(() => {})
        return { ok: false, error: `Lockdown failed and was rolled back where possible: ${err.message}` }
    }
}

async function disableEmergencyLockdown(guild, { reason, actor } = {}) {
    if (!mongoReady()) return { ok: false, error: "MongoDB is unavailable, so saved channel permissions cannot be restored safely." }
    const state = await SecurityLockdownState.findOne({ guildId: guild.id, active: true }).lean()
    if (!state) return { ok: false, error: "Emergency lockdown is not active." }
    await SecurityLockdownState.findByIdAndUpdate(state._id, { $set: { status: "restoring", updatedAt: new Date() } })

    const missing = []
    try {
        for (const snapshot of state.snapshots || []) {
            const restored = await applySnapshot(guild, snapshot, String(reason || "Emergency lockdown released").slice(0, 512))
            if (!restored) missing.push(snapshot.channelId)
        }
        if (typeof guild.setVerificationLevel === "function" && Number.isFinite(state.previousVerificationLevel)) {
            await guild.setVerificationLevel(state.previousVerificationLevel, String(reason || "Emergency lockdown released").slice(0, 512)).catch(() => {})
        }
    } catch (err) {
        await SecurityLockdownState.findByIdAndUpdate(state._id, { $set: { status: "failed", missingChannelIds: missing, updatedAt: new Date() } }).catch(() => {})
        return { ok: false, error: `Lockdown restoration stopped safely: ${err.message}`, missingChannelIds: missing }
    }

    const released = await SecurityLockdownState.findByIdAndUpdate(
        state._id,
        {
            $set: {
                active: false,
                status: "inactive",
                reason: String(reason || state.reason || "Emergency lockdown released").slice(0, 2000),
                actorId: actor?.id ? String(actor.id) : state.actorId,
                actorTag: String(actor?.tag || actor?.username || state.actorTag || "System").slice(0, 256),
                missingChannelIds: missing,
                releasedAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { new: true }
    ).lean()
    return { ok: true, state: released, missingChannelIds: missing }
}

async function getLockdownStatus(guildId) {
    if (!mongoReady()) return { available: false, active: false, status: "inactive", snapshots: [] }
    const state = await SecurityLockdownState.findOne({ guildId: String(guildId) }).lean()
    return state || { available: true, guildId: String(guildId), active: false, status: "inactive", snapshots: [] }
}

module.exports = {
    SecurityLockdownState,
    enableEmergencyLockdown,
    disableEmergencyLockdown,
    getLockdownStatus,
}
