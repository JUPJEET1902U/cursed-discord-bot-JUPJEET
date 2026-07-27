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
    assert.equal(findCommand(normalized, '!staff').roleId, '32345678901234567')
    assert.equal(findCommand(normalized, 'designer').roleId, '42345678901234567')
    assert.equal(normalized.customCommands.length, 1)

    assert.equal(validateCommandName('help', { reservedNames: ['help'] }).ok, false)
    assert.equal(validateCommandName('valid-role', {}).ok, true)

    const roles = [
        { id: '22345678901234567', requiredEligible: true, assignable: false, dangerous: false },
        { id: '32345678901234567', requiredEligible: true, assignable: true, dangerous: false },
        { id: '42345678901234567', requiredEligible: true, assignable: false, dangerous: true, unavailableReason: 'Blocked' },
    ]
    assert.equal(validateRoleSelection('22345678901234567', roles, 'required').ok, true)
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
    }, { roleCatalog: roles, reservedNames: ['help'] })
    assert.equal(missingRequired.ok, false)

    assert.equal(canUseRoleCommand({ isOwner: true }), true)
    assert.equal(canUseRoleCommand({ hasRequiredRole: true, requiredRoleId: 'x' }), true)
    assert.equal(canUseRoleCommand({ hasRequiredRole: false, requiredRoleId: 'x' }), false)

    assert.equal(canManageTarget({ isOwner: false, actorHighestPosition: 10, targetHighestPosition: 9, rolePosition: 8 }).ok, true)
    assert.equal(canManageTarget({ isOwner: false, actorHighestPosition: 10, targetHighestPosition: 10, rolePosition: 8 }).ok, false)
    assert.equal(canManageTarget({ isOwner: true, actorHighestPosition: 1, targetHighestPosition: 100, rolePosition: 100 }).ok, true)

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
    assert.match(commandSource, /!reqrole set @role/)

    const serviceSource = fs.readFileSync(path.join(root, 'utils/customRoles.js'), 'utf8')
    assert.match(serviceSource, /PermissionFlagsBits\.ManageRoles/)
    assert.match(serviceSource, /Administrator and Manage Roles roles are blocked/)

    const dashboardApiSource = fs.readFileSync(path.join(root, 'api/dashboardCustomRoles.js'), 'utf8')
    assert.match(dashboardApiSource, /custom-roles/)
    assert.match(dashboardApiSource, /DASHBOARD_API_SECRET/)
    assert.match(dashboardApiSource, /saveValidatedConfig/)

    const webhookSource = fs.readFileSync(path.join(root, 'webhook.js'), 'utf8')
    assert.match(webhookSource, /createDashboardCustomRolesRouter/)

    console.log('Custom role command bot contracts passed')
}

run()
