const mongoose = require("mongoose")

const shortTermMemorySchema = new mongoose.Schema({
    memoryKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    messages: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        default: [],
    },
}, {
    collection: "short_term_memories",
    minimize: false,
    timestamps: true,
    versionKey: false,
})

module.exports = mongoose.models.ShortTermMemory
    || mongoose.model("ShortTermMemory", shortTermMemorySchema)
