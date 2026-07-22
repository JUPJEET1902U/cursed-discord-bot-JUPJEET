const { COMMAND_REGISTRY } = require("../utils/helpGenerator")

const IMAGINE_HELP = Object.freeze({
    name: "!imagine",
    usage: "!imagine <prompt> | !imagine @user <scene> | !imagine retry | !imagine variations",
    description: "Generate an enhanced AI image, reuse your previous prompt, create fresh variations, or use a mentioned member's avatar as a visual reference.",
    examples: [
        "!imagine a cursed cat riding a skateboard through neon rain",
        "!imagine @friend as a cyberpunk warrior",
        "!imagine retry",
        "!imagine variations",
    ],
    cooldown: "30s",
    aliases: [],
})

function applyImageGenerationCatalog() {
    const commands = COMMAND_REGISTRY.fun?.commands
    if (!Array.isArray(commands)) return false

    const index = commands.findIndex(command => command.name === "!imagine")
    if (index < 0) return false

    commands[index] = { ...IMAGINE_HELP }
    return true
}

applyImageGenerationCatalog()

module.exports = { IMAGINE_HELP, applyImageGenerationCatalog }
