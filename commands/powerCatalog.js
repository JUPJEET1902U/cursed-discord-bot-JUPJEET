const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const AUTOMATION_COMMANDS = [
    {
        name: "!autoresponder",
        usage: "c!autoresponder add <trigger> => <response>",
        description: "Create persistent automatic text responses. Also supports remove, list, and clear.",
        examples: ["c!autoresponder add rules => Read #rules before chatting", "c!autoresponder list"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "/autoresponder",
        usage: "/autoresponder add|remove|list|clear",
        description: "Create and manage persistent automatic text responses.",
        examples: ["/autoresponder add trigger:rules response:Read #rules"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "!autoreact",
        usage: "c!autoreact add <trigger> => <emoji ...>",
        description: "React automatically to matching messages with up to five emojis.",
        examples: ["c!autoreact add hello => 👋 ❤️", "c!autoreact list"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "/autoreact",
        usage: "/autoreact add|remove|list|clear",
        description: "Create and manage automatic emoji reaction rules.",
        examples: ["/autoreact add trigger:hello emojis:👋 ❤️"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "/embed",
        usage: "/embed send|edit",
        description: "Send or edit a CURSED-authored Discord embed with custom title, description, color, images, and footer.",
        examples: ["/embed send channel:#announcements description:Server update"],
        cooldown: "none",
        permissions: ["Manage Messages"],
        aliases: [],
        slashOnly: true,
    },
]

const COMMUNITY_TOOL_COMMANDS = [
    {
        name: "!giveaway",
        usage: "c!giveaway create #channel <30m|2h|3d> <winners> <prize>",
        description: "Create restart-safe button giveaways. Also supports list, end, and reroll.",
        examples: ["c!giveaway create #giveaways 2h 1 Discord Nitro", "c!giveaway list"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
    },
    {
        name: "/giveaway",
        usage: "/giveaway create|list|end|reroll",
        description: "Create and manage restart-safe button giveaways.",
        examples: ["/giveaway create channel:#giveaways duration:2h winners:1 prize:Discord Nitro"],
        cooldown: "none",
        permissions: ["Manage Server"],
        aliases: [],
        slashOnly: true,
    },
    {
        name: "!ticket",
        usage: "c!ticket setup|panel|claim|unclaim|close|reopen|add|remove|rename|transcript|priority|status|note|stats|delete",
        description: "Full support-ticket lifecycle with panels, staff actions, transcripts, priorities, notes, analytics, and cleanup.",
        examples: ["c!ticket setup", "c!ticket claim", "c!ticket transcript"],
        cooldown: "none",
        permissions: ["Ticket staff or Manage Server depending on action"],
        aliases: [],
    },
]

function applyPowerCatalog() {
    COMMAND_REGISTRY.automation = {
        name: "Automation",
        emoji: "",
        color: 0x5865F2,
        adminOnly: true,
        description: "Autoresponders, automatic reactions, and managed embeds.",
        commands: AUTOMATION_COMMANDS.map(command => ({ ...command })),
    }
    COMMAND_REGISTRY.communitytools = {
        name: "Community Tools",
        emoji: "",
        color: 0x57F287,
        adminOnly: false,
        description: "Tickets and managed giveaways for running an active community.",
        commands: COMMUNITY_TOOL_COMMANDS.map(command => ({ ...command })),
    }
    return true
}

applyPowerCatalog()

module.exports = {
    AUTOMATION_COMMANDS,
    COMMUNITY_TOOL_COMMANDS,
    applyPowerCatalog,
}
