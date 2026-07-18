const mongoose = require("mongoose")

function model(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const questionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 45 },
    placeholder: { type: String, default: null, maxlength: 100 },
    style: { type: String, enum: ["short", "paragraph"], default: "paragraph" },
    required: { type: Boolean, default: true },
}, { _id: false })

const categorySchema = new mongoose.Schema({
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: null, maxlength: 100 },
    emoji: { type: String, default: "🎫", maxlength: 50 },
    categoryId: { type: String, default: null },
    supportRoleIds: { type: [String], default: [] },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    questions: { type: [questionSchema], default: [] },
}, { _id: false })

const panelSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 80 },
    title: { type: String, required: true, maxlength: 256 },
    description: { type: String, required: true, maxlength: 4000 },
    color: { type: String, default: "#8B5CF6", maxlength: 7 },
    imageUrl: { type: String, default: null, maxlength: 1000 },
    footer: { type: String, default: "Powered by CURSED Support", maxlength: 2048 },
    style: { type: String, enum: ["buttons", "select"], default: "select" },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    categories: { type: [categorySchema], default: [] },
    enabled: { type: Boolean, default: true },
    createdById: { type: String, default: null },
    updatedById: { type: String, default: null },
}, { collection: "ticketPanels", timestamps: true, minimize: false })
panelSchema.index({ guildId: 1, name: 1 })

const answerSchema = new mongoose.Schema({
    questionId: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: String, required: true, maxlength: 4000 },
}, { _id: false })

const eventSchema = new mongoose.Schema({
    type: { type: String, required: true, maxlength: 50 },
    actorId: { type: String, default: null },
    actorTag: { type: String, default: null, maxlength: 256 },
    detail: { type: String, default: null, maxlength: 2000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
}, { _id: false })

const ticketSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    ticketNumber: { type: Number, required: true },
    channelId: { type: String, default: null, index: true },
    panelId: { type: mongoose.Schema.Types.ObjectId, ref: "TicketPanel", default: null },
    creatorId: { type: String, required: true, index: true },
    creatorTag: { type: String, required: true, maxlength: 256 },
    categoryKey: { type: String, required: true, maxlength: 80 },
    categoryLabel: { type: String, required: true, maxlength: 80 },
    parentCategoryId: { type: String, default: null },
    supportRoleIds: { type: [String], default: [] },
    addedUserIds: { type: [String], default: [] },
    status: { type: String, enum: ["open", "claimed", "waiting_user", "waiting_staff", "closed", "deleted"], default: "open", index: true },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    claimedById: { type: String, default: null },
    claimedByTag: { type: String, default: null, maxlength: 256 },
    subject: { type: String, default: null, maxlength: 200 },
    answers: { type: [answerSchema], default: [] },
    firstStaffResponseAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    closedById: { type: String, default: null },
    closeReason: { type: String, default: null, maxlength: 2000 },
    reopenedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    transcriptMessageUrl: { type: String, default: null, maxlength: 1000 },
    transcriptGeneratedAt: { type: Date, default: null },
    feedbackRating: { type: Number, default: null, min: 1, max: 5 },
    feedbackComment: { type: String, default: null, maxlength: 2000 },
    escalatedAt: { type: Date, default: null },
    events: { type: [eventSchema], default: [] },
}, { collection: "tickets", timestamps: true, minimize: false })
ticketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true })
ticketSchema.index({ guildId: 1, creatorId: 1, status: 1 })

const counterSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    nextNumber: { type: Number, default: 0 },
}, { collection: "ticketCounters", timestamps: true })

const TicketPanel = model("TicketPanel", panelSchema)
const TicketRecord = model("TicketRecord", ticketSchema)
const TicketCounter = model("TicketCounter", counterSchema)

function mongoReady() {
    return mongoose.connection.readyState === 1
}

async function nextTicketNumber(guildId) {
    if (!mongoReady()) {
        const error = new Error("MongoDB is required for tickets.")
        error.code = "MONGO_UNAVAILABLE"
        throw error
    }
    const counter = await TicketCounter.findOneAndUpdate(
        { guildId },
        { $inc: { nextNumber: 1 }, $setOnInsert: { guildId } },
        { upsert: true, new: true }
    ).lean()
    return counter.nextNumber
}

module.exports = {
    TicketPanel,
    TicketRecord,
    TicketCounter,
    mongoReady,
    nextTicketNumber,
}
