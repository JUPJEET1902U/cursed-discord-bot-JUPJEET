const fs = require("fs")

const MEMORY_FILE     = "./memory.json"
const MEMORY_FILE_BAK = "./memory.json.bak"
const MAX_MEMORY      = 20          // max messages kept per user
const MAX_FILE_SIZE   = 10_485_760  // 10 MB — rotate when exceeded

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
    } catch (err) { console.error("Memory load error:", err.message) }
    return {}
}

/**
 * Persist memory to disk. If the file would exceed MAX_FILE_SIZE, rotate the
 * current file to memory.json.bak and start fresh with only the new entry.
 * This prevents unbounded growth of memory.json.
 */
function saveMemory(mem) {
    try {
        const serialized = JSON.stringify(mem, null, 2)

        // Check if the serialized content exceeds the size limit
        if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_SIZE) {
            console.warn(`[Memory] memory.json exceeds ${MAX_FILE_SIZE / 1_048_576}MB — rotating to memory.json.bak`)
            try {
                // Overwrite any existing backup
                fs.copyFileSync(MEMORY_FILE, MEMORY_FILE_BAK)
            } catch { /* ignore if source doesn't exist */ }
            // Start fresh — write only the current (already-trimmed) data
            fs.writeFileSync(MEMORY_FILE, serialized)
            return
        }

        fs.writeFileSync(MEMORY_FILE, serialized)
    } catch (err) { console.error("Memory save error:", err.message) }
}

/**
 * Remove entries for users who have no stored messages.
 * Also trims any per-user arrays that somehow exceed MAX_MEMORY.
 */
function cleanupMemory() {
    const mem = loadMemory()
    let changed = false
    for (const userId of Object.keys(mem)) {
        if (!Array.isArray(mem[userId]) || mem[userId].length === 0) {
            delete mem[userId]
            changed = true
        } else if (mem[userId].length > MAX_MEMORY) {
            mem[userId] = mem[userId].slice(-MAX_MEMORY)
            changed = true
        }
    }
    if (changed) saveMemory(mem)
}

function getUserMemory(userId) {
    const mem = loadMemory()
    return mem[userId] || []
}

function appendUserMemory(userId, userMsg, botReply) {
    const mem = loadMemory()
    if (!mem[userId]) mem[userId] = []
    mem[userId].push({ role: "user", content: userMsg })
    mem[userId].push({ role: "assistant", content: botReply })
    if (mem[userId].length > MAX_MEMORY) mem[userId] = mem[userId].slice(-MAX_MEMORY)
    saveMemory(mem)
}

function clearUserMemory(userId) {
    const mem = loadMemory()
    delete mem[userId]
    saveMemory(mem)
}

module.exports = { getUserMemory, appendUserMemory, clearUserMemory, cleanupMemory }
