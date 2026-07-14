const fs = require("fs")

const MEMORY_FILE     = "./memory.json"
const MEMORY_FILE_BAK = "./memory.json.bak"
const MAX_MEMORY      = 20   // max messages stored per user per guild
const MAX_CONTEXT     = 10   // max messages sent to AI (last 5 exchanges)
const MAX_FILE_SIZE   = 10_485_760  // 10 MB — rotate when exceeded

function memKey(guildId, userId) {
    return `${guildId}:${userId}`
}

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

        if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_SIZE) {
            console.warn(`[Memory] memory.json exceeds ${MAX_FILE_SIZE / 1_048_576}MB — rotating to memory.json.bak`)
            try {
                fs.copyFileSync(MEMORY_FILE, MEMORY_FILE_BAK)
            } catch { /* ignore if source doesn't exist */ }
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
    for (const key of Object.keys(mem)) {
        if (!Array.isArray(mem[key]) || mem[key].length === 0) {
            delete mem[key]
            changed = true
        } else if (mem[key].length > MAX_MEMORY) {
            mem[key] = mem[key].slice(-MAX_MEMORY)
            changed = true
        }
    }
    if (changed) saveMemory(mem)
}

/**
 * Return the most recent MAX_CONTEXT messages for this user in this guild.
 * Returns an empty array safely if no history exists.
 */
function getUserMemory(guildId, userId) {
    const mem = loadMemory()
    const history = mem[memKey(guildId, userId)] || []
    // Only send the last MAX_CONTEXT messages to keep AI context tight
    return history.slice(-MAX_CONTEXT)
}

function appendUserMemory(guildId, userId, userMsg, botReply) {
    const mem = loadMemory()
    const key = memKey(guildId, userId)
    if (!mem[key]) mem[key] = []
    mem[key].push({ role: "user", content: userMsg })
    mem[key].push({ role: "assistant", content: botReply })
    if (mem[key].length > MAX_MEMORY) mem[key] = mem[key].slice(-MAX_MEMORY)
    saveMemory(mem)
}

function clearUserMemory(guildId, userId) {
    const mem = loadMemory()
    delete mem[memKey(guildId, userId)]
    saveMemory(mem)
}

module.exports = { getUserMemory, appendUserMemory, clearUserMemory, cleanupMemory }
