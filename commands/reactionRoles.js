const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js")
const moderation = require("./moderation")
const {
    MAX_PANELS_PER_GUILD,
    validateRole,
    panelEmbed,
    panelComponents,
    createPanel,
    attachMessage,
    listPanels,
    getPanel,
    addPanelRole,
    removePanelRole,
    deletePanel,
    syncPanelMessage,
    removePanelMessage,
} = require("../utils/reactionRoleService")
const { admin: adminEmbed, statusLine, SAFE_MENTIONS } = require("../utils/responseBuilder")
const logger = require("../utils/logger")

const log = logger.child("ReactionRoles")

const reactionRoleCommand = new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription("Create and manage self-assignable role panels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub => sub.setName("create").setDescription("Create a reaction-role panel")
        .addChannelOption(option => option.setName("channel").setDescription("Panel channel").setRequired(true))
        .addStringOption(option => option.setName("title").setDescription("Panel title").setRequired(true).setMaxLength(256))
        .addStringOption(option => option.setName("description").setDescription("Panel description").setMaxLength(4000)))
    .addSubcommand(sub => sub.setName("add").setDescription("Add a role button to a panel")
        .addStringOption(option => option.setName("panel").setDescription("Panel ID").setRequired(true).setMaxLength(32))
        .addRoleOption(option => option.setName("role").setDescription("Role to self-assign").setRequired(true))
        .addStringOption(option => option.setName("label").setDescription("Button label").setMaxLength(80))
        .addStringOption(option => option.setName("emoji").setDescription("Optional emoji").setMaxLength(100)))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove a role from a panel")
        .addStringOption(option => option.setName("panel").setDescription("Panel ID").setRequired(true).setMaxLength(32))
        .addRoleOption(option => option.setName("role").setDescription("Role to remove").setRequired(true)))
    .addSubcommand(sub => sub.setName("list").setDescription("List reaction-role panels"))
    .addSubcommand(sub => sub.setName("delete").setDescription("Delete a reaction-role panel")
        .addStringOption(option => option.setName("panel").setDescription("Panel ID").setRequired(true).setMaxLength(32)))

function canManage(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    )
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

function listEmbed(panels) {
    return adminEmbed("Reaction roles", panels.length
        ? panels.map(panel => `**${panel.panelId}** · <#${panel.channelId}>\n${panel.title} · ${panel.options?.length || 0} roles`).join("\n\n")
        : "No reaction-role panels configured.", {
        fields: [{ name: "Capacity", value: `${panels.length}/${MAX_PANELS_PER_GUILD}`, inline: true }],
        footer: "CURSED • Reaction Roles",
    })
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== "reactionrole") return false
    try {
        if (!interaction.inGuild()) throw new Error("Use this command inside a server")
        if (!canManage(interaction)) throw new Error("Manage Roles is required")
        const sub = interaction.options.getSubcommand()

        if (sub === "create") {
            const channel = interaction.options.getChannel("channel", true)
            if (!channel.isTextBased?.()) throw new Error("Choose a text channel")
            const botPermissions = channel.permissionsFor?.(interaction.guild.members.me)
            if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
                throw new Error("CURSED needs Send Messages and Embed Links in that channel")
            }
            await interaction.deferReply({ ephemeral: true })
            const created = await createPanel({
                guildId: interaction.guildId,
                channelId: channel.id,
                title: interaction.options.getString("title", true),
                description: interaction.options.getString("description") || "Select a role below.",
                createdBy: interaction.user.id,
            })
            const sent = await channel.send({ embeds: [panelEmbed(created)], components: panelComponents(created), allowedMentions: SAFE_MENTIONS })
            const saved = await attachMessage(created.panelId, sent.id)
            await reply(interaction, statusLine("success", `Reaction-role panel **${saved.panelId}** created in ${channel}.`))
            return true
        }

        if (sub === "list") {
            const panels = await listPanels(interaction.guildId)
            await reply(interaction, { embeds: [listEmbed(panels)] })
            return true
        }

        const panelId = interaction.options.getString("panel", true)
        const panel = await getPanel(interaction.guildId, panelId)
        if (!panel) throw new Error("Reaction-role panel not found")

        if (sub === "delete") {
            const deleted = await deletePanel(interaction.guildId, panelId)
            if (deleted) await removePanelMessage(interaction.client, deleted)
            await reply(interaction, statusLine("success", `Reaction-role panel **${panelId}** deleted.`))
            return true
        }

        const role = interaction.options.getRole("role", true)
        if (sub === "add") {
            const check = validateRole(interaction.guild, role)
            if (!check.ok) throw new Error(check.error)
            const updated = await addPanelRole(interaction.guildId, panelId, {
                roleId: role.id,
                label: interaction.options.getString("label") || role.name,
                emoji: interaction.options.getString("emoji"),
            })
            await syncPanelMessage(interaction.client, updated)
            await reply(interaction, statusLine("success", `${role.name} added to panel **${panelId}**.`))
            return true
        }

        if (sub === "remove") {
            const updated = await removePanelRole(interaction.guildId, panelId, role.id)
            await syncPanelMessage(interaction.client, updated)
            await reply(interaction, statusLine("success", `${role.name} removed from panel **${panelId}**.`))
            return true
        }
        return false
    } catch (error) {
        log.warn(`Reaction-role command failed: ${error.message}`)
        await reply(interaction, statusLine("error", error.message)).catch(() => {})
        return true
    }
}

if (!moderation.commands.some(existing => existing.name === reactionRoleCommand.name)) moderation.commands.push(reactionRoleCommand)

if (!moderation.__reactionRolesPatched) {
    const originalHandleInteraction = moderation.handleInteraction
    moderation.handleInteraction = async function patchedReactionRoleInteraction(interaction) {
        const handled = await handleInteraction(interaction)
        if (handled) return true
        return originalHandleInteraction(interaction)
    }
    Object.defineProperty(moderation, "__reactionRolesPatched", { value: true, enumerable: false })
}

module.exports = {
    handle: async () => false,
    handleInteraction,
    reactionRoleCommand,
    listEmbed,
}
