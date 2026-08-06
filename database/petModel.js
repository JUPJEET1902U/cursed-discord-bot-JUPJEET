const mongoose = require("mongoose")

const petDataSchema = new mongoose.Schema({
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
    collection: "pet_users",
    minimize: false,
    timestamps: true,
})

module.exports = mongoose.models.PetData
    || mongoose.model("PetData", petDataSchema)
