const mongoose = require("mongoose")
const logger = require("./logger")
const { logAction } = require("./modlog")

const log = logger.child("ModerationTasks")

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const moderationTaskSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    type: { type: String, enum: ["TEMPBAN_UNBAN"], required: true, index: true },
    targetId: { type: String, required: true, index: true },
    targetTag: { type: String, default: "Unknown user" },
    caseNumber: { type: Number, default: null },
    executeAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "processing", "completed", "failed", "cancelled"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null, maxlength: 1000 },
    completedAt: { type: Date, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: "moderationTasks", timestamps: true, minimize: false })

moderationTaskSchema.index({ status: 1, executeAt: 1 })

const ModerationTask = getModel("ModerationTask", moderationTaskSchema)

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

async function scheduleTempbanUnban({ guildId, target, caseNumber, executeAt, reason }) {
    if (!isMongoConnected()) throw new Error("MongoDB is required for temporary bans.")
    const date = new Date(executeAt)
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        throw new Error("Temporary ban expiry must be in the future.")
    }
    return ModerationTask.create({
        guildId: String(guildId),
        type: "TEMPBAN_UNBAN",
        targetId: String(target.id),
        targetTag: String(target.tag || "Unknown user").slice(0, 256),
        caseNumber: Number.isInteger(Number(caseNumber)) ? Number(caseNumber) : null,
        executeAt: date,
        payload: { reason: String(reason || "Temporary ban expired").slice(0, 1000) },
    })
}

async function countPendingTasks(guildId) {
    if (!isMongoConnected()) return { available: false, total: 0, tempbans: 0, failed: 0 }
    const [total, tempbans, failed] = await Promise.all([
        ModerationTask.countDocuments({ guildId: String(guildId), status: { $in: ["pending", "processing"] } }),
        ModerationTask.countDocuments({ guildId: String(guildId), type: "TEMPBAN_UNBAN", status: { $in: ["pending", "processing"] } }),
        ModerationTask.countDocuments({ guildId: String(guildId), status: "failed" }),
    ])
    return { available: true, total, tempbans, failed }
}

async function markCaseExpired(guildId, caseNumber) {
    if (!caseNumber) return
    try {
        const { ModerationCase } = require("./moderationCases")
        await ModerationCase.updateOne(
            { guildId: String(guildId), caseNumber: Number(caseNumber), status: "active" },
            { $set: { status: "expired" } }
        )
    } catch (err) {
        log.warn(`Could not expire case #${caseNumber}: ${err.message}`)
    }
}

async function executeTask(client, task) {
    const guild = client.guilds.cache.get(task.guildId)
    if (!guild) throw new Error("Bot is no longer in the guild.")

    if (task.type === "TEMPBAN_UNBAN") {
        const existing = await guild.bans.fetch(task.targetId).catch(() => null)
        if (existing) {
            await guild.members.unban(task.targetId, "Temporary ban expired")
        }
        await markCaseExpired(task.guildId, task.caseNumber)
        await logAction(guild, {
            action: "UNBAN",
            target: { id: task.targetId, tag: task.targetTag },
            reason: "Temporary ban expired",
            source: "system",
            createCaseRecord: true,
            metadata: { scheduledTaskId: String(task._id), sourceCaseNumber: task.caseNumber },
        })
    }
}

async function processDueTasks(client, limit = 25) {
    if (!client?.isReady?.() || !isMongoConnected()) return { processed: 0, failed: 0 }
    const due = await ModerationTask.find({
        status: { $in: ["pending", "failed"] },
        executeAt: { $lte: new Date() },
        attempts: { $lt: 10 },
    }).sort({ executeAt: 1 }).limit(limit)

    let processed = 0
    let failed = 0
    for (const task of due) {
        const claimed = await ModerationTask.findOneAndUpdate(
            { _id: task._id, status: task.status },
            { $set: { status: "processing" }, $inc: { attempts: 1 } },
            { new: true }
        )
        if (!claimed) continue

        try {
            await executeTask(client, claimed)
            await ModerationTask.updateOne(
                { _id: claimed._id },
                { $set: { status: "completed", completedAt: new Date(), lastError: null } }
            )
            processed += 1
        } catch (err) {
            const attempts = claimed.attempts || 1
            const terminal = attempts >= 10
            await ModerationTask.updateOne(
                { _id: claimed._id },
                {
                    $set: {
                        status: terminal ? "failed" : "pending",
                        lastError: String(err.message || err).slice(0, 1000),
                        executeAt: terminal ? claimed.executeAt : new Date(Date.now() + Math.min(60, attempts * 5) * 60 * 1000),
                    },
                }
            )
            failed += 1
            log.error(`Task ${claimed._id} failed: ${err.message}`)
        }
    }
    return { processed, failed }
}

let scheduler = null

function startModerationTaskScheduler(client) {
    if (scheduler) return scheduler
    const run = () => processDueTasks(client).catch(err => log.error(`Task poll failed: ${err.message}`))
    run()
    scheduler = setInterval(run, 60 * 1000)
    scheduler.unref?.()
    return scheduler
}

module.exports = {
    ModerationTask,
    scheduleTempbanUnban,
    countPendingTasks,
    processDueTasks,
    startModerationTaskScheduler,
}
