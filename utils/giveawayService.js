const crypto = require("crypto")
const mongoose = require("mongoose")
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require("discord.js")
const logger = require("./logger")
const { SAFE_MENTIONS } = require("./responseBuilder")

const log = logger.child("GiveawayService")
const GIVEAWAY_BUTTON_PREFIX = "cursed:giveaway:"
const MAX_ACTIVE_GIVEAWAYS = 20
const MAX_WINNERS = 20
const MIN_DURATION_MS = 10_000
const MAX_DURATION_MS = 90 * 24 * 60 * 60 * 1000

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const giveawaySchema = new mongoose.Schema({
    giveawayId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    prize: { type: String, required: true },
    winnerCount: { type: Number, required: true, min: 1, max: MAX_WINNERS },
    endsAt: { type: Date, required: true, index: true },
    ended: { type: Boolean, default: false, index: true },
    endedAt: { type: Date, default: null },
    entrantIds: { type: [String], default: [] },
    winnerIds: { type: [String], default: [] },
    createdBy: { type: String, required: true },
}, { collection: "giveaways", timestamps: true })
giveawaySchema.index({ guildId: 1, ended: 1, endsAt: 1 })

const Giveaway = getModel("Giveaway", giveawaySchema)
let schedulerClient = null
let schedulerTimer = null

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function normalizePrize(value) {
    const prize = String(value || "").trim().slice(0, 256)
    if (!prize) throw new Error("Prize is required")
    return prize
}

function parseDuration(value) {
    const text = String(value || "").trim().toLowerCase()
    const match = text.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    const amount = Number(match[1])
    const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]
    const ms = amount * factor
    return ms >= MIN_DURATION_MS && ms <= MAX_DURATION_MS ? ms : null
}

function formatEndsAt(date) {
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`
}

function giveawayEmbed(giveaway, { ended = giveaway.ended } = {}) {
    const entrants = giveaway.entrantIds?.length || 0
    const winners = giveaway.winnerIds?.length
        ? giveaway.winnerIds.map(id => `<@${id}>`).join(", ")
        : null
    const embed = new EmbedBuilder()
        .setColor(ended ? 0x2B2D31 : 0x5865F2)
        .setTitle(ended ? "Giveaway ended" : "Giveaway")
        .setDescription(`**${giveaway.prize}**`)
        .addFields(
            { name: "Winners", value: String(giveaway.winnerCount), inline: true },
            { name: "Entries", value: String(entrants), inline: true },
            { name: ended ? "Ended" : "Ends", value: ended ? `<t:${Math.floor(new Date(giveaway.endedAt || giveaway.endsAt).getTime() / 1000)}:R>` : formatEndsAt(giveaway.endsAt), inline: true },
        )
        .setFooter({ text: `CURSED • Giveaway ${giveaway.giveawayId}` })
    if (ended) embed.addFields({ name: "Result", value: winners || "No eligible entries.", inline: false })
    return embed
}

function giveawayComponents(giveaway) {
    if (giveaway.ended) return []
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${GIVEAWAY_BUTTON_PREFIX}${giveaway.giveawayId}`)
            .setLabel("Enter giveaway")
            .setStyle(ButtonStyle.Primary)
    )]
}

async function createGiveaway({ guildId, channelId, createdBy, prize, winnerCount, durationMs }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const winners = Math.max(1, Math.min(MAX_WINNERS, Math.floor(Number(winnerCount) || 1)))
    const duration = Math.floor(Number(durationMs) || 0)
    if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) throw new Error("Giveaway duration is outside the supported range")
    const active = await Giveaway.countDocuments({ guildId: String(guildId), ended: false })
    if (active >= MAX_ACTIVE_GIVEAWAYS) throw new Error(`This server already has ${MAX_ACTIVE_GIVEAWAYS} active giveaways`)
    return Giveaway.create({
        giveawayId: crypto.randomUUID().split("-")[0],
        guildId: String(guildId),
        channelId: String(channelId),
        createdBy: String(createdBy),
        prize: normalizePrize(prize),
        winnerCount: winners,
        endsAt: new Date(Date.now() + duration),
    })
}

async function attachGiveawayMessage(giveawayId, messageId) {
    return Giveaway.findOneAndUpdate({ giveawayId }, { $set: { messageId: String(messageId) } }, { new: true }).lean()
}

async function listGiveaways(guildId, { activeOnly = false, limit = 20 } = {}) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const query = { guildId: String(guildId) }
    if (activeOnly) query.ended = false
    return Giveaway.find(query).sort({ createdAt: -1 }).limit(Math.min(50, Math.max(1, limit))).lean()
}

async function getGiveaway(guildId, giveawayId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return Giveaway.findOne({ guildId: String(guildId), giveawayId: String(giveawayId) }).lean()
}

function chooseWinners(entrantIds, count) {
    const pool = [...new Set((entrantIds || []).map(String))]
    const winners = []
    while (pool.length && winners.length < count) {
        const index = crypto.randomInt(pool.length)
        winners.push(pool.splice(index, 1)[0])
    }
    return winners
}

