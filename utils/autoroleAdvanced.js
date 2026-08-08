const { getServerConfig, updateGuildConfigAndWait } = require("./serverConfig")

const MAX_AUTOROLES_PER_TYPE = 10

function uniqueIds(values, limit = MAX_AUTOROLES_PER_TYPE) {
    if (!Array.isArray(values)) return []
    return [...new Set(values.map(value => String(value || "").trim()).filter(id => /^\d{17,20}$/.test(id)))].slice(0, limit)
}

function normalizeAdvancedAutorole(raw = {}) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
    return {
        enabled: source.enabled !== false,
        humanRoleIds: uniqueIds(source.humanRoleIds),
        botRoleIds: uniqueIds(source.botRoleIds),
    }
}

function getAdvancedAutorole(guildId) {
    const config = getServerConfig(guildId).config
    return normalizeAdvancedAutorole(config.autoroleAdvanced)
}

async function saveAdvancedAutorole(guildId, value) {
    const normalized = normalizeAdvancedAutorole(value)
    await updateGuildConfigAndWait(guildId, { autoroleAdvanced: normalized })
    return normalized
}

async function addAutorole(guildId, type, roleId) {
    const config = getAdvancedAutorole(guildId)
    const key = type === "bot" ? "botRoleIds" : "humanRoleIds"
    const next = uniqueIds([...(config[key] || []), roleId])
    if (next.length === config[key].length && !config[key].includes(String(roleId))) {
        throw new Error(`Maximum ${MAX_AUTOROLES_PER_TYPE} ${type} autoroles reached`)
    }
    config[key] = next
    config.enabled = true
    return saveAdvancedAutorole(guildId, config)
}

async function removeAutorole(guildId, type, roleId) {
    const config = getAdvancedAutorole(guildId)
    const key = type === "bot" ? "botRoleIds" : "humanRoleIds"
    config[key] = config[key].filter(id => id !== String(roleId))
    return saveAdvancedAutorole(guildId, config)
}

async function clearAutoroles(guildId, type = "all") {
    const config = getAdvancedAutorole(guildId)
    if (type === "human" || type === "all") config.humanRoleIds = []
    if (type === "bot" || type === "all") config.botRoleIds = []
    return saveAdvancedAutorole(guildId, config)
}

async function setAutoroleAdvancedEnabled(guildId, enabled) {
    const config = getAdvancedAutorole(guildId)
    config.enabled = Boolean(enabled)
    return saveAdvancedAutorole(guildId, config)
}

function getJoinRoleIds(member) {
    const raw = getServerConfig(member.guild.id).config
    const advanced = normalizeAdvancedAutorole(raw.autoroleAdvanced)
    if (!advanced.enabled) return []

    const typeIds = member.user?.bot ? advanced.botRoleIds : advanced.humanRoleIds
    const ids = [...typeIds]

    // Preserve existing single-role behavior while servers migrate to distinct
    // human/bot sets. DEFAULT_ROLE_ID remains a final fallback exactly as before.
    if (raw.autoroleId && !ids.includes(String(raw.autoroleId))) ids.unshift(String(raw.autoroleId))
    if (!ids.length && process.env.DEFAULT_ROLE_ID) ids.push(String(process.env.DEFAULT_ROLE_ID))
    return uniqueIds(ids)
}

function validateAssignableRole(guild, role) {
    if (!role) return { ok: false, error: "Choose a role" }
    if (role.id === guild.id) return { ok: false, error: "@everyone cannot be used as an autorole" }
    if (role.managed) return { ok: false, error: "Integration-managed roles cannot be assigned manually" }
    const me = guild.members?.me
    if (!me?.permissions?.has("ManageRoles")) return { ok: false, error: "CURSED needs Manage Roles" }
    if (role.position >= me.roles.highest.position) return { ok: false, error: "Move CURSED above that role in the role hierarchy" }
    return { ok: true }
}

async function assignJoinRoles(member) {
    const roleIds = getJoinRoleIds(member)
    if (!roleIds.length) return { assigned: [], failed: [] }
    const assigned = []
    const failed = []

    for (const roleId of roleIds) {
        const role = member.guild.roles.cache.get(roleId)
        const check = validateAssignableRole(member.guild, role)
        if (!check.ok) {
            failed.push({ roleId, reason: check.error })
            continue
        }
        try {
            await member.roles.add(role, "CURSED Autorole")
            assigned.push(roleId)
        } catch (error) {
            failed.push({ roleId, reason: error.message })
        }
    }
    return { assigned, failed }
}

module.exports = {
    MAX_AUTOROLES_PER_TYPE,
    normalizeAdvancedAutorole,
    getAdvancedAutorole,
    saveAdvancedAutorole,
    addAutorole,
    removeAutorole,
    clearAutoroles,
    setAutoroleAdvancedEnabled,
    getJoinRoleIds,
    validateAssignableRole,
    assignJoinRoles,
}
