const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const { updateGuildConfigAndWait } = require("../utils/serverConfig")
const { getGuildPrefix } = require("../utils/prefix")
const { getTicketConfig, isTicketStaff } = require("../utils/ticketConfig")
const { defaultPanelData } = require("./tickets")
const {
    createPanel, publishPanel, listPanels, findTicketByChannel,
    claimTicket, unclaimTicket, closeTicket, reopenTicket, deleteTicket,
    addTicketUser, removeTicketUser, renameTicket, createTranscript,
    setTicketPriority, setTicketStatus, addTicketNote, ticketAnalytics,
} = require("../utils/ticketService")

const SAFE = { parse: [], users: [], roles: [], repliedUser: false }

async function say(message, content, embeds = []) {
    return message.reply({ content, embeds, allowedMentions: SAFE }).catch(() =>
        message.channel.send({ content, embeds, allowedMentions: SAFE }).catch(() => null)
    )
}

function parse(content) {
    const match = String(content || "").trim().match(/^!ticket(?:\s+|$)/i)
    if (!match) return null
    const body = String(content).trim().slice(match[0].length).trim()
    const args = body ? body.split(/\s+/) : []
    return { sub: (args.shift() || "help").toLowerCase(), args }
}

async function setup(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error("You need Manage Server to set up tickets.")
    const current = getTicketConfig(message.guild.id)
    await updateGuildConfigAndWait(message.guild.id, { tickets: { ...current, enabled: true } })
    let panel = (await listPanels(message.guild.id))[0]
    if (!panel) panel = await createPanel(message.guild.id, defaultPanelData(null, null), message.author)
    await publishPanel(message.guild, panel._id, message.channel.id, message.author)
    return say(message, "✅ CURSED Tickets is enabled and the support panel was published here. Configure roles, categories, logs, and transcripts from the dashboard.")
}

async function handle(message) {
    if (!message.guild || !message.member) return false
    const parsed = parse(message.content)
    if (!parsed) return false
    const prefix = getGuildPrefix(message.guild.id)
    try {
        if (parsed.sub === "help") {
            return Boolean(await say(message,
                `🎫 **CURSED Ticket Commands**\n` +
                `\`${prefix}ticket setup\` • create the default panel\n` +
                `\`${prefix}ticket claim|unclaim\`\n` +
                `\`${prefix}ticket close [reason]\` • \`${prefix}ticket reopen\`\n` +
                `\`${prefix}ticket add|remove @user\`\n` +
                `\`${prefix}ticket rename <name>\` • \`${prefix}ticket transcript\`\n` +
                `\`${prefix}ticket priority low|normal|high|urgent\`\n` +
                `\`${prefix}ticket status open|claimed|waiting_user|waiting_staff\`\n` +
                `\`${prefix}ticket note <staff note>\` • \`${prefix}ticket stats\` • \`${prefix}ticket delete\``
            ))
        }
        if (parsed.sub === "setup") { await setup(message); return true }
        if (parsed.sub === "panel") {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error("You need Manage Server to publish panels.")
            const panel = (await listPanels(message.guild.id))[0]
            if (!panel) throw new Error(`No panel exists. Run \`${prefix}ticket setup\` first.`)
            await publishPanel(message.guild, panel._id, message.channel.id, message.author)
            await say(message, "✅ Ticket panel published.")
            return true
        }
        if (parsed.sub === "stats") {
            if (!isTicketStaff(message.member, getTicketConfig(message.guild.id))) throw new Error("Only ticket staff can view analytics.")
            const data = await ticketAnalytics(message.guild.id)
            const embed = new EmbedBuilder().setColor(0x8B5CF6).setTitle("✦ CURSED Ticket Analytics").addFields(
                { name: "Total", value: String(data.total), inline: true },
                { name: "Open", value: String(data.open), inline: true },
                { name: "Closed", value: String(data.closed), inline: true },
                { name: "Avg response", value: data.avgFirstResponseMinutes == null ? "No data" : `${data.avgFirstResponseMinutes}m`, inline: true },
                { name: "Avg resolution", value: data.avgCloseMinutes == null ? "No data" : `${data.avgCloseMinutes}m`, inline: true },
                { name: "Rating", value: data.ratingsAverage == null ? "No data" : `${data.ratingsAverage}/5`, inline: true },
            )
            await say(message, "", [embed])
            return true
        }

        const ticket = await findTicketByChannel(message.guild.id, message.channel.id)
        if (!ticket) throw new Error("Use this command inside a CURSED ticket channel.")
        if (parsed.sub === "claim") await claimTicket(message.guild, ticket, message.member)
        else if (parsed.sub === "unclaim") await unclaimTicket(message.guild, ticket, message.member)
        else if (parsed.sub === "close") await closeTicket(message.guild, ticket, message.member, parsed.args.join(" ") || "Resolved")
        else if (parsed.sub === "reopen") await reopenTicket(message.guild, ticket, message.member)
        else if (parsed.sub === "delete") {
            await say(message, "🗑️ Deleting this ticket channel…")
            await deleteTicket(message.guild, ticket, message.member)
            return true
        }
        else if (["add", "remove"].includes(parsed.sub)) {
            const user = message.mentions.users.first()
            if (!user) throw new Error(`Mention a user: \`${prefix}ticket ${parsed.sub} @user\``)
            if (parsed.sub === "add") await addTicketUser(message.guild, ticket, user.id, message.member)
            else await removeTicketUser(message.guild, ticket, user.id, message.member)
        }
        else if (parsed.sub === "rename") await renameTicket(message.guild, ticket, parsed.args.join(" "), message.member)
        else if (parsed.sub === "transcript") await createTranscript(message.guild, ticket, message.member)
        else if (parsed.sub === "priority") await setTicketPriority(message.guild, ticket, parsed.args[0], message.member)
        else if (parsed.sub === "status") await setTicketStatus(message.guild, ticket, parsed.args[0], message.member)
        else if (parsed.sub === "note") await addTicketNote(ticket, message.member, parsed.args.join(" "))
        else throw new Error(`Unknown subcommand. Use \`${prefix}ticket help\`.`)
        await say(message, `✅ Ticket #${ticket.ticketNumber} updated.`)
        return true
    } catch (error) {
        await say(message, `❌ ${error.message}`)
        return true
    }
}

module.exports = { handle }
