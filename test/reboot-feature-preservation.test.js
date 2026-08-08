const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const loader = read("handlers", "commandLoader.js")
const moderation = read("commands", "moderation.js")
const advancedModeration = read("commands", "moderationAdvanced.js")
const games = read("commands", "games.js")
const battle = read("commands", "battle.js")
const pets = read("commands", "pets.js")
const economy = read("commands", "economy.js")
const economyAdvanced = read("commands", "economy-advanced.js")
const premium = read("commands", "premium.js")
const memory = read("commands", "memory.js")
const fun = read("commands", "fun.js")

test("Reboot preserves every command module from the stable loader", () => {
    const requiredModules = [
        "moderation-prefix", "tickets", "birthdays", "help", "premium", "fun", "shop",
        "economy", "economy-advanced", "gambling", "games", "quests", "battle", "pets",
        "profiles", "leaderboards", "images", "owner-network", "admin", "memory",
        "server-insights", "public-stats-status", "leveling", "custom-roles",
    ]
    for (const moduleName of requiredModules) {
        assert.match(loader, new RegExp(`name:\\s*["']${moduleName}["']`), `missing command module ${moduleName}`)
    }
})

test("core moderation and setup commands remain registered", () => {
    for (const command of [
        "warn", "warnings", "clearwarns", "timeout", "untimeout", "mute", "unmute",
        "kick", "ban", "unban", "case", "cases", "welcome", "autorole",
    ]) {
        assert.match(moderation, new RegExp(`setName\\(["']${command}["']\\)`), `missing /${command}`)
    }
    for (const command of ["purge", "lock", "unlock", "slowmode", "nickname", "tempban", "softban", "note", "history"]) {
        assert.match(advancedModeration, new RegExp(`setName\\(["']${command}["']\\)`), `missing /${command}`)
    }
})

test("economy, games and community commands remain available", () => {
    for (const command of ["!daily", "!balance", "!rank", "!give", "!richlist", "!levels", "!shop", "!buy"]) {
        assert.match(economy, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!work", "!crime", "!heist", "!invest", "!collect", "!bank", "!interest", "!business", "!factory"]) {
        assert.match(economyAdvanced, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!dailygame", "!guess", "!rps", "!blackjack", "!mines", "!duel", "!treasure"]) {
        assert.match(games, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!battle", "!battleai", "!bossfight", "!battlestats"]) {
        assert.match(battle, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!adopt", "!mypet", "!feedpet", "!petplay", "!petsay", "!petstats", "!petheal", "!petrename", "!pettrain", "!petbattle", "!petshop", "!petinventory"]) {
        assert.match(pets, new RegExp(command.replace(/[!]/g, "\\!")))
    }
})

test("AI, memory and premium controls remain available", () => {
    for (const command of ["!roast", "!imagine", "!meme", "!trivia", "!story", "!roleplay", "!challenge", "!fortune", "!forget"]) {
        assert.match(fun, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!memories", "!remember", "!forgetmemory", "!clearmemory"]) {
        assert.match(memory, new RegExp(command.replace(/[!]/g, "\\!")))
    }
    for (const command of ["!premium", "!serverpremium", "!givepremium", "!revokepremium", "!setpremiumrole", "!setpayment", "!addchannel", "!removechannel", "!allchannels", "!channels"]) {
        assert.match(premium, new RegExp(command.replace(/[!]/g, "\\!")))
    }
})

test("battle engine is no longer coupled to serial AI network calls", () => {
    assert.doesNotMatch(battle, /require\(["']\.\.\/utils\/ai["']\)/)
    assert.doesNotMatch(battle, /callAI\s*\(/)
    assert.match(battle, /randomAbility/)
})

test("professionalized modules avoid theatrical all-caps headings and insult boilerplate", () => {
    const sources = [games, battle, pets, economy, economyAdvanced, premium, memory, fun]
    for (const source of sources) {
        assert.doesNotMatch(source, /HEIST SUCCESS|HEIST FAILED|BOSS FIGHT|CURSED RICH LIST|broke\.|genius\.|drama queen|greedy\./i)
    }
})
