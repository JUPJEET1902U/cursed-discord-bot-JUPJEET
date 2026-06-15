const fs = require("fs")
const logger = require("./logger")
const { FILES } = require("../config/constants")

const LEADERBOARD_FILE = FILES.ROAST_COUNTS

function loadCounts() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8"))
    } catch (err) { logger.error("Roast", `Load error: ${err.message}`) }
    return {}
}

function saveCounts(counts) {
    try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(counts, null, 2)) }
    catch (err) { logger.error("Roast", `Save error: ${err.message}`) }
}

function addRoast(name) {
    const counts = loadCounts()
    counts[name] = (counts[name] || 0) + 1
    saveCounts(counts)
}

function getLeaderboard() {
    const counts = loadCounts()
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return sorted.length === 0 ? null : sorted
}

module.exports = { addRoast, getLeaderboard }
