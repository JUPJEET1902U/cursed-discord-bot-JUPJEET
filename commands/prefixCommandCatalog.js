const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const PREFIX_NOTE = "Supports the server's configured prefix; examples use the default `c!`."
const ADVANCED_NOTE = "Requires Advanced Moderation to be enabled."

const PREFIX_MODERATION_COMMANDS = [
    entry("!warn", "c!warn @user <reason>", "Warn a member and create a moderation case.", ["c!warn @user Repeated spam"], ["Moderator role or moderation permission"]),
    entry("!warnings", "c!warnings @user", "View a member's active warnings.", ["c!warnings @user"], ["Moderator role or moderation permission"]),
    entry("!clearwarns", "c!clearwarns @user [reason]", "Clear a member's active warnings.", ["c!clearwarns @user Appeal accepted"], ["Moderator role or moderation permission"]),
    entry("!timeout", "c!timeout @user [10m|2h|1d] [reason]", "Timeout a member.", ["c!timeout @user 30m Spamming"], ["Moderator role or Moderate Members"]),
    entry("!mute", "c!mute @user [10m|2h|1d] [reason]", "Legacy timeout alias.", ["c!mute @user 30m Spamming"], ["Moderator role or Moderate Members"]),
    entry("!untimeout", "c!untimeout @user [reason]", "Remove a member's timeout.", ["c!untimeout @user Appeal accepted"], ["Moderator role or Moderate Members"]),
    entry("!unmute", "c!unmute @user [reason]", "Legacy timeout-removal alias.", ["c!unmute @user Appeal accepted"], ["Moderator role or Moderate Members"]),
    entry("!kick", "c!kick @user <reason>", "Kick a member and create a moderation case.", ["c!kick @user Repeated violations"], ["Moderator role or Kick Members"]),
    entry("!ban", "c!ban @user <reason>", "Ban a member and create a moderation case.", ["c!ban @user Raid account"], ["Moderator role or Ban Members"]),
    entry("!unban", "c!unban <user ID> [reason]", "Unban a user using their Discord ID.", ["c!unban 123456789012345678 Appeal accepted"], ["Moderator role or Ban Members"]),
    entry("!case", "c!case view|reason|revoke|delete <number> [reason]", "View or manage one moderation case.", ["c!case view 12", "c!case reason 12 Updated evidence"], ["Moderator role or moderation permission"]),
    entry("!cases", "c!cases [@user] [action] [limit]", "List and filter recent moderation cases.", ["c!cases @user BAN 10"], ["Moderator role or moderation permission"]),
    entry("!purge", "c!purge <1-100>", "Delete recent messages in the current channel.", ["c!purge 10"], ["Manage Messages or configured moderator role"], ["Manage Messages", "Read Message History"]),
    entry("!lock", "c!lock [#channel] [reason]", `Lock a channel while preserving its previous overwrites. ${ADVANCED_NOTE}`, ["c!lock #general Raid response"], ["Moderator role or Manage Channels"], ["Manage Channels"]),
    entry("!unlock", "c!unlock [#channel] [reason]", `Restore a channel from CURSED's saved lock state. ${ADVANCED_NOTE}`, ["c!unlock #general"], ["Moderator role or Manage Channels"], ["Manage Channels"]),
    entry("!slowmode", "c!slowmode <0-21600> [#channel] [reason]", `Set or disable channel slowmode. ${ADVANCED_NOTE}`, ["c!slowmode 10 #general Raid control"], ["Moderator role or Manage Channels"], ["Manage Channels"]),
    entry("!nickname", 'c!nickname @user <nickname|reset> [reason]', `Set or clear a member's nickname. Quote multi-word nicknames. ${ADVANCED_NOTE}`, ['c!nickname @user "New Name" Staff request', "c!nickname @user reset Appeal accepted"], ["Moderator role or Manage Nicknames"], ["Manage Nicknames"]),
    entry("!tempban", "c!tempban @user <30m|2h|7d|2w> [reason]", `Temporarily ban a user with restart-safe expiry. ${ADVANCED_NOTE}`, ["c!tempban @user 7d Raid participation"], ["Moderator role or Ban Members"], ["Ban Members"]),
    entry("!softban", "c!softban @user [delete days 0-7] [reason]", `Ban and immediately unban a user to remove recent messages. ${ADVANCED_NOTE}`, ["c!softban @user 1 Advertising"], ["Moderator role or Ban Members"], ["Ban Members"]),
    entry("!note", "c!note @user <private note>", `Add a private moderator note to case history. ${ADVANCED_NOTE}`, ["c!note @user Watch for repeat advertising"], ["Moderator role or Moderate Members"]),
    entry("!history", "c!history @user [1-20]", `View a user's recent moderation history. ${ADVANCED_NOTE}`, ["c!history @user 10"], ["Moderator role or Moderate Members"]),
]

const SERVER_COMMANDS = [
    {
        name: "!server",
        usage: "c!server stats",
        description: `Show the public, read-only server activity-tracking status for every member. ${PREFIX_NOTE}`,
        examples: ["c!server stats"],
        cooldown: "none",
        permissions: [],
        aliases: ["!stats"],
    },
    {
        name: "/stats",
        usage: "/stats status",
        description: "Show the public server activity-tracking status. Members with Manage Server receive the detailed configuration view.",
        examples: ["/stats status"],
        cooldown: "none",
        permissions: [],
        aliases: [],
        slashOnly: true,
    },
]

function entry(name, usage, description, examples, permissions, botPermissions = []) {
    return {
        name,
        usage,
        description: `${description} ${PREFIX_NOTE}`,
        examples,
        cooldown: "none",
        permissions,
        botPermissions,
        aliases: [],
    }
}

function replaceByName(existing, replacements) {
    const names = new Set(replacements.map(command => command.name))
    return [
        ...replacements.map(command => ({ ...command })),
        ...(existing || []).filter(command => !names.has(command.name)),
    ]
}

function applyPrefixCommandCatalog() {
    if (!COMMAND_REGISTRY.moderation) return false
    COMMAND_REGISTRY.moderation.description = "Complete prefix and slash moderation command catalog. Advanced commands keep their existing safety settings and permission checks."
    COMMAND_REGISTRY.moderation.commands = replaceByName(
        COMMAND_REGISTRY.moderation.commands,
        PREFIX_MODERATION_COMMANDS
    )

    const currentServer = COMMAND_REGISTRY.server || {
        name: "📊 Server",
        emoji: "📊",
        color: 0x5865F2,
        commands: [],
    }
    COMMAND_REGISTRY.server = {
        ...currentServer,
        description: "Public server information and activity-tracking status.",
        commands: replaceByName(currentServer.commands, SERVER_COMMANDS),
    }
    return true
}

applyPrefixCommandCatalog()

module.exports = {
    PREFIX_MODERATION_COMMANDS,
    SERVER_COMMANDS,
    applyPrefixCommandCatalog,
}
