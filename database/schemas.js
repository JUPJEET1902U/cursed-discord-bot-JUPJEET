/**
 * database/schemas.js
 * Centralized MongoDB schema definitions for CURSED bot
 */

const mongoose = require("mongoose")

// ── Users ──────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
    userId:       { type: String, required: true, unique: true, index: true },
    username:     { type: String, default: "Unknown" },
    level:        { type: Number, default: 0 },
    xp:           { type: Number, default: 0 },
    coins:        { type: Number, default: 0 },
    stats:        { type: Map, of: Number, default: {} },
    preferences:  { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    lastDaily:    { type: String, default: null },
    roastShield:  { type: Number, default: 0 },
    xpBoost:      { type: Number, default: 0 },
    dailyBoost:   { type: Number, default: 0 },
    vip:          { type: Boolean, default: false },
    badge:        { type: Boolean, default: false },
    prestige:     { type: Boolean, default: false },
    createdAt:    { type: Date, default: Date.now },
    updatedAt:    { type: Date, default: Date.now },
})

// ── Profiles ───────────────────────────────────────────────────────────────────
const profileSchema = new mongoose.Schema({
    userId:        { type: String, required: true, unique: true, index: true },
    personality:   { type: String, default: null },
    favoriteGame:  { type: String, default: null },
    favoriteAnime: { type: String, default: null },
    favoriteMusic: { type: String, default: null },
    joinDate:      { type: Date, default: null },
    premiumStatus: { type: Boolean, default: false },
    petInfo:       { type: mongoose.Schema.Types.Mixed, default: null },
    updatedAt:     { type: Date, default: Date.now },
})

// ── Quests ─────────────────────────────────────────────────────────────────────
const questSchema = new mongoose.Schema({
    userId:      { type: String, required: true, index: true },
    questId:     { type: String, required: true },
    type:        { type: String, required: true },
    description: { type: String, required: true },
    progress:    { type: Number, default: 0 },
    goal:        { type: Number, required: true },
    reward:      { coins: Number, xp: Number },
    difficulty:  { type: String, default: "normal", enum: ["easy", "normal", "hard", "legendary"] },
    completedAt: { type: Date, default: null },
    date:        { type: String, required: true },
})

questSchema.index({ userId: 1, date: 1 })

// ── Battles ────────────────────────────────────────────────────────────────────
const battleSchema = new mongoose.Schema({
    battleId:  { type: String, required: true, unique: true },
    player1:   { userId: String, username: String, hp: Number },
    player2:   { userId: String, username: String, hp: Number, isAI: Boolean },
    winner:    { type: String, default: null },
    narrative: { type: String, default: "" },
    rewards:   { coins: Number, xp: Number },
    timestamp: { type: Date, default: Date.now },
})

// ── Pets ───────────────────────────────────────────────────────────────────────
const petSchema = new mongoose.Schema({
    petId:     { type: String, required: true, unique: true },
    userId:    { type: String, required: true, index: true },
    name:      { type: String, required: true },
    type:      { type: String, required: true },
    emoji:     { type: String, default: "🐾" },
    level:     { type: Number, default: 1 },
    xp:        { type: Number, default: 0 },
    hunger:    { type: Number, default: 100 },
    health:    { type: Number, default: 100 },
    mood:      { type: String, default: "happy" },
    rarity:    { type: String, default: "common", enum: ["common", "uncommon", "rare", "epic", "legendary"] },
    skills:    [{ type: String }],
    lastFed:   { type: String, default: null },
    lastPlay:  { type: String, default: null },
    trainedAt: { type: Date, default: null },
    adoptedAt: { type: Date, default: Date.now },
})

// ── Leaderboards ───────────────────────────────────────────────────────────────
const leaderboardSchema = new mongoose.Schema({
    type:      { type: String, required: true, index: true },
    userId:    { type: String, required: true },
    username:  { type: String, required: true },
    score:     { type: Number, required: true },
    rank:      { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
})

leaderboardSchema.index({ type: 1, score: -1 })

// ── Personalities ──────────────────────────────────────────────────────────────
const personalitySchema = new mongoose.Schema({
    userId:             { type: String, required: true, unique: true, index: true },
    currentPersonality: { type: String, default: "cursed" },
    preferences:        { type: Map, of: String, default: {} },
    updatedAt:          { type: Date, default: Date.now },
})

// ── Safe model registration (idempotent) ───────────────────────────────────────
function getModel(name, schema) {
    try { return mongoose.model(name) } catch { return mongoose.model(name, schema) }
}

const UserModel         = getModel("User", userSchema)
const ProfileModel      = getModel("Profile", profileSchema)
const QuestModel        = getModel("Quest", questSchema)
const BattleModel       = getModel("Battle", battleSchema)
const PetModel          = getModel("Pet", petSchema)
const LeaderboardModel  = getModel("Leaderboard", leaderboardSchema)
const PersonalityModel  = getModel("Personality", personalitySchema)

module.exports = {
    UserModel,
    ProfileModel,
    QuestModel,
    BattleModel,
    PetModel,
    LeaderboardModel,
    PersonalityModel,
}
