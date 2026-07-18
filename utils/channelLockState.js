const mongoose = require("mongoose")
const { PermissionFlagsBits } = require("discord.js")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const lockStateSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    sendMessages: { type: String, enum: ["allow", "deny", "neutral"], default: "neutral" },
    sendMessagesInThreads: { type: String, enum: ["allow", "deny", "neutral"], default: "neutral" },
    lockedById: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 1000 },
}, { collection: "moderationChannelLocks", timestamps: true })

lockStateSchema.index({ guildId: 1, channelId: 1 }, { unique: true })

const ModerationChannelLock = getModel("ModerationChannelLock", lockStateSchema)

function triState(overwrite, permission) {
    if (!overwrite) return "neutral"
    if (overwrite.allow.has(permission)) return "allow"
    if (overwrite.deny.has(permission)) return "deny"
    return "neutral"
}

function toPermissionValue(value) {
    if (value === "allow") return true
    if (value === "deny") return false
    return null
}

async function lockChannel(channel, actor, reason = null) {
    if (!channel?.guild) throw new Error("A guild channel is required.")
    if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is required to preserve channel lock state.")
    const guild = channel.guild
    const everyone = guild.roles.everyone
    const overwrite = channel.permissionOverwrites.cache.get(everyone.id) || null
    const snapshot = {
        sendMessages: triState(overwrite, PermissionFlagsBits.SendMessages),
        sendMessagesInThreads: triState(overwrite, PermissionFlagsBits.SendMessagesInThreads),
    }

    await ModerationChannelLock.findOneAndUpdate(
        { guildId: guild.id, channelId: channel.id },
        {
            $setOnInsert: snapshot,
            $set: {
                lockedById: actor?.id ? String(actor.id) : null,
                reason: reason ? String(reason).slice(0, 1000) : null,
            },
        },
        { upsert: true, new: true }
    )

    try {
        await channel.permissionOverwrites.edit(everyone, {
            SendMessages: false,
            SendMessagesInThreads: false,
        }, { reason: reason || "Channel locked by moderator" })
    } catch (err) {
        await ModerationChannelLock.deleteOne({ guildId: guild.id, channelId: channel.id }).catch(() => {})
        throw err
    }
    return snapshot
}

async function unlockChannel(channel, reason = null) {
    if (!channel?.guild) throw new Error("A guild channel is required.")
    if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is required to restore channel lock state.")
    const guild = channel.guild
    const state = await ModerationChannelLock.findOne({
        guildId: guild.id,
        channelId: channel.id,
    }).lean()

    if (!state) {
        return { restored: false, message: "No saved lock state exists for this channel." }
    }

    await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: toPermissionValue(state.sendMessages),
        SendMessagesInThreads: toPermissionValue(state.sendMessagesInThreads),
    }, { reason: reason || "Channel unlocked by moderator" })

    await ModerationChannelLock.deleteOne({ guildId: guild.id, channelId: channel.id })
    return { restored: true, state }
}

async function getLockedChannelIds(guildId) {
    if (mongoose.connection.readyState !== 1) return []
    const docs = await ModerationChannelLock.find({ guildId: String(guildId) }).select("channelId").lean()
    return docs.map(doc => String(doc.channelId))
}

module.exports = {
    ModerationChannelLock,
    lockChannel,
    unlockChannel,
    getLockedChannelIds,
}
