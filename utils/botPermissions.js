const { PermissionFlagsBits, PermissionsBitField } = require("discord.js")

const PERMISSION_GROUPS = Object.freeze({
    core: Object.freeze([
        Object.freeze({ label: "View Channels", bit: PermissionFlagsBits.ViewChannel }),
        Object.freeze({ label: "Send Messages", bit: PermissionFlagsBits.SendMessages }),
        Object.freeze({ label: "Embed Links", bit: PermissionFlagsBits.EmbedLinks }),
        Object.freeze({ label: "Attach Files", bit: PermissionFlagsBits.AttachFiles }),
        Object.freeze({ label: "Read Message History", bit: PermissionFlagsBits.ReadMessageHistory }),
    ]),
    moderation: Object.freeze([
        Object.freeze({ label: "Manage Messages", bit: PermissionFlagsBits.ManageMessages }),
        Object.freeze({ label: "Moderate Members", bit: PermissionFlagsBits.ModerateMembers }),
        Object.freeze({ label: "Kick Members", bit: PermissionFlagsBits.KickMembers }),
        Object.freeze({ label: "Ban Members", bit: PermissionFlagsBits.BanMembers }),
    ]),
    protection: Object.freeze([
        Object.freeze({ label: "View Audit Log", bit: PermissionFlagsBits.ViewAuditLog }),
        Object.freeze({ label: "Manage Channels", bit: PermissionFlagsBits.ManageChannels }),
        Object.freeze({ label: "Manage Roles", bit: PermissionFlagsBits.ManageRoles }),
        Object.freeze({ label: "Manage Server", bit: PermissionFlagsBits.ManageGuild }),
        Object.freeze({ label: "Manage Webhooks", bit: PermissionFlagsBits.ManageWebhooks }),
    ]),
})

function uniquePermissionSpecs(groups = Object.values(PERMISSION_GROUPS)) {
    const seen = new Set()
    const result = []
    for (const group of groups) {
        for (const spec of group || []) {
            const key = spec.bit.toString()
            if (seen.has(key)) continue
            seen.add(key)
            result.push(spec)
        }
    }
    return result
}

const RECOMMENDED_PERMISSION_SPECS = Object.freeze(uniquePermissionSpecs())
const RECOMMENDED_PERMISSION_VALUE = RECOMMENDED_PERMISSION_SPECS
    .reduce((value, spec) => value | BigInt(spec.bit), 0n)

function hasPermission(permissions, bit) {
    try {
        return Boolean(permissions?.has?.(bit))
    } catch {
        return false
    }
}

function missingPermissions(permissions, specs = RECOMMENDED_PERMISSION_SPECS) {
    return (specs || []).filter(spec => !hasPermission(permissions, spec.bit))
}

function permissionLabels(specs = []) {
    return specs.map(spec => spec.label)
}

function summarizePermissionGroup(permissions, specs) {
    const missing = missingPermissions(permissions, specs)
    return {
        total: specs.length,
        granted: specs.length - missing.length,
        missing,
        missingLabels: permissionLabels(missing),
        complete: missing.length === 0,
    }
}

function getGuildPermissionReport(botMember) {
    const permissions = botMember?.permissions || new PermissionsBitField(0n)
    return {
        core: summarizePermissionGroup(permissions, PERMISSION_GROUPS.core),
        moderation: summarizePermissionGroup(permissions, PERMISSION_GROUPS.moderation),
        protection: summarizePermissionGroup(permissions, PERMISSION_GROUPS.protection),
    }
}

function getChannelPermissionReport(botMember, channel) {
    let permissions = botMember?.permissions || new PermissionsBitField(0n)
    try {
        permissions = channel?.permissionsFor?.(botMember) || permissions
    } catch {}
    return summarizePermissionGroup(permissions, PERMISSION_GROUPS.core)
}

function recommendedPermissionValue() {
    return RECOMMENDED_PERMISSION_VALUE.toString()
}

function buildRecommendedInvite(clientId) {
    const id = String(clientId || "").trim()
    if (!/^\d{17,20}$/.test(id)) return null
    const params = new URLSearchParams({
        client_id: id,
        permissions: recommendedPermissionValue(),
        scope: "bot applications.commands",
    })
    return `https://discord.com/oauth2/authorize?${params.toString()}`
}

module.exports = {
    PERMISSION_GROUPS,
    RECOMMENDED_PERMISSION_SPECS,
    RECOMMENDED_PERMISSION_VALUE,
    uniquePermissionSpecs,
    hasPermission,
    missingPermissions,
    permissionLabels,
    summarizePermissionGroup,
    getGuildPermissionReport,
    getChannelPermissionReport,
    recommendedPermissionValue,
    buildRecommendedInvite,
}
