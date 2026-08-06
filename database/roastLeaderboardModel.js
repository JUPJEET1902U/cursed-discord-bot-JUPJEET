const mongoose = require("mongoose")

const roastLeaderboardSchema = new mongoose.Schema({
    targetName: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    count: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    order: {
        type: Number,
        required: true,
        default: 0,
        index: true,
    },
}, {
    collection: "roast_leaderboard",
    minimize: false,
    timestamps: true,
})

module.exports = mongoose.models.RoastLeaderboardEntry
    || mongoose.model("RoastLeaderboardEntry", roastLeaderboardSchema)
