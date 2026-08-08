const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { PermissionFlagsBits, PermissionsBitField } = require("discord.js")
const permissions = require("../utils/botPermissions")

const root = path.resolve(__dirname, "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

function permissionSet(bits = []) {
    return new PermissionsBitField(bits)
}

test("recommended CURSED permissions are explicit and never request Administrator", () => {
    const value = BigInt(permissions.recommendedPermissionValue())
    assert.equal((value & BigInt(PermissionFlagsBits.Administrator)) !== 0n, false)
    assert.equal((value & BigInt(PermissionFlagsBits.SendMessages)) !== 0n, true)
    assert.equal((value & BigInt(PermissionFlagsBits.ManageMessages)) !== 0n, true)
    assert.equal((value & BigInt(PermissionFlagsBits.ViewAuditLog)) !== 0n, true)
    assert.equal((value & BigInt(PermissionFlagsBits.ManageRoles)) !== 0n, true)
})

test("permission reports identify exact missing capabilities", () => {
    const member = {
        permissions: permissionSet([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
        ]),
    }
    const report = permissions.getGuildPermissionReport(member)
    assert.equal(report.core.complete, true)
    assert.equal(report.moderation.complete, false)
    assert.ok(report.moderation.missingLabels.includes("Moderate Members"))
    assert.ok(report.protection.missingLabels.includes("View Audit Log"))
})

test("channel permission report respects channel-specific overwrites", () => {
    const member = { permissions: permissionSet(permissions.RECOMMENDED_PERMISSION_SPECS.map(spec => spec.bit)) }
    const restricted = permissionSet([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
    ])
    const channel = { permissionsFor: () => restricted }
    const report = permissions.getChannelPermissionReport(member, channel)
    assert.equal(report.complete, false)
    assert.ok(report.missingLabels.includes("Send Messages"))
    assert.ok(report.missingLabels.includes("Embed Links"))
})

test("system commands expose public status and manager-only diagnostics", () => {
    const source = read("commands", "system.js")
    assert.match(source, /setName\("cursed"\)/)
    assert.match(source, /setName\("doctor"\)/)
    assert.match(source, /setDefaultMemberPermissions\(PermissionFlagsBits\.ManageGuild\)/)
    assert.match(source, /does \*\*not\*\* require Discord Administrator permission/)
    assert.match(source, /read-only diagnostic/i)
})

test("system catalog is loaded and the command module participates in unified dispatch", () => {
    const loader = read("handlers", "commandLoader.js")
    const catalog = read("commands", "systemCatalog.js")
    assert.match(loader, /require\("\.\.\/commands\/systemCatalog"\)/)
    assert.match(loader, /\{ name: "system", module: require\("\.\.\/commands\/system"\) \}/)
    assert.match(catalog, /name: "!doctor"/)
    assert.match(catalog, /name: "!permissions"/)
    assert.match(catalog, /name: "\/doctor"/)
})
