const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
} = require("discord.js")

const PURPLE = 0x8B5CF6
const PRIORITY_COLORS = { low: 0x22C55E, normal: 0x8B5CF6, high: 0xF97316, urgent: 0xEF4444 }
const STATUS_LABELS = {
    open: "Open",
    claimed: "Claimed",
    waiting_user: "Waiting on user",
    waiting_staff: "Waiting on staff",
    closed: "Closed",
    deleted: "Deleted",
}

function color(value, fallback = PURPLE) {
    const parsed = Number.parseInt(String(value || "").replace("#", ""), 16)
    return Number.isFinite(parsed) ? parsed : fallback
}

function safeEmoji(value) {
    const text = String(value || "").trim()
    return text && text.length <= 50 ? text : undefined
}

function buildPanelMessage(panel) {
    const embed = new EmbedBuilder()
        .setColor(color(panel.color))
        .setTitle(panel.title || "CURSED Support Center")
        .setDescription(panel.description || "Choose a category below to open a private support ticket.")
        .setFooter({ text: panel.footer || "Powered by CURSED Support" })
        .setTimestamp()
    if (panel.imageUrl) embed.setImage(panel.imageUrl)

    const categories = (panel.categories || []).filter(item => item?.id && item?.label).slice(0, 25)
    const rows = []
    if (panel.style === "buttons" && categories.length <= 5) {
        rows.push(new ActionRowBuilder().addComponents(categories.map(item => {
            const button = new ButtonBuilder()
                .setCustomId(`tix:open:${panel._id}:${item.id}`)
                .setLabel(String(item.label).slice(0, 80))
                .setStyle(ButtonStyle.Primary)
            const emoji = safeEmoji(item.emoji)
            if (emoji) button.setEmoji(emoji)
            return button
        })))
    } else {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`tix:select:${panel._id}`)
                .setPlaceholder("Choose a support category")
                .addOptions(categories.map(item => ({
                    label: String(item.label).slice(0, 100),
                    value: item.id,
                    description: item.description ? String(item.description).slice(0, 100) : undefined,
                    emoji: safeEmoji(item.emoji),
                })))
        ))
    }
    return { embeds: [embed], components: rows, allowedMentions: { parse: [] } }
}

function ticketSummaryEmbed(ticket, guild) {
    const embed = new EmbedBuilder()
        .setColor(PRIORITY_COLORS[ticket.priority] || PURPLE)
        .setTitle(`🎫 CURSED Ticket #${String(ticket.ticketNumber).padStart(4, "0")}`)
        .setDescription("A private support channel has been created. Share the details staff need and keep the conversation respectful.")
        .addFields(
            { name: "Category", value: ticket.categoryLabel || "General Support", inline: true },
            { name: "Created by", value: `<@${ticket.creatorId}>`, inline: true },
            { name: "Priority", value: String(ticket.priority || "normal").toUpperCase(), inline: true },
            { name: "Status", value: STATUS_LABELS[ticket.status] || ticket.status, inline: true },
            { name: "Claimed by", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "Unclaimed", inline: true },
            { name: "Server", value: guild.name.slice(0, 1024), inline: true },
        )
        .setFooter({ text: "CURSED Support • Private • Secure • Logged" })
        .setTimestamp(ticket.createdAt || new Date())
    if (ticket.answers?.length) {
        for (const answer of ticket.answers.slice(0, 5)) {
            embed.addFields({ name: String(answer.label).slice(0, 256), value: String(answer.value || "No answer").slice(0, 1024), inline: false })
        }
    }
    return embed
}

function ticketControls(ticket) {
    if (["closed", "deleted"].includes(ticket.status)) {
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tix:action:reopen:${ticket._id}`).setLabel("Reopen").setEmoji("🔓").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tix:action:transcript:${ticket._id}`).setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:delete:${ticket._id}`).setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
        )]
    }
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tix:action:${ticket.claimedById ? "unclaim" : "claim"}:${ticket._id}`).setLabel(ticket.claimedById ? "Unclaim" : "Claim").setEmoji(ticket.claimedById ? "↩️" : "🙋").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`tix:action:add:${ticket._id}`).setLabel("Add User").setEmoji("➕").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:remove:${ticket._id}`).setLabel("Remove User").setEmoji("➖").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:rename:${ticket._id}`).setLabel("Rename").setEmoji("🏷️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:transcript:${ticket._id}`).setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`tix:priority:${ticket._id}`)
                .setPlaceholder(`Priority: ${ticket.priority || "normal"}`)
                .addOptions([
                    { label: "Low", value: "low", emoji: "🟢" },
                    { label: "Normal", value: "normal", emoji: "🟣" },
                    { label: "High", value: "high", emoji: "🟠" },
                    { label: "Urgent", value: "urgent", emoji: "🔴" },
                ]),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tix:action:waiting_user:${ticket._id}`).setLabel("Waiting on User").setEmoji("👤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:waiting_staff:${ticket._id}`).setLabel("Waiting on Staff").setEmoji("🛠️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:note:${ticket._id}`).setLabel("Staff Note").setEmoji("📝").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tix:action:close:${ticket._id}`).setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        ),
    ]
}

function buildTicketMessage(ticket, guild) {
    return {
        content: `<@${ticket.creatorId}> ${ticket.supportRoleIds.map(id => `<@&${id}>`).join(" ")}`.trim(),
        embeds: [ticketSummaryEmbed(ticket, guild)],
        components: ticketControls(ticket),
        allowedMentions: { parse: [], users: [ticket.creatorId], roles: ticket.supportRoleIds },
    }
}

function buildLogEmbed(ticket, action, actor, detail) {
    return new EmbedBuilder()
        .setColor(PRIORITY_COLORS[ticket.priority] || PURPLE)
        .setTitle(`🎫 Ticket ${action}`)
        .addFields(
            { name: "Ticket", value: `#${ticket.ticketNumber}`, inline: true },
            { name: "Creator", value: `<@${ticket.creatorId}>`, inline: true },
            { name: "Actor", value: actor?.id ? `<@${actor.id}>` : "System", inline: true },
            { name: "Category", value: ticket.categoryLabel, inline: true },
            { name: "Status", value: STATUS_LABELS[ticket.status] || ticket.status, inline: true },
            { name: "Detail", value: String(detail || "No additional details").slice(0, 1024), inline: false },
        )
        .setFooter({ text: "CURSED Ticket Logs" })
        .setTimestamp()
}

function feedbackComponents(ticketId) {
    return [new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map(value =>
        new ButtonBuilder()
            .setCustomId(`tix:rating:${ticketId}:${value}`)
            .setLabel(String(value))
            .setEmoji("⭐")
            .setStyle(value >= 4 ? ButtonStyle.Success : value <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary)
    ))]
}

module.exports = {
    PURPLE,
    STATUS_LABELS,
    buildPanelMessage,
    buildTicketMessage,
    buildLogEmbed,
    feedbackComponents,
}
