const fs = require("fs")

const MEMORY_FILE = "./memory.json"
const MEMORY_FILE_BAK = "./memory.json.bak"
const MAX_MEMORY = 40
const MAX_CONTEXT = 20
const MAX_FILE_SIZE = 10_485_760

function memKey(guildId, userId) {
    return `${guildId}:${userId}`
}

function boundedLimit(value, fallback, max) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(max, Math.floor(parsed)))
}

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
    } catch (err) { console.error("Memory load error:", err.message) }
    return {}
}

function saveMemory(mem) {
    try {
        const serialized = JSON.stringify(mem, null, 2)
        if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_SIZE) {
            console.warn(`[Memory] memory.json exceeds ${MAX_FILE_SIZE / 1_048_576}MB — rotating to memory.json.bak`)
            try { fs.copyFileSync(MEMORY_FILE, MEMORY_FILE_BAK) } catch {}
        }
        fs.writeFileSync(MEMORY_FILE, serialized)
    } catch (err) { console.error("Memory save error:", err.message) }
}

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

function getUserMemory(guildId, userId, contextLimit = MAX_CONTEXT) {
    const mem = loadMemory()
    const history = mem[memKey(guildId, userId)] || []
    const limit = boundedLimit(contextLimit, MAX_CONTEXT, MAX_CONTEXT)
    return limit === 0 ? [] : history.slice(-limit)
}

function appendUserMemory(guildId, userId, userMsg, botReply, storageLimit = MAX_MEMORY) {
    const mem = loadMemory()
    const key = memKey(guildId, userId)
    const limit = boundedLimit(storageLimit, MAX_MEMORY, MAX_MEMORY)
    if (limit === 0) {
        delete mem[key]
        saveMemory(mem)
        return
    }
    if (!mem[key]) mem[key] = []
    mem[key].push({ role: "user", content: userMsg })
    mem[key].push({ role: "assistant", content: botReply })
    if (mem[key].length > limit) mem[key] = mem[key].slice(-limit)
    saveMemory(mem)
}

function clearUserMemory(guildId, userId) {
    const mem = loadMemory()
    delete mem[memKey(guildId, userId)]
    saveMemory(mem)
}

module.exports = { getUserMemory, appendUserMemory, clearUserMemory, cleanupMemory }
