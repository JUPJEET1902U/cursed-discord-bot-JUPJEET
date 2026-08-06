const mongoose = require("mongoose")

const economyUserSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        default: {},
    },
}, {
    collection: "economy_users",
    minimize: false,
    timestamps: true,
    versionKey: false,
})

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

module.exports = getModel("EconomyUser", economyUserSchema)
