const fs = require("fs")

const WARNINGS_FILE = "./warnings.json"

function loadWarnings() {
    try {
        if (fs.existsSync(WARNINGS_FILE)) return JSON.parse(fs.readFileSync(WARNINGS_FILE, "utf8"))
    } catch (err) { console.error("Warnings load error:", err.message) }
    return {}
}

function saveWarnings(data) {
    try { fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { console.error("Warnings save error:", err.message) }
}

/**
 * Add a warning for a user in a guild.
 * Returns the updated list of warnings for that user.
 */
function addWarning(guildId, userId, username, reason, moderatorId, moderatorName) {
    const data = loadWarnings()
    if (!data[guildId]) data[guildId] = {}
    if (!data[guildId][userId]) data[guildId][userId] = { username, warnings: [] }

    const warning = {
        id: Date.now(),
        reason,
        moderatorId,
        moderatorName,
        timestamp: new Date().toISOString()
    }
    data[guildId][userId].username = username
    data[guildId][userId].warnings.push(warning)
    saveWarnings(data)
    return data[guildId][userId].warnings
}

/**
 * Get all warnings for a user in a guild.
 */
function getWarnings(guildId, userId) {
    const data = loadWarnings()
    return data[guildId]?.[userId]?.warnings || []
}

/**
 * Clear all warnings for a user in a guild.
 * Returns the number of warnings that were cleared.
 */
function clearWarnings(guildId, userId) {
    const data = loadWarnings()
    const count = data[guildId]?.[userId]?.warnings?.length || 0
    if (data[guildId]?.[userId]) {
        data[guildId][userId].warnings = []
        saveWarnings(data)
    }
    return count
}

module.exports = { addWarning, getWarnings, clearWarnings }
