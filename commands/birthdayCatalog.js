const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

COMMAND_REGISTRY.birthdays = {
    name: "🎂 Birthdays",
    emoji: "🎂",
    color: 0xEC4899,
    description: "Server-specific birthday records, public lists, DMs, and scheduled announcements.",
    commands: [
        {
            name: "!birthday",
            usage: "!birthday help",
            description: "Open the birthday command guide.",
            examples: ["!birthday", "!birthday help"],
            cooldown: "3s",
            aliases: ["!birthdays", "!bday"],
        },
        {
            name: "!birthday set",
            usage: "!birthday set [@user] <DD-MM[-YYYY]>",
            description: "Add or update your birthday or another current server member's birthday.",
            examples: ["!birthday set 24-07", "!birthday set @friend 24-07-2006"],
            cooldown: "3s",
            aliases: ["!birthday add", "!birthday update"],
        },
        {
            name: "!birthday list",
            usage: "!birthday list [month]",
            description: "View the public birthday list for this server, optionally filtered by month.",
            examples: ["!birthday list", "!birthday list July"],
            cooldown: "3s",
            aliases: [],
        },
        {
            name: "!birthday today",
            usage: "!birthday today",
            description: "Show birthdays being celebrated today in the server timezone.",
            examples: ["!birthday today"],
            cooldown: "3s",
            aliases: [],
        },
        {
            name: "!birthday upcoming",
            usage: "!birthday upcoming",
            description: "Show the next recorded birthdays in this server.",
            examples: ["!birthday upcoming"],
            cooldown: "3s",
            aliases: [],
        },
        {
            name: "!birthday channel",
            usage: "!birthday channel <#channel|off>",
            description: "Choose the channel used only for this server's birthday announcements.",
            examples: ["!birthday channel #birthdays", "!birthday channel off"],
            cooldown: "none",
            permissions: ["Manage Server"],
            aliases: [],
        },
        {
            name: "!birthday timezone",
            usage: "!birthday timezone <IANA timezone>",
            description: "Set the server timezone used by the birthday scheduler.",
            examples: ["!birthday timezone Asia/Kolkata"],
            cooldown: "none",
            permissions: ["Manage Server"],
            aliases: [],
        },
    ],
}

module.exports = { BIRTHDAY_COMMANDS: COMMAND_REGISTRY.birthdays.commands }
