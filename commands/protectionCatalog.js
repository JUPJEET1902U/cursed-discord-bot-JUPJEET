const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const PROTECTION_COMMANDS = [
    {
        name: "!automod",
        usage: "c!automod status|enable|disable|punishment|reset",
        description: "Configure spam, link, invite, and Message Shield protection from Discord.",
        examples: ["c!automod status", "c!automod enable links", "c!automod punishment timeout 10"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "/automod",
        usage: "/automod status|rule|punishment|ignore|reset",
        description: "Full AutoMod configuration including scoped user, role, and channel exemptions.",
        examples: ["/automod rule rule:Spam enabled:True", "/automod ignore add role:@Staff"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "!antinuke",
        usage: "c!antinuke status|enable|disable|action|limit|reset",
        description: "Configure destructive-action protection, thresholds, and response behavior.",
        examples: ["c!antinuke status", "c!antinuke action neutralize", "c!antinuke limit channelDeletes 1"],
        cooldown: "none",
        permissions: ["Manage Server; owner required for disable/reset"],
        aliases: [],
    },
    {
        name: "/antinuke",
        usage: "/antinuke status|enable|disable|action|limit|trust|reset",
        description: "Full Anti-Nuke configuration with per-event limits and scoped trust.",
        examples: ["/antinuke action action:Neutralize", "/antinuke trust add user:@Staff scope:manageChannels"],
        cooldown: "none",
        permissions: ["Manage Server; owner required for disable/reset"],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "/security",
        usage: "/security backup|approval|incident|audit|report",
        description: "Recovery snapshots, temporary bot approvals, incident mode, health audits, and incident reports.",
        examples: ["/security audit", "/security backup create", "/security incident status"],
        cooldown: "none",
        permissions: ["Configured moderator + Manage Server"],
        aliases: [],
        slashOnly: true,
    },
]

function applyProtectionCatalog() {
    COMMAND_REGISTRY.protection = {
        name: "Server Protection",
        emoji: "",
        color: 0xED4245,
        adminOnly: true,
        description: "AutoMod, Anti-Nuke, recovery, trust, and incident controls.",
        commands: PROTECTION_COMMANDS.map(command => ({ ...command })),
    }
    return true
}

applyProtectionCatalog()

module.exports = { PROTECTION_COMMANDS, applyProtectionCatalog }
