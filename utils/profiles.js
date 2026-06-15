const fs = require("fs")
const logger = require("./logger")
const { FILES } = require("../config/constants")

const PROFILES_FILE = FILES.PROFILES

function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"))
    } catch (err) { logger.error("Profiles", `Load error: ${err.message}`) }
    return {}
}

function saveProfiles(data) {
    try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { logger.error("Profiles", `Save error: ${err.message}`) }
}

function getProfile(userId) {
    return loadProfiles()[userId] || null
}

function setProfile(userId, profile) {
    const data = loadProfiles()
    data[userId] = profile
    saveProfiles(data)
}

module.exports = { loadProfiles, saveProfiles, getProfile, setProfile }
