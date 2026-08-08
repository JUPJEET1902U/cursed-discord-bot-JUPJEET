const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js")
const moderation = require("./moderation")
const { getCategories } = require("../utils/helpGenerator")
const { getReservedCommandNames } = require("../utils/customRoles")
const {
    MAX_CUSTOM_COMMANDS,
    normalizeName,
    listCustomCommands,
    upsertCustomCommand,
    removeCustomCommand,
    clearCustomCommands,
    getCustomCommand,
    renderCustomResponse,
} = require("../utils/customCommandStore")
const {
    admin: adminEmbed,
    statusLine,
    SAFE_MENTIONS,
} = require("../utils/responseBuilder")
const { getGuildPrefix } = require("../utils/prefix")
const logger = require("../utils/logger")

const log = logger.child("CustomCommands")
const COMMAND_NAME = "customcommand"

const customCommand = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Create and manage server custom commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("add").setDescription("Create or update a custom command")
        .addStringOption(option => option.setName("name").setDescription("Command name without a prefix").setRequired(true).setMaxLength(32))
        .addStringOption(option => option.setName("response").setDescription("Command response; supports {user}, {server}, {channel}").setRequired(true).setMaxLength(1800)))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove a custom command")
        .addStringOption(option => option.setName("name").setDescription("Command name").setRequired(true).setMaxLength(32)))
    .addSubcommand(sub => sub.setName("list").setDescription("List custom commands"))
    .addSubcommand(sub => sub.setName("clear").setDescription("Remove all custom commands"))

function builtInCommandNames() {
    const names = new Set(["customcommand", "cc"])
    for (const category of getCategories(true)) {
        for (const command of category.commands || []) {
            const normalized = normalizeName(command.name)
            if (normalized) names.add(normalized)
            for (const alias of command.aliases || []) {
                const aliasName = normalizeName(alias)
                if (aliasName) names.add(aliasName)
            }
        }
    }
    for (const name of getReservedCommandNames()) names.add(normalizeName(name))
    return names
}

function assertAvailableName(name) {
    const normalized = normalizeName(name)
    if (builtInCommandNames().has(normalized)) throw new Error("That name is reserved by a built-in CURSED command")
    return normalized
}

function listEmbed(message, commands) {
    const prefix = getGuildPrefix(message.guild.id)
    return adminEmbed("Custom commands", commands.length
        ? commands.slice(0, 50).map(command => `\`${prefix}${command.name}\`\n${String(command.response).slice(0, 100)}`).join("\n\n")
        : "No custom commands configured.", {
        fields: [{ name: "Capacity", value: `${commands.length}/${MAX_CUSTOM_COMMANDS}`, inline: true }],
        footer: "CURSED • Custom Commands",
    })
}

async function slashReply(interaction, payload) {
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
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== COMMAND_NAME) return false
    try {
        if (!interaction.inGuild()) throw new Error("Use this command inside a server")
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            throw new Error("Manage Server is required")
        }
        const sub = interaction.options.getSubcommand()
        if (sub === "add") {
            const name = assertAvailableName(interaction.options.getString("name", true))
            const saved = await upsertCustomCommand(interaction.guildId, {
                name,
                response: interaction.options.getString("response", true),
                createdBy: interaction.user.id,
            })
            await slashReply(interaction, statusLine("success", `Custom command \`${getGuildPrefix(interaction.guildId)}${saved.name}\` saved.`))
            return true
        }
        if (sub === "remove") {
            const name = interaction.options.getString("name", true)
            const removed = await removeCustomCommand(interaction.guildId, name)
            await slashReply(interaction, removed ? statusLine("success", `Custom command **${normalizeName(name)}** removed.`) : statusLine("warning", "No matching custom command found."))
            return true
        }
        if (sub === "clear") {
            const count = await clearCustomCommands(interaction.guildId)
            await slashReply(interaction, statusLine("success", `Removed ${count} custom command${count === 1 ? "" : "s"}.`))
            return true
        }
        const commands = await listCustomCommands(interaction.guildId)
        const fakeMessage = { guild: interaction.guild }
        await slashReply(interaction, { embeds: [listEmbed(fakeMessage, commands)] })
        return true
    } catch (error) {
        log.warn(`Custom command management failed: ${error.message}`)
        await slashReply(interaction, statusLine("error", error.message)).catch(() => {})
        return true
    }
}

function managementBody(content) {
    const match = String(content || "").trim().match(/^!(?:customcommand|cc)(?:\s+|$)/i)
    if (!match) return null
    return String(content).trim().slice(match[0].length).trim()
}

async function prefixReply(message, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload
    return message.reply({ ...body, allowedMentions: SAFE_MENTIONS }).catch(() => message.channel.send({ ...body, allowedMentions: SAFE_MENTIONS }))
}

async function handle(message) {
    if (!message.guild) return false
    const body = managementBody(message.content)
    if (body === null) return false
    try {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            throw new Error("Manage Server is required")
        }
        const prefix = getGuildPrefix(message.guild.id)
        const [subRaw, ...rest] = body.split(/\s+/)
        const sub = String(subRaw || "list").toLowerCase()
        if (sub === "list") {
            const commands = await listCustomCommands(message.guild.id)
            await prefixReply(message, { embeds: [listEmbed(message, commands)] })
            return true
        }
        if (sub === "clear") {
            const count = await clearCustomCommands(message.guild.id)
            await prefixReply(message, statusLine("success", `Removed ${count} custom command${count === 1 ? "" : "s"}.`))
            return true
        }
        if (sub === "remove") {
            const name = rest[0]
            if (!name) throw new Error(`Usage: ${prefix}cc remove <name>`)
            const removed = await removeCustomCommand(message.guild.id, name)
            await prefixReply(message, removed ? statusLine("success", `Custom command **${normalizeName(name)}** removed.`) : statusLine("warning", "No matching custom command found."))
            return true
        }
        if (sub === "add") {
            const source = rest.join(" ")
            const separator = source.indexOf("=>")
            if (separator < 1) throw new Error(`Usage: ${prefix}cc add <name> => <response>`)
            const name = assertAvailableName(source.slice(0, separator).trim())
            const response = source.slice(separator + 2).trim()
            const saved = await upsertCustomCommand(message.guild.id, { name, response, createdBy: message.author.id })
            await prefixReply(message, statusLine("success", `Custom command \`${prefix}${saved.name}\` saved.`))
            return true
        }
        throw new Error(`Use ${prefix}cc add|remove|list|clear`)
    } catch (error) {
        await prefixReply(message, statusLine("error", error.message))
        return true
    }
}

async function executeCustomCommand(message, commandName) {
    if (!message.guild || !commandName) return false
    const command = await getCustomCommand(message.guild.id, commandName)
    if (!command) return false
    const response = renderCustomResponse(command.response, message)
    if (!response) return false
    await prefixReply(message, response)
    return true
}

if (!moderation.commands.some(existing => existing.name === customCommand.name)) moderation.commands.push(customCommand)

if (!moderation.__customCommandsPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedCustomCommandInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__customCommandsPatched", { value: true, enumerable: false })
}

module.exports = {
    handle,
    handleInteraction,
    executeCustomCommand,
    customCommand,
    builtInCommandNames,
    assertAvailableName,
}
