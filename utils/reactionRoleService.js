const crypto = require("crypto")
const mongoose = require("mongoose")
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
} = require("discord.js")
const { SAFE_MENTIONS } = require("./responseBuilder")
const logger = require("./logger")

const log = logger.child("ReactionRoles")
const BUTTON_PREFIX = "cursed:rr:"
const MAX_PANELS_PER_GUILD = 10
const MAX_ROLES_PER_PANEL = 20

function getModel(name, schema) {
    try { return mongoose.model(name) }
    catch { return mongoose.model(name, schema) }
}

const optionSchema = new mongoose.Schema({
    roleId: { type: String, required: true },
    label: { type: String, required: true },
    emoji: { type: String, default: null },
}, { _id: false })

const panelSchema = new mongoose.Schema({
    panelId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, default: "Select a role below." },
    options: { type: [optionSchema], default: [] },
    createdBy: { type: String, required: true },
}, { collection: "reactionRolePanels", timestamps: true })
panelSchema.index({ guildId: 1, createdAt: -1 })

const ReactionRolePanel = getModel("ReactionRolePanel", panelSchema)

function isMongoConnected() {
    return mongoose.connection.readyState === 1
}

function cleanLabel(value, fallback = "Role") {
    return String(value || fallback).trim().slice(0, 80) || fallback
}

function cleanEmoji(value) {
    const text = String(value || "").trim()
    return text ? text.slice(0, 100) : null
}

function validateRole(guild, role) {
    if (!role) return { ok: false, error: "Choose a role" }
    if (role.id === guild.id) return { ok: false, error: "@everyone cannot be self-assigned" }
    if (role.managed) return { ok: false, error: "Integration-managed roles cannot be self-assigned" }
    const me = guild.members?.me
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return { ok: false, error: "CURSED needs Manage Roles" }
    if (role.position >= me.roles.highest.position) return { ok: false, error: "Move CURSED above that role in the role hierarchy" }
    if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { ok: false, error: "Administrator and Manage Roles roles cannot be self-assigned" }
    }
    return { ok: true }
}

function panelEmbed(panel) {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(String(panel.title).slice(0, 256))
        .setDescription(String(panel.description || "Select a role below.").slice(0, 4000))
        .setFooter({ text: `CURSED • Reaction Roles • ${panel.panelId}` })
}

