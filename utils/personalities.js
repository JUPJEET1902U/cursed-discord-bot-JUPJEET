/**
 * utils/personalities.js
 * Per-user personality preference storage (Phase 3)
 * Uses MongoDB when available, falls back to in-memory map.
 */

const mongoose = require("mongoose")
const logger = require("./logger")
const log = logger.child("Personalities")
const { VALID_PERSONALITIES } = require("./prompts")

// ── Mongoose Schema ────────────────────────────────────────────────────────────
const personalitySchema = new mongoose.Schema({
    userId:              { type: String, required: true, unique: true, index: true },
    currentPersonality:  { type: String, default: "cursed", enum: VALID_PERSONALITIES },
    updatedAt:           { type: Date, default: Date.now },
})

let PersonalityModel
try {
    PersonalityModel = mongoose.model("Personality")
} catch {
    PersonalityModel = mongoose.model("Personality", personalitySchema)
}

// In-memory fallback
const memoryStore = new Map()

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

/**
 * Get the current personality for a user.
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function getUserPersonality(userId) {
    if (isMongoConnected()) {
        try {
            const doc = await PersonalityModel.findOne({ userId }).lean()
            return doc?.currentPersonality || "cursed"
        } catch (err) {
            log.error(`Failed to get personality for ${userId}: ${err.message}`)
        }
    }
    return memoryStore.get(userId) || "cursed"
}

/**
 * Set the personality for a user.
 * @param {string} userId
 * @param {string} personality
 * @returns {Promise<boolean>}
 */
async function setUserPersonality(userId, personality) {
    if (!VALID_PERSONALITIES.includes(personality)) return false

    if (isMongoConnected()) {
        try {
            await PersonalityModel.findOneAndUpdate(
                { userId },
                { currentPersonality: personality, updatedAt: new Date() },
                { upsert: true, new: true }
            )
            log.info(`Set personality for ${userId} to ${personality}`)
            return true
        } catch (err) {
            log.error(`Failed to set personality for ${userId}: ${err.message}`)
        }
    }
    memoryStore.set(userId, personality)
    return true
}

/**
 * Reset a user's personality to the default.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function resetUserPersonality(userId) {
    if (isMongoConnected()) {
        try {
            await PersonalityModel.findOneAndUpdate(
                { userId },
                { currentPersonality: "cursed", updatedAt: new Date() },
                { upsert: true }
            )
        } catch (err) {
            log.error(`Failed to reset personality for ${userId}: ${err.message}`)
        }
    }
    memoryStore.delete(userId)
}

module.exports = { getUserPersonality, setUserPersonality, resetUserPersonality, VALID_PERSONALITIES }
