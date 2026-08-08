const moderation = require("./moderation")
const {
    startGiveawayScheduler,
    handleGiveawayButton,
} = require("../utils/giveawayService")

async function handle(message) {
    if (message?.client) startGiveawayScheduler(message.client)
    return false
}

if (!moderation.__powerRuntimePatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedPowerRuntimeInteraction(interaction) {
        if (interaction?.client) startGiveawayScheduler(interaction.client)
        if (await handleGiveawayButton(interaction)) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__powerRuntimePatched", { value: true, enumerable: false })
}

module.exports = { handle }
