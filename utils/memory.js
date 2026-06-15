const fs = require("fs")
const logger = require("./logger")
const { FILES, AI } = require("../config/constants")

const MEMORY_FILE = FILES.MEMORY
const MAX_MEMORY  = AI.MAX_MEMORY

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
    } catch (err) { logger.error("Memory", `Load error: ${err.message}`) }
    return {}
}

function saveMemory(mem) {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2)) }
    catch (err) { logger.error("Memory", `Save error: ${err.message}`) }
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

module.exports = { getUserMemory, appendUserMemory, clearUserMemory }