function panelComponents(panel) {
    const buttons = (panel.options || []).slice(0, MAX_ROLES_PER_PANEL).map(option => {
        const button = new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}${panel.panelId}:${option.roleId}`)
            .setLabel(cleanLabel(option.label))
            .setStyle(ButtonStyle.Secondary)
        if (option.emoji) {
            try { button.setEmoji(option.emoji) } catch {}
        }
        return button
    })
    const rows = []
    for (let index = 0; index < buttons.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)))
    }
    return rows
}

async function createPanel({ guildId, channelId, title, description, createdBy }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const count = await ReactionRolePanel.countDocuments({ guildId: String(guildId) })
    if (count >= MAX_PANELS_PER_GUILD) throw new Error(`This server already has the maximum of ${MAX_PANELS_PER_GUILD} reaction-role panels`)
    return ReactionRolePanel.create({
        panelId: crypto.randomUUID().split("-")[0],
        guildId: String(guildId),
        channelId: String(channelId),
        title: cleanLabel(title, "Choose your roles").slice(0, 256),
        description: String(description || "Select a role below.").trim().slice(0, 4000),
        createdBy: String(createdBy),
    })
}

async function attachMessage(panelId, messageId) {
    return ReactionRolePanel.findOneAndUpdate({ panelId: String(panelId) }, { $set: { messageId: String(messageId) } }, { new: true }).lean()
}

async function getPanel(guildId, panelId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return ReactionRolePanel.findOne({ guildId: String(guildId), panelId: String(panelId) }).lean()
}

async function listPanels(guildId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return ReactionRolePanel.find({ guildId: String(guildId) }).sort({ createdAt: -1 }).lean()
}

async function addPanelRole(guildId, panelId, { roleId, label, emoji }) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const panel = await getPanel(guildId, panelId)
    if (!panel) throw new Error("Reaction-role panel not found")
    if (panel.options.some(option => option.roleId === String(roleId))) throw new Error("That role is already on this panel")
    if (panel.options.length >= MAX_ROLES_PER_PANEL) throw new Error(`This panel already has the maximum of ${MAX_ROLES_PER_PANEL} roles`)
    return ReactionRolePanel.findOneAndUpdate(
        { guildId: String(guildId), panelId: String(panelId) },
        { $push: { options: { roleId: String(roleId), label: cleanLabel(label), emoji: cleanEmoji(emoji) } } },
        { new: true }
    ).lean()
}

async function removePanelRole(guildId, panelId, roleId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    return ReactionRolePanel.findOneAndUpdate(
        { guildId: String(guildId), panelId: String(panelId) },
        { $pull: { options: { roleId: String(roleId) } } },
        { new: true }
    ).lean()
}

async function deletePanel(guildId, panelId) {
    if (!isMongoConnected()) throw new Error("MongoDB is unavailable")
    const panel = await ReactionRolePanel.findOneAndDelete({ guildId: String(guildId), panelId: String(panelId) }).lean()
    return panel || null
}

async function syncPanelMessage(client, panel) {
    if (!client || !panel?.channelId || !panel?.messageId) return false
    try {
        const channel = await client.channels.fetch(panel.channelId)
        if (!channel?.isTextBased?.()) return false
        const message = await channel.messages.fetch(panel.messageId)
        await message.edit({ embeds: [panelEmbed(panel)], components: panelComponents(panel), allowedMentions: SAFE_MENTIONS })
        return true
    } catch (error) {
        log.warn(`Could not sync reaction-role panel ${panel.panelId}: ${error.message}`)
        return false
    }
}

async function removePanelMessage(client, panel) {
    if (!client || !panel?.channelId || !panel?.messageId) return false
    try {
        const channel = await client.channels.fetch(panel.channelId)
        if (!channel?.isTextBased?.()) return false
        const message = await channel.messages.fetch(panel.messageId)
        await message.delete()
        return true
    } catch {
        return false
    }
}

async function handleReactionRoleButton(interaction) {
    if (!interaction.isButton?.() || !String(interaction.customId || "").startsWith(BUTTON_PREFIX)) return false
    const body = String(interaction.customId).slice(BUTTON_PREFIX.length)
    const [panelId, roleId] = body.split(":")
    try {
        if (!interaction.inGuild()) throw new Error("Use this button inside a server")
        const panel = await getPanel(interaction.guildId, panelId)
        if (!panel || !panel.options.some(option => option.roleId === roleId)) throw new Error("This reaction-role option is no longer configured")
        const role = interaction.guild.roles.cache.get(roleId)
        const validation = validateRole(interaction.guild, role)
        if (!validation.ok) throw new Error(validation.error)
        const member = await interaction.guild.members.fetch(interaction.user.id)
        const hasRole = member.roles.cache.has(roleId)
        if (hasRole) await member.roles.remove(role, "CURSED reaction role")
        else await member.roles.add(role, "CURSED reaction role")
        await interaction.reply({
            content: hasRole ? `Removed **${role.name}**.` : `Added **${role.name}**.`,
            ephemeral: true,
            allowedMentions: SAFE_MENTIONS,
        })
    } catch (error) {
        await interaction.reply({ content: error.message, ephemeral: true, allowedMentions: SAFE_MENTIONS }).catch(() => {})
    }
    return true
}

module.exports = {
    ReactionRolePanel,
    BUTTON_PREFIX,
    MAX_PANELS_PER_GUILD,
    MAX_ROLES_PER_PANEL,
    validateRole,
    panelEmbed,
    panelComponents,
    createPanel,
    attachMessage,
    getPanel,
    listPanels,
    addPanelRole,
    removePanelRole,
    deletePanel,
    syncPanelMessage,
    removePanelMessage,
    handleReactionRoleButton,
}
