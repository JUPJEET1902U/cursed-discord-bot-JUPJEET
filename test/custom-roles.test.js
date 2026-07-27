const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
    BASE_ROLE_COMMANDS,
    MAX_CUSTOM_COMMANDS,
    normalizeConfig,
    findCommand,
    validateCommandName,
    validateRoleSelection,
    validateConfigPayload,
    canUseRoleCommand,
    canManageTarget,
    resolveToggleAction,
} = require('../utils/customRolePolicy')

function run() {
    const empty = normalizeConfig({ guildId: '12345678901234567' })
    assert.equal(empty.enabled, false)
    assert.equal(empty.baseCommands.length, BASE_ROLE_COMMANDS.length)
    assert.equal(empty.customCommands.length, 0)

    const normalized = normalizeConfig({
        guildId: '12345678901234567',
        enabled: true,
        requiredRoleId: '22345678901234567',
        baseCommands: [{ name: 'staff', roleId: '32345678901234567' }],
        customCommands: [
            { name: '!Designer', roleId: '42345678901234567' },
            { name: 'designer', roleId: '52345678901234567' },
        ],
    })
    assert.equal(normalized.enabled, true)
    assert.equal(findCommand(normalized, '!staff').roleId, '32345678901234567')
    assert.equal(findCommand(normalized, 'designer').roleId, '42345678901234567')
    assert.equal(normalized.customCommands.length, 1)

    assert.equal(validateCommandName('staff', { reservedNames: ['help'] }).ok, true)
    assert.equal(validateCommandName('help', { reservedNames: ['help'] }).ok, false)
    assert.equal(validateCommandName('A', {}).ok, false)
    assert.equal(validateCommandName('valid-role', {}).ok, true)

    const roles = [
        { id: '22345678901234567', requiredEligible: true, assignable: false, dangerous: false },
        { id: '32345678901234567', requiredEligible: true, assignable: true, dangerous: false },
        { id: '42345678901234567', requiredEligible: true, assignable: false, dangerous: true, unavailableReason: 'Blocked' },
    ]
    assert.equal(validateRoleSelection('22345678901234567', roles, 'required').ok, true)
    assert.equal(validateRoleSelection('22345678901234567', roles, 'assignable').ok, false)
    assert.equal(validateRoleSelection('32345678901234567', roles, 'assignable').ok, true)
    assert.equal(validateRoleSelection('42345678901234567', roles, 'assignable').ok, false)

    const validPayload = validateConfigPayload({
        guildId: '12345678901234567',
        enabled: true,
        requiredRoleId: '22345678901234567',
        baseCommands: [{ name: 'staff', roleId: '32345678901234567' }],
        customCommands: [],
    }, { roleCatalog: roles, reservedNames: ['help'] })
    assert.equal(validPayload.ok, true)

    const missingRequired = validateConfigPayload({
        guildId: '12345678901234567',
        enabled: true,
        requiredRoleId: null,
        customCommands: [],
    }, { roleCatalog: roles, reservedNames: ['help'] })
    assert.equal(missingRequired.ok, false)
    assert.match(missingRequired.errors.requiredRoleId, /required role/i)

    const collisionPayload = validateConfigPayload({
        guildId: '12345678901234567',
        enabled: true,
        requiredRoleId: '22345678901234567',
        customCommands: [{ name: 'help', roleId: '32345678901234567' }],
    }, { roleCatalog: roles, reservedNames: ['help'] })
    assert.equal(collisionPayload.ok, false)

    assert.equal(canUseRoleCommand({ isOwner: true, isAdministrator: false, hasRequiredRole: false }), true)
    assert.equal(canUseRoleCommand({ isOwner: false, isAdministrator: false, hasRequiredRole: true, requiredRoleId: 'x' }), true)
    assert.equal(canUseRoleCommand({ isOwner: false, isAdministrator: false, hasRequiredRole: false, requiredRoleId: 'x' }), false)

    assert.equal(canManageTarget({ isOwner: false, isAdministrator: false, actorHighestPosition: 10, targetHighestPosition: 9, rolePosition: 8 }).ok, true)
    assert.equal(canManageTarget({ isOwner: false, isAdministrator: false, actorHighestPosition: 10, targetHighestPosition: 10, rolePosition: 8 }).ok, false)
    assert.equal(canManageTarget({ isOwner: false, isAdministrator: false, actorHighestPosition: 10, targetHighestPosition: 8, rolePosition: 10 }).ok, false)
    assert.equal(canManageTarget({ isOwner: false, isAdministrator: true, actorHighestPosition: 1, targetHighestPosition: 100, rolePosition: 100 }).ok, false)
    assert.equal(canManageTarget({ isOwner: true, isAdministrator: false, actorHighestPosition: 1, targetHighestPosition: 100, rolePosition: 100 }).ok, true)

    assert.equal(resolveToggleAction(false), 'add')
    assert.equal(resolveToggleAction(true), 'remove')
    assert.equal(MAX_CUSTOM_COMMANDS, 50)

    const root = path.resolve(__dirname, '..')
    const commandLoader = fs.readFileSync(path.join(root, 'handlers/commandLoader.js'), 'utf8')
    assert.match(commandLoader, /name: "custom-roles"/)
    assert.ok(commandLoader.lastIndexOf('name: "custom-roles"') > commandLoader.indexOf('name: "help"'))

    const commandSource = fs.readFileSync(path.join(root, 'commands/customRoles.js'), 'utf8')
    assert.match(commandSource, /target\.manageable/)
    assert.match(commandSource, /canManageTarget/)
    assert.match(commandSource, /allowedMentions: \{ parse: \[\]/)
    assert.match(commandSource, /!reqrole set @role/)

    const serviceSource = fs.readFileSync(path.join(root, 'utils/customRoles.js'), 'utf8')
    assert.match(serviceSource, /PermissionFlagsBits\.ManageRoles/)
    assert.match(serviceSource, /Administrator and Manage Roles roles are blocked/)

    const apiRoute = fs.readFileSync(path.join(root, 'api/routes/guilds.ts'), 'utf8')
    assert.match(apiRoute, /:id\/custom-roles/)
    assert.match(apiRoute, /requireGuildAdmin/)

    const appSource = fs.readFileSync(path.join(root, 'dashboard/src/App.tsx'), 'utf8')
    assert.match(appSource, /CustomRolesPage/)
    assert.match(appSource, /custom-roles/)

    console.log('Custom role command contracts passed')
}

run()
