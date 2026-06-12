const fs = require("fs")

const PETS_FILE = "./pets.json"

const PET_TYPES = {
    dragon: { emoji: "🐉", desc: "Fierce and loyal, grows to be a mighty beast",       personality: "You are a fierce but loyal dragon named {name}. Speak in short dramatic sentences. You are protective of your owner." },
    cat:    { emoji: "😺", desc: "Sarcastic like its owner, mysteriously powerful",     personality: "You are a sarcastic and superior cat named {name}. Speak with disdain and mild condescension. You secretly care." },
    ghost:  { emoji: "👻", desc: "Haunts your enemies and spooks the server",           personality: "You are a spooky ghost named {name}. Speak ominously and reference the afterlife. You're playfully scary." },
    slime:  { emoji: "🟢", desc: "Weird and wobbly, surprisingly powerful",             personality: "You are a cheerful bubbly slime named {name}. Speak with enthusiasm and lots of bouncy energy." },
    demon:  { emoji: "😈", desc: "Pure evil energy, maximum chaos",                     personality: "You are a chaotic little demon named {name}. Speak with sinister energy and dark humor. Chaos is your love language." },
}

function loadPets() {
    try {
        if (fs.existsSync(PETS_FILE)) return JSON.parse(fs.readFileSync(PETS_FILE, "utf8"))
    } catch (err) { console.error("Pets load error:", err.message) }
    return {}
}

function savePets(data) {
    try { fs.writeFileSync(PETS_FILE, JSON.stringify(data, null, 2)) }
    catch (err) { console.error("Pets save error:", err.message) }
}

function getPet(userId) {
    const data = loadPets()
    return { data, pet: data[userId] || null }
}

function calcPetLevel(xp) { return Math.floor(0.15 * Math.sqrt(xp)) + 1 }

module.exports = { PETS_FILE, PET_TYPES, loadPets, savePets, getPet, calcPetLevel }
