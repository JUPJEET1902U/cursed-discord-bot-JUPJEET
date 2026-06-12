const fs = require("fs")
const crypto = require("crypto")

const CODES_FILE = "./premiumCodes.json"

function loadCodes() {
    try {
        if (fs.existsSync(CODES_FILE)) return JSON.parse(fs.readFileSync(CODES_FILE, "utf8"))
    } catch (err) { console.error("Codes load error:", err.message) }
    return {}
}

function saveCodes(data) {
    try { fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { console.error("Codes save error:", err.message) }
}

function generateCode() {
    return "CURSED-" + crypto.randomBytes(4).toString("hex").toUpperCase()
}

function createCode(adminId, note = "") {
    const codes = loadCodes()
    const code = generateCode()
    codes[code] = { used: false, createdBy: adminId, note, createdAt: new Date().toISOString(), usedBy: null }
    saveCodes(codes)
    return code
}

function useCode(code, userId) {
    const codes = loadCodes()
    if (!codes[code]) return { ok: false, reason: "invalid" }
    if (codes[code].used) return { ok: false, reason: "used" }
    codes[code].used = true
    codes[code].usedBy = userId
    codes[code].usedAt = new Date().toISOString()
    saveCodes(codes)
    return { ok: true }
}

function listCodes() {
    const codes = loadCodes()
    return Object.entries(codes).map(([code, info]) => ({ code, ...info }))
}

module.exports = { loadCodes, saveCodes, generateCode, createCode, useCode, listCodes }