async function updateGiveawayMessage(client, giveaway) {
    if (!client || !giveaway?.channelId || !giveaway?.messageId) return false
    try {
        const channel = await client.channels.fetch(giveaway.channelId)
        if (!channel?.isTextBased?.()) return false
        const message = await channel.messages.fetch(giveaway.messageId)
        await message.edit({
            embeds: [giveawayEmbed(giveaway)],
            components: giveawayComponents(giveaway),
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    } catch (error) {
        log.warn(`Could not update giveaway ${giveaway.giveawayId}: ${error.message}`)
        return false
    }
}

async function finishGiveaway(guildId, giveawayId, client = schedulerClient) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const current = await Giveaway.findOne({ guildId: String(guildId), giveawayId: String(giveawayId) }).lean()
    if (!current) throw new Error("Giveaway not found")
    if (current.ended) return current
    const winnerIds = chooseWinners(current.entrantIds, current.winnerCount)
    const updated = await Giveaway.findOneAndUpdate(
        { guildId: String(guildId), giveawayId: String(giveawayId), ended: false },
        { $set: { ended: true, endedAt: new Date(), winnerIds } },
        { new: true }
    ).lean()
    if (!updated) return Giveaway.findOne({ guildId: String(guildId), giveawayId: String(giveawayId) }).lean()
    await updateGiveawayMessage(client, updated)
    if (client && updated.channelId) {
        try {
            const channel = await client.channels.fetch(updated.channelId)
            if (channel?.isTextBased?.()) {
                const result = winnerIds.length
                    ? `Giveaway **${updated.prize}** ended. Winner${winnerIds.length === 1 ? "" : "s"}: ${winnerIds.map(id => `<@${id}>`).join(", ")}`
                    : `Giveaway **${updated.prize}** ended with no eligible entries.`
                await channel.send({ content: result, allowedMentions: { parse: [], users: winnerIds, roles: [], repliedUser: false } }).catch(() => {})
            }
        } catch {}
    }
    return updated
}

async function rerollGiveaway(guildId, giveawayId, client = schedulerClient) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const current = await Giveaway.findOne({ guildId: String(guildId), giveawayId: String(giveawayId), ended: true }).lean()
    if (!current) throw new Error("Ended giveaway not found")
    const winnerIds = chooseWinners(current.entrantIds, current.winnerCount)
    const updated = await Giveaway.findOneAndUpdate(
        { guildId: String(guildId), giveawayId: String(giveawayId), ended: true },
        { $set: { winnerIds, endedAt: new Date() } },
        { new: true }
    ).lean()
    await updateGiveawayMessage(client, updated)
    return updated
}

async function toggleEntry(guildId, giveawayId, userId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const current = await Giveaway.findOne({ guildId: String(guildId), giveawayId: String(giveawayId) }).lean()
    if (!current) throw new Error("Giveaway not found")
    if (current.ended || new Date(current.endsAt).getTime() <= Date.now()) throw new Error("This giveaway has ended")
    const joined = !current.entrantIds.includes(String(userId))
    const update = joined
        ? { $addToSet: { entrantIds: String(userId) } }
        : { $pull: { entrantIds: String(userId) } }
    const updated = await Giveaway.findOneAndUpdate({ giveawayId: current.giveawayId, ended: false }, update, { new: true }).lean()
    return { joined, giveaway: updated }
}

async function processDueGiveaways() {
    if (!schedulerClient || !isMongoConnected()) return 0
    const due = await Giveaway.find({ ended: false, endsAt: { $lte: new Date() } }).limit(25).lean()
    for (const giveaway of due) {
        await finishGiveaway(giveaway.guildId, giveaway.giveawayId, schedulerClient).catch(error => {
            log.warn(`Could not finish giveaway ${giveaway.giveawayId}: ${error.message}`)
        })
    }
    return due.length
}

function startGiveawayScheduler(client) {
    schedulerClient = client
    if (schedulerTimer) return schedulerTimer
    schedulerTimer = setInterval(() => {
        processDueGiveaways().catch(error => log.warn(`Giveaway scheduler error: ${error.message}`))
    }, 15_000)
    schedulerTimer.unref?.()
    setTimeout(() => processDueGiveaways().catch(() => {}), 2_000).unref?.()
    return schedulerTimer
}

async function handleGiveawayButton(interaction) {
    if (!interaction.isButton?.() || !String(interaction.customId || "").startsWith(GIVEAWAY_BUTTON_PREFIX)) return false
    const giveawayId = String(interaction.customId).slice(GIVEAWAY_BUTTON_PREFIX.length)
    try {
        const result = await toggleEntry(interaction.guildId, giveawayId, interaction.user.id)
        await interaction.reply({
            content: result.joined ? "You entered the giveaway." : "You left the giveaway.",
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
        await updateGiveawayMessage(interaction.client, result.giveaway)
    } catch (error) {
        await interaction.reply({ content: error.message, ephemeral: true, allowedMentions: SAFE_MENTIONS }).catch(() => {})
    }
    return true
}

module.exports = {
    Giveaway,
    GIVEAWAY_BUTTON_PREFIX,
    MAX_ACTIVE_GIVEAWAYS,
    MAX_WINNERS,
    MIN_DURATION_MS,
    MAX_DURATION_MS,
    isMongoConnected,
    parseDuration,
    formatEndsAt,
    giveawayEmbed,
    giveawayComponents,
    createGiveaway,
    attachGiveawayMessage,
    listGiveaways,
    getGiveaway,
    chooseWinners,
    updateGiveawayMessage,
    finishGiveaway,
    rerollGiveaway,
    toggleEntry,
    processDueGiveaways,
    startGiveawayScheduler,
    handleGiveawayButton,
}
