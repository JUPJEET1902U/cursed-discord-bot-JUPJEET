const { PermissionFlagsBits } = require("discord.js")
const moderation = require("./moderation")
const { disableAutorole, getAutorole } = require("../utils/autorole")
const {
    getAdvancedAutorole,
    addAutorole,
    removeAutorole,
    clearAutoroles,
    setAutoroleAdvancedEnabled,
    validateAssignableRole,
} = require("../utils/autoroleAdvanced")
const {
    admin: adminEmbed,
    statusLine,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const logger = require("../utils/logger")

const log = logger.child("AutoroleControl")

function getAutoroleBuilder() {
    return moderation.commands.find(command => command.name === "autorole") || null
}

function patchSlashBuilder() {
    const builder = getAutoroleBuilder()
    if (!builder || builder.__advancedAutoroleOptions) return

    builder.addSubcommandGroup(group => group
        .setName("humans")
        .setDescription("Manage roles automatically assigned to human members")
        .addSubcommand(sub => sub.setName("add").setDescription("Add a human autorole")
            .addRoleOption(option => option.setName("role").setDescription("Role to assign").setRequired(true)))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove a human autorole")
            .addRoleOption(option => option.setName("role").setDescription("Role to remove").setRequired(true)))
        .addSubcommand(sub => sub.setName("clear").setDescription("Clear human autoroles")))

    builder.addSubcommandGroup(group => group
        .setName("bots")
        .setDescription("Manage roles automatically assigned to bot accounts")
        .addSubcommand(sub => sub.setName("add").setDescription("Add a bot autorole")
            .addRoleOption(option => option.setName("role").setDescription("Role to assign").setRequired(true)))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove a bot autorole")
            .addRoleOption(option => option.setName("role").setDescription("Role to remove").setRequired(true)))
        .addSubcommand(sub => sub.setName("clear").setDescription("Clear bot autoroles")))

    Object.defineProperty(builder, "__advancedAutoroleOptions", { value: true, enumerable: false })
}

function canManage(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    )
}

function listEmbed(guildId, guild) {
    const legacy = getAutorole(guildId)
    const config = getAdvancedAutorole(guildId)
    const render = ids => ids.length
        ? ids.map(id => guild.roles.cache.has(id) ? `<@&${id}>` : `Deleted role (${id})`).join("\n")
        : "None"

    return adminEmbed("Autorole", "Separate role sets for people and bots. Existing single-role configuration remains compatible.", {
        fields: [
            { name: "State", value: config.enabled ? "Enabled" : "Disabled", inline: true },
            { name: "Legacy role", value: legacy.autoroleId ? `<@&${legacy.autoroleId}>` : "None", inline: true },
            { name: "Human roles", value: render(config.humanRoleIds), inline: false },
            { name: "Bot roles", value: render(config.botRoleIds), inline: false },
        ],
        footer: "CURSED • Autorole",
    })
}

