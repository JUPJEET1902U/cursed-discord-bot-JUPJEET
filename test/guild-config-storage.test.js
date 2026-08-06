const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

const serverConfigSource = read("utils", "serverConfig.js")
const guildStoreSource = read("utils", "GuildConfigStore.js")
const guildApiSource = read("api", "services", "guild.ts")
const auditSource = read("docs", "server-config-storage-audit.md")

test("legacy serverConfig.json is import-only for production callers", () => {
    assert.match(serverConfigSource, /GUILD_CONFIG_MIRROR_JSON\s*=\s*"false"/)
    assert.match(guildStoreSource, /loadJsonConfig\s*\(/)
    assert.match(guildStoreSource, /migrateJsonConfigsToMongo\s*\(/)
    assert.match(guildStoreSource, /\$setOnInsert/)
    assert.match(guildStoreSource, /migratedFrom:\s*"serverConfig\.json"/)
})

test("TypeScript guild API uses the shared Mongo-backed config facade", () => {
    assert.match(guildApiSource, /createRequire\(import\.meta\.url\)/)
    assert.match(guildApiSource, /utils\/serverConfig\.js/)
    assert.match(guildApiSource, /updateGuildConfigAndWait/)
    assert.doesNotMatch(guildApiSource, /const CONFIG_FILE/)
    assert.doesNotMatch(guildApiSource, /function loadServerConfig/)
    assert.doesNotMatch(guildApiSource, /function saveServerConfig/)
    assert.doesNotMatch(guildApiSource, /writeFileSync\s*\(\s*CONFIG_FILE/)
})

test("dashboard guild update allow-list remains unchanged", () => {
    const fields = [
        "antiSpam", "antiLink", "antiInvite", "linkWhitelist",
        "welcomeEnabled", "welcomeChannelId", "welcomeMessage",
        "goodbyeEnabled", "goodbyeChannelId", "goodbyeMessage",
        "aiEnabled", "aiPersonality", "aiMaxTokens", "aiMemoryEnabled",
        "aiChannelId",
    ]

    for (const field of fields) {
        assert.ok(guildApiSource.includes(`'${field}'`), `missing allowed field ${field}`)
    }
})

test("dashboard guild defaults and response shape remain unchanged", () => {
    const defaults = [
        "prefix: '!'",
        "allowedChannels: []",
        "modLogChannelId: null",
        "premiumRoleId: null",
        "antiSpam: false",
        "antiLink: false",
        "antiInvite: false",
        "welcomeEnabled: false",
        "goodbyeEnabled: false",
        "aiEnabled: true",
        "aiPersonality: 'cursed'",
        "aiMaxTokens: 500",
        "aiMemoryEnabled: true",
    ]

    for (const value of defaults) assert.ok(guildApiSource.includes(value), `missing default ${value}`)
    assert.match(guildApiSource, /return \{ \.\.\.DEFAULT_CONFIG, \.\.\.existing, guildId \}/)
    assert.match(guildApiSource, /return \{ \.\.\.DEFAULT_CONFIG, \.\.\.\(stored as Partial<GuildConfigData>\), guildId \}/)
})

test("existing server-setting wrappers still use the shared facade", () => {
    const wrappers = [
        ["utils", "prefix.js"],
        ["utils", "welcome.js"],
        ["utils", "autorole.js"],
        ["utils", "moderationConfig.js"],
        ["utils", "moderationPhase2Config.js"],
        ["utils", "securityPhase3Config.js"],
        ["utils", "ticketConfig.js"],
    ]

    for (const file of wrappers) {
        const source = read(...file)
        assert.match(source, /require\("\.\/serverConfig"\)/, `${file.join("/")} bypasses serverConfig`)
        assert.doesNotMatch(source, /writeFileSync\s*\(/, `${file.join("/")} writes JSON directly`)
    }
})

test("dedicated Mongo-only configuration stores remain separate", () => {
    assert.match(read("utils", "leveling.js"), /collection:\s*"levelingConfigs"/)
    assert.match(read("utils", "customRoles.js"), /collection:\s*"customRoleConfigs"/)
    assert.match(read("utils", "ticketModels.js"), /collection:\s*"ticketPanels"/)
    assert.match(read("utils", "birthdays.js"), /collection:\s*"birthdayGuildConfigs"/)
    assert.match(read("utils", "serverPremium.js"), /collection:\s*"premiumGuildAccounts"/)
})

test("storage audit records JSON, memory and MongoDB stores", () => {
    for (const term of [
        "serverConfig.json",
        "mongoCache",
        "guildConfigs",
        "levelingConfigs",
        "customRoleConfigs",
        "ticketPanels",
        "birthdayGuildConfigs",
        "premiumGuildAccounts",
    ]) {
        assert.ok(auditSource.includes(term), `audit is missing ${term}`)
    }

    assert.match(auditSource, /read-only legacy import source/i)
    assert.match(auditSource, /Dashboard frontend files and command handlers are not modified/)
})
