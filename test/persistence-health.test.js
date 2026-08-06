const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const shutdownSource = read("utils", "persistenceShutdown.js")
const serverConfigSource = read("utils", "serverConfig.js")
const guildStoreSource = read("utils", "GuildConfigStore.js")
const memorySource = read("utils", "memory.js")
const petsSource = read("utils", "pets.js")
const economySource = read("utils", "economy.js")
const profilesSource = read("utils", "profiles.js")
const roastSource = read("utils", "roast.js")
const premiumSource = read("utils", "premium.js")
const serverPremiumSource = read("utils", "serverPremium.js")
const birthdaysSource = read("utils", "birthdays.js")
const indexSource = read("index.js")
const auditSource = read("docs", "persistence-health-audit.md")

test("graceful shutdown is bounded and wraps the existing mongoose close", () => {
    assert.match(shutdownSource, /DEFAULT_FLUSH_TIMEOUT_MS = 4_000/)
    assert.match(shutdownSource, /DEFAULT_CLOSE_TIMEOUT_MS = 1_500/)
    assert.match(shutdownSource, /Promise\.race\s*\(/)
    assert.match(shutdownSource, /mongoose\.connection\.close = async function closeWithPersistenceFlush/)
    assert.match(shutdownSource, /await flushPersistenceQueues/)
    assert.match(shutdownSource, /settleWithin\(originalClose/)
    assert.match(indexSource, /await mongoose\.connection\.close\(\)/)
    assert.match(indexSource, /process\.on\("SIGTERM"/)
    assert.match(indexSource, /process\.on\("SIGINT"/)
})

test("shutdown loads no new persistence feature modules", () => {
    assert.match(shutdownSource, /require\.cache\[resolved\]\?\.exports/)
    assert.match(shutdownSource, /loadedQueueFlushers/)
    assert.doesNotMatch(shutdownSource, /require\(modulePath\)/)
    for (const name of [
        "economy",
        "profiles",
        "pets",
        "short-term memory",
        "roast leaderboard",
        "birthdays",
        "Premium",
        "server Premium",
    ]) {
        assert.ok(shutdownSource.includes(`"${name}"`), `missing shutdown flusher: ${name}`)
    }
})

test("guild configuration keeps synchronous APIs and gains reconnect/shutdown queueing", () => {
    const mirrorFlag = serverConfigSource.indexOf('process.env.GUILD_CONFIG_MIRROR_JSON = "false"')
    const storeRequire = serverConfigSource.indexOf('require("./GuildConfigStore")')
    const queueInstall = serverConfigSource.indexOf("installGuildConfigQueue")
    assert.ok(mirrorFlag >= 0 && mirrorFlag < storeRequire)
    assert.ok(queueInstall > storeRequire)
    assert.match(serverConfigSource, /installGracefulMongoClose\(\)/)
    assert.match(shutdownSource, /pendingGuildConfigs = new Map\(\)/)
    assert.match(shutdownSource, /updateGuildConfigAndWait\(guildId, config\)/)
    assert.match(shutdownSource, /mongoose\.connection\.on\("connected"/)
    assert.match(shutdownSource, /flushGuildConfigWrites/)
    assert.doesNotMatch(serverConfigSource, /async function saveConfig/)
    assert.match(guildStoreSource, /function saveGuildConfig\(/)
    assert.match(guildStoreSource, /async function updateGuildConfigAndWait\(/)
})

test("cleared short-term memory is an existing-schema tombstone", () => {
    assert.match(memorySource, /messages: messages === DELETE_MEMORY \? \[\] : clone\(messages\)/)
    assert.match(memorySource, /empty MongoDB history is a tombstone/i)
    assert.match(memorySource, /Array\.isArray\(mongoMessages\) && mongoMessages\.length > 0/)
    assert.doesNotMatch(memorySource, /deleteOne:\s*\{\s*filter:\s*\{ memoryKey \}/)
    assert.match(memorySource, /function clearUserMemory\(/)
    assert.match(memorySource, /pendingWrites\.set\(key, DELETE_MEMORY\)/)
})

test("deleted pets are existing-schema null tombstones", () => {
    assert.match(petsSource, /data: pet === DELETE_PET \? null : clone\(pet\)/)
    assert.match(petsSource, /null MongoDB value is a tombstone/i)
    assert.match(petsSource, /if \(mongoData == null\)/)
    assert.doesNotMatch(petsSource, /deleteOne:\s*\{\s*filter:\s*\{ userId \}/)
    assert.match(petsSource, /function getPet\(userId\)/)
})

test("legacy JSON imports remain insert-only and read-only", () => {
    for (const [name, source] of [
        ["economy", economySource],
        ["profiles", profilesSource],
        ["pets", petsSource],
        ["memory", memorySource],
        ["roast", roastSource],
        ["Premium", premiumSource],
        ["server Premium", serverPremiumSource],
        ["birthdays", birthdaysSource],
        ["guild config", guildStoreSource],
    ]) {
        assert.match(source, /\$setOnInsert/, `${name} must keep insert-only migration`)
    }

    for (const [name, source] of [
        ["economy", economySource],
        ["profiles", profilesSource],
        ["pets", petsSource],
        ["memory", memorySource],
        ["roast", roastSource],
        ["Premium", premiumSource],
        ["server Premium", serverPremiumSource],
        ["birthdays", birthdaysSource],
    ]) {
        assert.doesNotMatch(source, /fs\.writeFileSync\s*\(/, `${name} must not rewrite legacy JSON`)
    }
    assert.match(serverConfigSource, /GUILD_CONFIG_MIRROR_JSON = "false"/)
})

test("queue-backed stores reuse the default mongoose connection", () => {
    for (const [name, source] of [
        ["economy", economySource],
        ["profiles", profilesSource],
        ["pets", petsSource],
        ["memory", memorySource],
        ["roast", roastSource],
    ]) {
        assert.match(source, /mongoose\.connection\.readyState === 1/, `${name} missing connected reuse`)
        assert.match(source, /mongoose\.connection\.readyState === 0/, `${name} missing disconnected guard`)
        assert.match(source, /await mongoose\.connect\(process\.env\.MONGO_URI\)/, `${name} missing fallback connect`)
        assert.doesNotMatch(source, /mongoose\.createConnection\(/, `${name} must not create a second pool`)
    }
    assert.doesNotMatch(indexSource, /mongoose\.createConnection\(/)
})

test("startup and background promises retain rejection handling", () => {
    for (const [name, source] of [
        ["economy", economySource],
        ["profiles", profilesSource],
        ["pets", petsSource],
        ["memory", memorySource],
        ["roast", roastSource],
    ]) {
        assert.match(source, /\.catch\(err => console\.error/, `${name} startup chain needs a catch`)
    }
    assert.match(premiumSource, /refreshPremiumCache\(\)\.catch/)
    assert.match(serverPremiumSource, /refreshServerPremiumCache\(\)\.catch/)
    assert.match(birthdaysSource, /initializeBirthdayStore\(\)\.catch/)
    assert.match(indexSource, /process\.on\("unhandledRejection"/)
    assert.match(indexSource, /process\.on\("uncaughtException"/)
})

test("collection and model inventory has no intended identity collisions", () => {
    const requiredCollections = [
        "economy_users",
        "profile_users",
        "pet_users",
        "guildConfigs",
        "short_term_memories",
        "premiumAccounts",
        "premiumSettings",
        "premiumCodes",
        "premiumGuildAccounts",
        "birthdayEntries",
        "birthdayGuildConfigs",
        "birthdayDmDeliveries",
        "roast_leaderboard",
        "longtermmemories",
        "personalities",
        "levelingConfigs",
        "levelingMembers",
        "customRoleConfigs",
        "customRoleAudits",
        "activities",
        "guildStatsConfigs",
        "guildActivityDaily",
        "userActivityDaily",
        "channelActivityDaily",
        "ticketPanels",
        "tickets",
        "ticketCounters",
        "securitySnapshots",
        "securityBotApprovals",
        "securityIncidentModes",
    ]
    for (const collection of requiredCollections) {
        assert.ok(auditSource.includes(`\`${collection}\``), `audit missing collection ${collection}`)
    }
    assert.match(auditSource, /unique `memoryKey`/)
    assert.match(auditSource, /unique exact `targetName`/)
    assert.match(auditSource, /unique \(`guildId,userId`\)/)
})

test("audit documents caches, retries, stale imports and Railway verification", () => {
    for (const term of [
        "pendingWrites",
        "pendingAccountWrites",
        "pendingGuildWrites",
        "pendingIncrements",
        "30-second retry timer",
        "$setOnInsert",
        "startup-race",
        "SIGTERM",
        "PERSISTENCE_FLUSH_TIMEOUT_MS",
        "MONGO_CLOSE_TIMEOUT_MS",
        "Railway verification",
        "messages: []",
        "data: null",
    ]) {
        assert.ok(auditSource.includes(term), `audit missing ${term}`)
    }
    assert.match(auditSource, /never blocked indefinitely/i)
    assert.match(auditSource, /Do not change|does not change/i)
})
