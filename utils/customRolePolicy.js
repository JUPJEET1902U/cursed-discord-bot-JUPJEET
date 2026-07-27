const BASE_ROLE_COMMANDS = Object.freeze([
    { name: "staff", label: "Staff" },
    { name: "girl", label: "Girl" },
    { name: "vip", label: "VIP" },
    { name: "guest", label: "Guest" },
    { name: "friend", label: "Friend" },
])

const MAX_CUSTOM_COMMANDS = 50
const MAX_TOTAL_COMMANDS = BASE_ROLE_COMMANDS.length + MAX_CUSTOM_COMMANDS
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]{1,23}$/
const DISCORD_PERMISSION_ADMINISTRATOR = 1n << 3n
const DISCORD_PERMISSION_MANAGE_ROLES = 1n << 28n

function normalizeId(value) {
    const text = String(value || "").trim()
    return /^\d{17,20}$/.test(text) ? text : null
}

function normalizeCommandName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^[!/.]+/, "")
}

function normalizeCommandEntry(value = {}, base = false) {
    const name = normalizeCommandName(value.name)
    return {
        name,
        roleId: normalizeId(value.roleId),
        enabled: value.enabled !== false,
        base: Boolean(base),
    }
}

function normalizeConfig(raw = {}) {
    const incomingBase = Array.isArray(raw.baseCommands) ? raw.baseCommands : []
    const baseByName = new Map(incomingBase.map(entry => [normalizeCommandName(entry?.name), entry]))
    const baseCommands = BASE_ROLE_COMMANDS.map(definition =>
        normalizeCommandEntry({ name: definition.name, ...(baseByName.get(definition.name) || {}) }, true)
    )

    const baseNames = new Set(BASE_ROLE_COMMANDS.map(item => item.name))
    const seen = new Set()
    const customCommands = []
    for (const rawEntry of Array.isArray(raw.customCommands) ? raw.customCommands : []) {
        const entry = normalizeCommandEntry(rawEntry, false)
        if (!entry.name || baseNames.has(entry.name) || seen.has(entry.name)) continue
        seen.add(entry.name)
        customCommands.push(entry)
        if (customCommands.length >= MAX_CUSTOM_COMMANDS) break
    }

    return {
        guildId: normalizeId(raw.guildId),
        enabled: raw.enabled === true,
        requiredRoleId: normalizeId(raw.requiredRoleId),
        baseCommands,
        customCommands,
    }
}

function getAllCommandEntries(config) {
    const normalized = normalizeConfig(config)
    return [...normalized.baseCommands, ...normalized.customCommands]
}

function findCommand(config, name) {
    const normalizedName = normalizeCommandName(name)
    if (!normalizedName) return null
    return getAllCommandEntries(config).find(entry => entry.name === normalizedName) || null
}

function validateCommandName(name, options = {}) {
    const normalized = normalizeCommandName(name)
    const reserved = new Set(
        [...(options.reservedNames || [])]
            .map(normalizeCommandName)
            .filter(Boolean)
    )
    const existing = new Set(
        [...(options.existingNames || [])]
            .map(normalizeCommandName)
            .filter(Boolean)
    )
    const originalName = normalizeCommandName(options.originalName)

    if (!COMMAND_NAME_PATTERN.test(normalized)) {
        return { ok: false, name: normalized, error: "Use 2-24 lowercase letters, numbers, or hyphens, starting with a letter." }
    }
    if (reserved.has(normalized)) {
        return { ok: false, name: normalized, error: "That name conflicts with an existing CURSED command." }
    }
    if (existing.has(normalized) && normalized !== originalName) {
        return { ok: false, name: normalized, error: "That custom role command already exists." }
    }
    return { ok: true, name: normalized, error: null }
}

function permissionBits(value) {
    try {
        return BigInt(String(value || "0"))
    } catch {
        return 0n
    }
}

function hasDangerousRolePermissions(value) {
    const permissions = permissionBits(value)
    return (permissions & DISCORD_PERMISSION_ADMINISTRATOR) !== 0n
        || (permissions & DISCORD_PERMISSION_MANAGE_ROLES) !== 0n
}