async function reply(interaction, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload
    body.ephemeral = true
    body.allowedMentions = SAFE_MENTIONS
    if (interaction.deferred) {
        const { ephemeral: _ephemeral, ...edit } = body
        return interaction.editReply(edit)
    }
    if (interaction.replied) return interaction.followUp(body)
    return interaction.reply(body)
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== "autorole") return false
    const group = interaction.options.getSubcommandGroup(false)
    const sub = interaction.options.getSubcommand(false)

    // Keep the legacy /autorole set path owned by the original moderation
    // command. Reboot adds deeper role sets around it without removing it.
    if (!group && !["view", "disable"].includes(sub)) return false

    try {
        if (!interaction.inGuild()) throw new Error("Use this command inside a server")
        if (!canManage(interaction)) throw new Error("Manage Roles is required")

        if (!group && sub === "view") {
            await reply(interaction, { embeds: [listEmbed(interaction.guildId, interaction.guild)] })
            return true
        }

        if (!group && sub === "disable") {
            disableAutorole(interaction.guildId)
            await setAutoroleAdvancedEnabled(interaction.guildId, false)
            await reply(interaction, statusLine("success", "Autorole disabled. Configured human and bot role sets were preserved."))
            return true
        }

        const type = group === "bots" ? "bot" : "human"
        if (!["humans", "bots"].includes(group)) return false

        if (sub === "clear") {
            await clearAutoroles(interaction.guildId, type)
            await reply(interaction, statusLine("success", `${type === "bot" ? "Bot" : "Human"} autoroles cleared.`))
            return true
        }

        const role = interaction.options.getRole("role", true)
        const validation = validateAssignableRole(interaction.guild, role)
        if (!validation.ok) throw new Error(validation.error)

        if (sub === "add") {
            await addAutorole(interaction.guildId, type, role.id)
            await reply(interaction, statusLine("success", `${role.name} added to ${type} autoroles.`))
            return true
        }

        if (sub === "remove") {
            await removeAutorole(interaction.guildId, type, role.id)
            await reply(interaction, statusLine("success", `${role.name} removed from ${type} autoroles.`))
            return true
        }
        return false
    } catch (error) {
        log.warn(`Autorole control failed: ${error.message}`)
        await reply(interaction, statusLine("error", error.message)).catch(() => {})
        return true
    }
}

function parseBody(content) {
    const match = String(content || "").trim().match(/^!autoroles?(?:\s+|$)/i)
    if (!match) return null
    return String(content).trim().slice(match[0].length).trim()
}

async function prefixReply(message, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload
    return message.reply({ ...body, allowedMentions: SAFE_MENTIONS }).catch(() => message.channel.send({ ...body, allowedMentions: SAFE_MENTIONS }))
}

async function handle(message) {
    if (!message.guild) return false
    const body = parseBody(message.content)
    if (body === null) return false

    try {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            throw new Error("Manage Roles is required")
        }
        const prefix = getGuildPrefix(message.guild.id)
        const args = body.split(/\s+/).filter(Boolean)
        const type = String(args.shift() || "list").toLowerCase()

        if (type === "list") {
            await prefixReply(message, { embeds: [listEmbed(message.guild.id, message.guild)] })
            return true
        }
        if (type === "disable") {
            disableAutorole(message.guild.id)
            await setAutoroleAdvancedEnabled(message.guild.id, false)
            await prefixReply(message, statusLine("success", "Autorole disabled. Role sets preserved."))
            return true
        }
        if (type === "enable") {
            await setAutoroleAdvancedEnabled(message.guild.id, true)
            await prefixReply(message, statusLine("success", "Autorole enabled."))
            return true
        }
        if (!["human", "humans", "bot", "bots"].includes(type)) throw new Error(`Usage: ${prefix}autoroles human|bot add|remove|clear @role`)
        const normalizedType = type.startsWith("bot") ? "bot" : "human"
        const action = String(args.shift() || "list").toLowerCase()
        if (action === "clear") {
            await clearAutoroles(message.guild.id, normalizedType)
            await prefixReply(message, statusLine("success", `${normalizedType} autoroles cleared.`))
            return true
        }
        if (!["add", "remove"].includes(action)) throw new Error(`Usage: ${prefix}autoroles ${normalizedType} add|remove|clear @role`)
        const role = message.mentions.roles.first()
        const validation = validateAssignableRole(message.guild, role)
        if (!validation.ok) throw new Error(validation.error)
        if (action === "add") await addAutorole(message.guild.id, normalizedType, role.id)
        else await removeAutorole(message.guild.id, normalizedType, role.id)
        await prefixReply(message, statusLine("success", `${role.name} ${action === "add" ? "added to" : "removed from"} ${normalizedType} autoroles.`))
        return true
    } catch (error) {
        await prefixReply(message, statusLine("error", error.message))
        return true
    }
}

patchSlashBuilder()

if (!moderation.__autoroleControlPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedAutoroleControlInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__autoroleControlPatched", { value: true, enumerable: false })
}

module.exports = {
    handle,
    handleInteraction,
    patchSlashBuilder,
    listEmbed,
}
