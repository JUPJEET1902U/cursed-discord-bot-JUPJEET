const fs = require("fs")

const MEMORY_FILE  = "./memory.json"
const BACKUP_FILE  = "./memory.json.1"
const MAX_MEMORY   = 50   // max conversation entries per user (enforced on write)
const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5 MB — rotate when exceeded
const INACTIVE_DAYS = 7  // remove users with no activity in this many days

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
    } catch (err) { console.error("Memory load error:", err.message) }
    return {}
}

function saveMemory(mem) {
    try {
        // Rotate if file exceeds size limit
        if (fs.existsSync(MEMORY_FILE)) {
            const stat = fs.statSync(MEMORY_FILE)
            if (stat.size > MAX_FILE_BYTES) {
                console.warn(`[Memory] memory.json exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB — rotating to memory.json.1`)
                fs.copyFileSync(MEMORY_FILE, BACKUP_FILE)
                // Keep only the most recent 100 users in the active file after rotation
                const entries = Object.entries(mem)
                const trimmed = Object.fromEntries(entries.slice(-100))
                fs.writeFileSync(MEMORY_FILE, JSON.stringify(trimmed, null, 2))
                return
            }
        }
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2))
    } catch (err) { console.error("Memory save error:", err.message) }
}

function getUserMemory(userId) {
    const mem = loadMemory()
    return mem[userId] || []
}

function appendUserMemory(userId, userMsg, botReply) {
    const mem = loadMemory()
    if (!mem[userId]) mem[userId] = []
    mem[userId].push({ role: "user", content: userMsg, ts: Date.now() })
    mem[userId].push({ role: "assistant", content: botReply, ts: Date.now() })
    // Enforce per-user limit
    if (mem[userId].length > MAX_MEMORY) mem[userId] = mem[userId].slice(-MAX_MEMORY)
    saveMemory(mem)
}

function clearUserMemory(userId) {
    const mem = loadMemory()
    delete mem[userId]
    saveMemory(mem)
}

/**
 * Remove users who have had no memory activity for more than INACTIVE_DAYS.
 * Should be called on startup and every 24 hours.
 *
 * @returns {{ removed: number, remaining: number }}
 */
function cleanupMemory() {
    const mem = loadMemory()
    const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000
    let removed = 0

    for (const [userId, entries] of Object.entries(mem)) {
        if (!Array.isArray(entries) || entries.length === 0) {
            delete mem[userId]
            removed++
            continue
        }
        // Find the most recent timestamp in this user's entries
        const mostRecent = entries.reduce((max, e) => Math.max(max, e.ts || 0), 0)
        if (mostRecent > 0 && mostRecent < cutoff) {
            delete mem[userId]
            removed++
        }
    }

    if (removed > 0) {
        saveMemory(mem)
        console.log(`[Memory] Cleanup: removed ${removed} inactive users, ${Object.keys(mem).length} remaining`)
    }

    return { removed, remaining: Object.keys(mem).length }
}

// Run cleanup on startup
cleanupMemory()

// Run cleanup every 24 hours
setInterval(() => {
    cleanupMemory()
}, 24 * 60 * 60 * 1000)

module.exports = { getUserMemory, appendUserMemory, clearUserMemory, cleanupMemory }
