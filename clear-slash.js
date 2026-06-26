const { REST, Routes } = require("discord.js");
require("dotenv").config();

const rest = new REST({ version: "10" })
    .setToken(process.env.BOT_TOKEN);

async function clear() {
    try {
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: [] }
        );

        console.log("Cleared all global slash commands");
    } catch (err) {
        console.error(err);
    }
}

clear();
