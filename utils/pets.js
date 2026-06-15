const fs = require("fs")
const logger = require("./logger")
const { FILES, PET_TYPES } = require("../config/constants")

const PETS_FILE = FILES.PETS

function loadPets() {
    try {
        if (fs.existsSync(PETS_FILE)) return JSON.parse(fs.readFileSync(PETS_FILE, "utf8"))
    } catch (err) { logger.error("Pets", `Load error: ${err.message}`) }
    return {}
}

function savePets(data) {
    try { fs.writeFileSync(PETS_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { logger.error("Pets", `Save error: ${err.message}`) }
}

function getPet(userId) {
    const data = loadPets()
    return { data, pet: data[userId] || null }
}

function calcPetLevel(xp) { return Math.floor(0.15 * Math.sqrt(xp)) + 1 }

module.exports = { PETS_FILE, PET_TYPES, loadPets, savePets, getPet, calcPetLevel }