function validateRoleSelection(roleId, roleCatalog, mode = "assignable") {
    if (roleId === null || roleId === undefined || roleId === "") {
        return { ok: true, role: null, error: null }
    }
    const normalizedId = normalizeId(roleId)
    if (!normalizedId) return { ok: false, role: null, error: "Choose a valid server role." }
    const role = (Array.isArray(roleCatalog) ? roleCatalog : []).find(item => String(item.id) === normalizedId)
    if (!role) return { ok: false, role: null, error: "That role is not available in this server." }

    if (mode === "required") {
        if (role.requiredEligible === false || role.managed || role.everyone) {
            return { ok: false, role, error: "That role cannot be used as the required role." }
        }
        return { ok: true, role, error: null }
    }

    if (!role.assignable) {
        return { ok: false, role, error: role.unavailableReason || "CURSED cannot assign that role." }
    }
    if (role.dangerous || hasDangerousRolePermissions(role.permissions)) {
        return { ok: false, role, error: "Roles with Administrator or Manage Roles cannot be assigned by custom role commands." }
    }
    return { ok: true, role, error: null }
}

function canUseRoleCommand({ isOwner, isAdministrator, hasRequiredRole, requiredRoleId }) {
    if (isOwner || isAdministrator) return true
    if (!requiredRoleId) return false
    return Boolean(hasRequiredRole)
}

function canManageTarget({ isOwner, actorHighestPosition, targetHighestPosition, rolePosition }) {
    // Discord role hierarchy still applies to administrators. Only the server owner
    // may use CURSED to act above their own displayed role position.
    if (isOwner) return { ok: true, error: null }
    const actor = Number(actorHighestPosition || 0)
    const target = Number(targetHighestPosition || 0)
    const role = Number(rolePosition || 0)
    if (target >= actor) {
        return { ok: false, error: "You cannot change roles for a member at or above your highest role." }
    }
    if (role >= actor) {
        return { ok: false, error: "You cannot assign or remove a role at or above your highest role." }
    }
    return { ok: true, error: null }
}

function resolveToggleAction(memberHasRole) {
    return memberHasRole ? "remove" : "add"
}

function validateConfigPayload(payload, options = {}) {
    const errors = {}
    const normalized = normalizeConfig(payload)
    const roleCatalog = options.roleCatalog || []
    const reservedNames = options.reservedNames || []

    const requiredCheck = validateRoleSelection(normalized.requiredRoleId, roleCatalog, "required")
    if (!requiredCheck.ok) errors.requiredRoleId = requiredCheck.error
    if (normalized.enabled && !normalized.requiredRoleId) {
        errors.requiredRoleId = "Choose a required role before enabling custom role commands."
    }

    const entries = getAllCommandEntries(normalized)
    const names = entries.map(entry => entry.name)
    if (names.length > MAX_TOTAL_COMMANDS) errors.customCommands = `Use no more than ${MAX_CUSTOM_COMMANDS} custom commands.`

    for (const entry of entries) {
        const nameCheck = validateCommandName(entry.name, {
            reservedNames,
            existingNames: names.filter(name => name !== entry.name),
            originalName: entry.name,
        })
        if (!nameCheck.ok) errors[`commands.${entry.name || "unknown"}.name`] = nameCheck.error
        const roleCheck = validateRoleSelection(entry.roleId, roleCatalog, "assignable")
        if (!roleCheck.ok) errors[`commands.${entry.name || "unknown"}.roleId`] = roleCheck.error
    }

    return { ok: Object.keys(errors).length === 0, config: normalized, errors }
}

module.exports = {
    BASE_ROLE_COMMANDS,
    MAX_CUSTOM_COMMANDS,
    MAX_TOTAL_COMMANDS,
    COMMAND_NAME_PATTERN,
    normalizeId,
    normalizeCommandName,
    normalizeCommandEntry,
    normalizeConfig,
    getAllCommandEntries,
    findCommand,
    validateCommandName,
    hasDangerousRolePermissions,
    validateRoleSelection,
    canUseRoleCommand,
    canManageTarget,
    resolveToggleAction,
    validateConfigPayload,
}
