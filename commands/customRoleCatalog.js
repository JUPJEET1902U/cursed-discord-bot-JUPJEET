const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

function applyCustomRoleCatalog() {
    COMMAND_REGISTRY.customRoles = {
        name: "🎭 Custom Roles",
        emoji: "🎭",
        color: 0xC026D3,
        commands: [
            {
                name: "!rolecommands",
                usage: "!rolecommands",
                description: "List the server's configured custom role commands and required role.",
                examples: ["!rolecommands"],
                cooldown: "none",
                aliases: [],
            },
            {
                name: "!reqrole",
                usage: "!reqrole set @role | clear | view",
                description: "Configure the role required to use custom role commands.",
                examples: ["!reqrole set @Staff", "!reqrole view"],
                cooldown: "none",
                permissions: ["Server Owner, Administrator, or Manage Server"],
                aliases: [],
            },
            {
                name: "!rolecmd",
                usage: "!rolecmd add <name> @role | remove <name> | list | enable | disable",
                description: "Create, remove, list, enable, or disable custom role command mappings.",
                examples: ["!rolecmd add staff @Staff", "!rolecmd enable"],
                cooldown: "none",
                permissions: ["Server Owner, Administrator, or Manage Server"],
                aliases: [],
            },
        ],
    }
    return true
}

applyCustomRoleCatalog()

module.exports = { applyCustomRoleCatalog }
