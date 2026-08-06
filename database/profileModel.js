const mongoose = require("mongoose")

const profileDataSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
}, {
    collection: "profile_users",
    minimize: false,
    timestamps: true,
})

module.exports = mongoose.models.ProfileData
    || mongoose.model("ProfileData", profileDataSchema)
