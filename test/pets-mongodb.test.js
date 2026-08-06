const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const petsSource = fs.readFileSync(path.join(root, "utils", "pets.js"), "utf8")
const modelSource = fs.readFileSync(path.join(root, "database", "petModel.js"), "utf8")
const commandSource = fs.readFileSync(path.join(root, "commands", "pets.js"), "utf8")

test("pet persistence no longer writes to JSON", () => {
    assert.doesNotMatch(petsSource, /writeFileSync\s*\(/)
    assert.match(petsSource, /PetData\.bulkWrite\s*\(/)
})

test("legacy pet data is imported without overwriting MongoDB records", () => {
    assert.match(petsSource, /\$setOnInsert/)
    assert.match(petsSource, /upsert:\s*true/)
    assert.match(petsSource, /LEGACY_PETS_PATH/)
})

test("pet documents preserve the complete legacy pet object", () => {
    assert.match(modelSource, /mongoose\.Schema\.Types\.Mixed/)
    assert.match(modelSource, /collection:\s*"pet_users"/)
})

test("existing synchronous pet API remains available", () => {
    for (const functionName of ["loadPets", "savePets", "getPet", "calcPetLevel"]) {
        assert.match(petsSource, new RegExp(`function ${functionName}\\(`))
    }
    assert.match(petsSource, /return \{ data: petCache, pet: petCache\[userId\] \|\| null \}/)
})

test("pet types and personalities remain unchanged", () => {
    const expectedTypes = [
        /dragon:\s*\{ emoji: "🐉"/,
        /cat:\s*\{ emoji: "😺"/,
        /ghost:\s*\{ emoji: "👻"/,
        /slime:\s*\{ emoji: "🟢"/,
        /demon:\s*\{ emoji: "😈"/,
    ]
    for (const pattern of expectedTypes) assert.match(petsSource, pattern)
    assert.match(petsSource, /personality: "You are a fierce but loyal dragon named \{name\}/)
    assert.match(petsSource, /personality: "You are a chaotic little demon named \{name\}/)
})

test("pet level formula remains unchanged", () => {
    assert.match(petsSource, /Math\.floor\(0\.15 \* Math\.sqrt\(xp\)\) \+ 1/)
})

test("adoption defaults, feeding, healing, and training costs remain unchanged", () => {
    assert.match(commandSource, /level: 1, xp: 0, hunger: 100, health: 100, mood: "happy", rarity: "common", skills: \[\]/)
    assert.match(commandSource, /const cost = 10/)
    assert.match(commandSource, /pet\.hunger = Math\.min\(100, \(pet\.hunger \|\| 0\) \+ 30\)/)
    assert.match(commandSource, /pet\.xp \+= 10/)
    assert.match(commandSource, /const cost = 50/)
    assert.match(commandSource, /const cost = 30/)
})

test("pet cooldowns and battle rewards remain unchanged", () => {
    assert.match(commandSource, /checkCooldown\(userId, "petplay", 60 \* 60 \* 1000\)/)
    assert.match(commandSource, /checkCooldown\(userId, "petsay", 30 \* 1000\)/)
    assert.match(commandSource, /checkCooldown\(userId, "pettrain", 2 \* 60 \* 60 \* 1000\)/)
    assert.match(commandSource, /checkCooldown\(userId, "petbattle", 30 \* 60 \* 1000\)/)
    assert.match(commandSource, /const reward = won \? Math\.floor\(Math\.random\(\) \* 50\) \+ 20 : 5/)
    assert.match(commandSource, /const xpGain = won \? 30 : 10/)
    assert.match(commandSource, /currentPet\.health = Math\.max\(10, \(currentPet\.health \|\| 100\) - 20\)/)
})

test("pet command names and user-facing response templates remain present", () => {
    for (const command of ["!adopt", "!mypet", "!feedpet", "!petplay", "!petsay", "!petstats", "!petheal", "!petrename", "!pettrain", "!petbattle", "!petshop", "!petinventory"]) {
        assert.match(commandSource, new RegExp(command.replace("!", "\\!")))
    }
    assert.match(commandSource, /Adopt a Pet!/)
    assert.match(commandSource, /Pet Battle:/)
    assert.match(commandSource, /Pet Shop/)
})
