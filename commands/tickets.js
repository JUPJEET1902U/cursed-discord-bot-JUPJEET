const {
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js")
const { updateGuildConfigAndWait } = require("../utils/serverConfig")
const { getTicketConfig, isTicketStaff } = require("../utils/ticketConfig")
const {
    createPanel,
    publishPanel,
    listPanels,
    findTicketByChannel,
    claimTicket,
    unclaimTicket,
    addTicketUser,
    removeTicketUser,
    renameTicket,
    createTranscript,
    closeTicket,
    reopenTicket,
    deleteTicket,
    setTicketPriority,
    setTicketStatus,
    addTicketNote,
    ticketAnalytics,
} = require("../utils/ticketService")

const SAFE = { parse: [], users: [], roles: [], repliedUser: false }

const command = new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Manage CURSED support tickets")
    .addSubcommand(sub => sub.setName("setup").setDescription("Enable tickets and publish a CURSED panel")
        .addChannelOption(o => o.setName("panel_channel").setDescription("Channel for the support panel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addChannelOption(o => o.setName("ticket_category").setDescription("Category where private tickets are created").addChannelTypes(ChannelType.GuildCategory))
        .addRoleOption(o => o.setName("support_role").setDescription("Role that can access tickets"))
        .addChannelOption(o => o.setName("log_channel").setDescription("Channel for ticket logs").addChannelTypes(ChannelType.GuildText))
        .addChannelOption(o => o.setName("transcript_channel").setDescription("Channel for HTML transcripts").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(sub => sub.setName("panel").setDescription("Publish the first configured ticket panel")
        .addChannelOption(o => o.setName("channel").setDescription("Panel channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(sub => sub.setName("claim").setDescription("Claim the current ticket"))
    .addSubcommand(sub => sub.setName("unclaim").setDescription("Return the current ticket to the staff queue"))
    .addSubcommand(sub => sub.setName("close").setDescription("Close the current ticket").addStringOption(o => o.setName("reason").setDescription("Resolution or close reason").setMaxLength(2000)))
    .addSubcommand(sub => sub.setName("reopen").setDescription("Reopen the current ticket"))
    .addSubcommand(sub => sub.setName("delete").setDescription("Delete the current closed ticket channel"))
    .addSubcommand(sub => sub.setName("add").setDescription("Add a member to the current ticket").addUserOption(o => o.setName("user").setDescription("Member to add").setRequired(true)))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove an added member from the ticket").addUserOption(o => o.setName("user").setDescription("Member to remove").setRequired(true)))
    .addSubcommand(sub => sub.setName("rename").setDescription("Rename the current ticket channel").addStringOption(o => o.setName("name").setDescription("New channel name").setRequired(true).setMaxLength(80)))
    .addSubcommand(sub => sub.setName("transcript").setDescription("Generate an HTML transcript"))
    .addSubcommand(sub => sub.setName("priority").setDescription("Set ticket priority").addStringOption(o => o.setName("level").setDescription("Priority").setRequired(true).addChoices(
        { name: "Low", value: "low" }, { name: "Normal", value: "normal" }, { name: "High", value: "high" }, { name: "Urgent", value: "urgent" }
    )))
    .addSubcommand(sub => sub.setName("status").setDescription("Update ticket workflow status").addStringOption(o => o.setName("state").setDescription("Status").setRequired(true).addChoices(
        { name: "Open", value: "open" }, { name: "Claimed", value: "claimed" }, { name: "Waiting on user", value: "waiting_user" }, { name: "Waiting on staff", value: "waiting_staff" }
    )))
    .addSubcommand(sub => sub.setName("note").setDescription("Add a private staff note to the ticket record").addStringOption(o => o.setName("text").setDescription("Staff-only note").setRequired(true).setMaxLength(2000)))
    .addSubcommand(sub => sub.setName("stats").setDescription("View ticket analytics"))

function defaultPanelData(categoryId, supportRoleId) {
    const roleIds = supportRoleId ? [supportRoleId] : []
    const category = (id, label, description, emoji, priority = "normal") => ({
        id, label, description, emoji, categoryId: categoryId || null, supportRoleIds: roleIds, priority,
        questions: [
            { id: "subject", label: "What do you need help with?", placeholder: "Give staff a short summary", style: "short", required: true },
            { id: "details", label: "Explain the issue", placeholder: "Include all relevant details", style: "paragraph", required: true },
        ],
    })
    return {
        name: "Main Support Panel",
        title: "✦ CURSED Support Center",
        description: "Choose the category that best matches your request. A private channel will be created for you and the support team.",
        color: "#8B5CF6",
        footer: "Powered by CURSED Support • Private • Secure",
        style: "buttons",
        enabled: true,
        categories: [
            category("general", "General Support", "Questions and general help", "💬"),
            category("billing", "Billing", "Purchases and payments", "💳", "high"),
            category("report", "Report User", "Report a member safely", "🚩", "high"),
            category("appeal", "Appeals", "Appeal a moderation action", "🛡️"),
            category("partnership", "Partnership", "Business and community requests", "🤝"),
        ],
    }
}

async function ticketForInteraction(interaction) {
    const ticket = await findTicketByChannel(interaction.guildId, interaction.channelId)
    if (!ticket) throw new Error("This command must be used inside a CURSED ticket channel.")
    return ticket
}

async function reply(interaction, content, ephemeral = true) {
    const payload = { content, ephemeral, allowedMentions: SAFE }
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload)
    return interaction.reply(payload)
}

async function setup(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("You need Manage Server to configure tickets.")
    const panelChannel = interaction.options.getChannel("panel_channel", true)
    const category = interaction.options.getChannel("ticket_category")
    const supportRole = interaction.options.getRole("support_role")
    const logChannel = interaction.options.getChannel("log_channel")
    const transcriptChannel = interaction.options.getChannel("transcript_channel")
    const current = getTicketConfig(interaction.guildId)
    const config = {
        ...current,
        enabled: true,
        defaultCategoryId: category?.id || current.defaultCategoryId,
        supportRoleIds: supportRole ? [supportRole.id] : current.supportRoleIds,
        logChannelId: logChannel?.id || current.logChannelId,
        transcriptChannelId: transcriptChannel?.id || current.transcriptChannelId,
    }
    await updateGuildConfigAndWait(interaction.guildId, { tickets: config })
    let panel = (await listPanels(interaction.guildId))[0]
    if (!panel) panel = await createPanel(interaction.guildId, defaultPanelData(category?.id, supportRole?.id), interaction.user)
    panel = await publishPanel(interaction.guild, panel._id, panelChannel.id, interaction.user)
    await reply(interaction, `✅ CURSED Tickets is enabled. The **${panel.name}** panel was published in ${panelChannel}.`)
}

async function stats(interaction) {
    if (!isTicketStaff(interaction.member, getTicketConfig(interaction.guildId))) throw new Error("Only ticket staff can view ticket analytics.")
    const data = await ticketAnalytics(interaction.guildId)
    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle("✦ CURSED Ticket Analytics")
        .addFields(
            { name: "Total", value: String(data.total), inline: true },
            { name: "Open", value: String(data.open), inline: true },
            { name: "Closed", value: String(data.closed), inline: true },
            { name: "Avg first response", value: data.avgFirstResponseMinutes == null ? "No data" : `${data.avgFirstResponseMinutes}m`, inline: true },
            { name: "Avg resolution", value: data.avgCloseMinutes == null ? "No data" : `${data.avgCloseMinutes}m`, inline: true },
            { name: "Rating", value: data.ratingsAverage == null ? "No ratings" : `${data.ratingsAverage}/5`, inline: true },
            { name: "Top category", value: data.topCategory || "No data", inline: false },
        )
        .setFooter({ text: "CURSED Support Analytics" })
        .setTimestamp()
    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: SAFE })
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "ticket" || !interaction.inGuild()) return false
    try {
        const sub = interaction.options.getSubcommand()
        if (sub === "setup") { await setup(interaction); return true }
        if (sub === "panel") {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("You need Manage Server to publish panels.")
            const panel = (await listPanels(interaction.guildId))[0]
            if (!panel) throw new Error("No panel exists yet. Use `/ticket setup` or create one in the dashboard.")
            const channel = interaction.options.getChannel("channel", true)
            await publishPanel(interaction.guild, panel._id, channel.id, interaction.user)
            await reply(interaction, `✅ Ticket panel published in ${channel}.`)
            return true
        }
        if (sub === "stats") { await stats(interaction); return true }

        const ticket = await ticketForInteraction(interaction)
        if (sub === "claim") await claimTicket(interaction.guild, ticket, interaction.member)
        else if (sub === "unclaim") await unclaimTicket(interaction.guild, ticket, interaction.member)
        else if (sub === "close") await closeTicket(interaction.guild, ticket, interaction.member, interaction.options.getString("reason") || "Resolved")
        else if (sub === "reopen") await reopenTicket(interaction.guild, ticket, interaction.member)
        else if (sub === "delete") {
            await reply(interaction, "🗑️ Deleting this ticket channel…")
            await deleteTicket(interaction.guild, ticket, interaction.member)
            return true
        }
        else if (sub === "add") await addTicketUser(interaction.guild, ticket, interaction.options.getUser("user", true).id, interaction.member)
        else if (sub === "remove") await removeTicketUser(interaction.guild, ticket, interaction.options.getUser("user", true).id, interaction.member)
        else if (sub === "rename") await renameTicket(interaction.guild, ticket, interaction.options.getString("name", true), interaction.member)
        else if (sub === "transcript") await createTranscript(interaction.guild, ticket, interaction.member)
        else if (sub === "priority") await setTicketPriority(interaction.guild, ticket, interaction.options.getString("level", true), interaction.member)
        else if (sub === "status") await setTicketStatus(interaction.guild, ticket, interaction.options.getString("state", true), interaction.member)
        else if (sub === "note") await addTicketNote(ticket, interaction.member, interaction.options.getString("text", true))
        await reply(interaction, `✅ Ticket #${ticket.ticketNumber} updated successfully.`)
        return true
    } catch (error) {
        await reply(interaction, `❌ ${error.message}`)
        return true
    }
}

module.exports = { commands: [command], handleInteraction, defaultPanelData }
