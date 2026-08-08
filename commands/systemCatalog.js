const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const SYSTEM_COMMANDS = [
    {
        name: "!status",
        usage: "c!status",
        description: "Show live CURSED gateway status, uptime, and the configured prefix.",
        examples: ["c!status", "c!cursed status"],
        cooldown: "none",
        permissions: [],
        aliases: ["!cursed"],
    },
    {
        name: "!about",
        usage: "c!about",
        description: "Show the small public product hierarchy behind CURSED.",
        examples: ["c!about", "c!cursed about"],
        cooldown: "none",
        permissions: [],
        aliases: [],
    },
    {
        name: "!doctor",
        usage: "c!doctor",
        description: "Run a read-only health check for persistence, AI, systems, and bot permissions.",
        examples: ["c!doctor"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "!permissions",
        usage: "c!permissions",
        description: "Show exactly which CURSED permissions are available or missing without requiring Administrator.",
        examples: ["c!permissions"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "/cursed",
        usage: "/cursed status|about",
        description: "Slash-command access to CURSED status and product information.",
        examples: ["/cursed status", "/cursed about"],
        cooldown: "none",
        permissions: [],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "/doctor",
        usage: "/doctor health|permissions",
        description: "Manage Server diagnostics for configuration and bot permissions.",
        examples: ["/doctor health", "/doctor permissions"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
        slashOnly: true,
    },
]

function applySystemCatalog() {
    const current = COMMAND_REGISTRY.server || {
        name: "Server",
        emoji: "",
        color: 0x5865F2,
        commands: [],
    }
    const names = new Set(SYSTEM_COMMANDS.map(command => command.name))
    COMMAND_REGISTRY.server = {
        ...current,
        name: current.name || "Server",
        description: "Server information, bot status, diagnostics, and activity-tracking status.",
        commands: [
            ...SYSTEM_COMMANDS.map(command => ({ ...command })),
            ...(current.commands || []).filter(command => !names.has(command.name)),
        ],
    }
    return true
}

applySystemCatalog()

module.exports = {
    SYSTEM_COMMANDS,
    applySystemCatalog,
}
