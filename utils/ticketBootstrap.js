const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    ModalBuilder,
    REST,
    Routes,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js")
const logger = require("./logger")
const ticketsCommand = require("../commands/tickets")
const { TicketPanel, TicketRecord, mongoReady } = require("./ticketModels")
const { getTicketConfig, isTicketStaff } = require("./ticketConfig")
const {
    openTicket,
    getTicket,
    claimTicket,
    unclaimTicket,
    setTicketPriority,
    setTicketStatus,
    addTicketUser,
    removeTicketUser,
    renameTicket,
    createTranscript,
    closeTicket,
    reopenTicket,
    deleteTicket,
    addTicketNote,
    rateTicket,
    logTicket,
} = require("./ticketService")

const log = logger.child("Tickets")
const SAFE = { parse: [], users: [], roles: [], repliedUser: false }
let initialized = false
let scheduler = null

async function registerTicketCommands(client) {
    const token = process.env.BOT_TOKEN
    if (!token || !client?.user?.id) return false
    const rest = new REST({ version: "10" }).setToken(token)
    const existing = await rest.get(Routes.applicationCommands(client.user.id))
    const byKey = new Map(existing.map(command => {
        const { id, application_id, guild_id, version, ...definition } = command
        return [`${definition.type || 1}:${definition.name}`, definition]
    }))
    for (const builder of ticketsCommand.commands) {
        const data = builder.toJSON()
        byKey.set(`${data.type || 1}:${data.name}`, data)
    }
    await rest.put(Routes.applicationCommands(client.user.id), { body: [...byKey.values()] })
    log.info(`Registered ${ticketsCommand.commands.length} ticket slash command(s)`)
    return true
}

function scheduleRegistration(client, attempt = 0) {
    const delay = attempt === 0 ? 45000 : Math.min(120000, 15000 * (attempt + 1))
    const timer = setTimeout(async () => {
        try { await registerTicketCommands(client) }
        catch (error) {
            log.error(`Ticket slash registration failed: ${error.message}`)
            if (attempt < 4) scheduleRegistration(client, attempt + 1)
        }
    }, delay)
    timer.unref?.()
}

async function respond(interaction, content, ephemeral = true) {
    const payload = { content, ephemeral, allowedMentions: SAFE }
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => null)
    return interaction.reply(payload).catch(() => null)
}

function parseCustomId(customId) {
    return String(customId || "").split(":")
}

async function showCreateModal(interaction, panel, category) {
    const questions = (category.questions || []).slice(0, 5)
    if (!questions.length) {
        await interaction.deferReply({ ephemeral: true })
        const result = await openTicket({ guild: interaction.guild, creator: interaction.user, panel, category, answers: [] })
        await interaction.editReply({ content: `✅ Your private ticket is ready: ${result.channel}`, allowedMentions: SAFE })
        return
    }
    const modal = new ModalBuilder()
        .setCustomId(`tix:create:${panel._id}:${category.id}`)
        .setTitle(String(category.label || "Open Ticket").slice(0, 45))
    for (const question of questions) {
        const input = new TextInputBuilder()
            .setCustomId(`q_${question.id}`.slice(0, 100))
            .setLabel(String(question.label).slice(0, 45))
            .setStyle(question.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
            .setRequired(question.required !== false)
            .setMaxLength(question.style === "short" ? 200 : 2000)
        if (question.placeholder) input.setPlaceholder(String(question.placeholder).slice(0, 100))
        modal.addComponents(new ActionRowBuilder().addComponents(input))
    }
    await interaction.showModal(modal)
}

async function handleOpenInteraction(interaction) {
    const parts = parseCustomId(interaction.customId)
    const panelId = parts[2]
    const categoryId = interaction.isStringSelectMenu() ? interaction.values[0] : parts[3]
    const panel = await TicketPanel.findOne({ _id: panelId, guildId: interaction.guildId, enabled: true })
    if (!panel) throw new Error("This ticket panel is no longer available.")
    const category = panel.categories.find(item => item.id === categoryId)
    if (!category) throw new Error("That ticket category no longer exists.")
    await showCreateModal(interaction, panel, category)
}

async function handleCreateModal(interaction, panelId, categoryId) {
    await interaction.deferReply({ ephemeral: true })
    const panel = await TicketPanel.findOne({ _id: panelId, guildId: interaction.guildId, enabled: true })
    if (!panel) throw new Error("This ticket panel is no longer available.")
    const category = panel.categories.find(item => item.id === categoryId)
    if (!category) throw new Error("That ticket category no longer exists.")
    const answers = (category.questions || []).slice(0, 5).map(question => ({
        questionId: question.id,
        label: question.label,
        value: interaction.fields.getTextInputValue(`q_${question.id}`.slice(0, 100)) || "No answer",
    }))
    const result = await openTicket({ guild: interaction.guild, creator: interaction.user, panel, category, answers })
    await interaction.editReply({ content: `✅ Your private ticket is ready: ${result.channel}`, allowedMentions: SAFE })
}

function oneFieldModal(customId, title, fieldId, label, { paragraph = false, required = true, placeholder, maxLength = 2000 } = {}) {
    const input = new TextInputBuilder()
        .setCustomId(fieldId)
        .setLabel(label.slice(0, 45))
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(required)
        .setMaxLength(maxLength)
    if (placeholder) input.setPlaceholder(placeholder.slice(0, 100))
    return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45)).addComponents(new ActionRowBuilder().addComponents(input))
}

async function ticketForComponent(interaction, ticketId) {
    const ticket = await getTicket(interaction.guildId, ticketId)
    if (!ticket) throw new Error("This ticket record no longer exists.")
    return ticket
}

async function handleAction(interaction, action, ticketId) {
    const ticket = await ticketForComponent(interaction, ticketId)
    if (["add", "remove", "rename", "note", "close"].includes(action)) {
        const definitions = {
            add: ["Add user", "user_id", "Discord user ID", false, "Enter a 17-20 digit user ID", 20],
            remove: ["Remove user", "user_id", "Discord user ID", false, "Enter a 17-20 digit user ID", 20],
            rename: ["Rename ticket", "name", "New channel name", false, "example-support-ticket", 80],
            note: ["Private staff note", "text", "Staff note", true, "Visible to staff in ticket history", 2000],
            close: ["Close ticket", "reason", "Resolution / close reason", true, "Explain how the ticket was resolved", 2000],
        }
        const [title, field, label, paragraph, placeholder, maxLength] = definitions[action]
        await interaction.showModal(oneFieldModal(`tix:modalaction:${action}:${ticket._id}`, title, field, label, { paragraph, placeholder, maxLength }))
        return
    }
    if (action === "claim") await claimTicket(interaction.guild, ticket, interaction.member)
    else if (action === "unclaim") await unclaimTicket(interaction.guild, ticket, interaction.member)
    else if (action === "transcript") {
        await interaction.deferReply({ ephemeral: true })
        const message = await createTranscript(interaction.guild, ticket, interaction.member)
        await interaction.editReply({ content: `✅ Transcript created: ${message.url}`, allowedMentions: SAFE })
        return
    }
    else if (action === "waiting_user") await setTicketStatus(interaction.guild, ticket, "waiting_user", interaction.member)
    else if (action === "waiting_staff") await setTicketStatus(interaction.guild, ticket, "waiting_staff", interaction.member)
    else if (action === "reopen") await reopenTicket(interaction.guild, ticket, interaction.member)
    else if (action === "delete") {
        if (!isTicketStaff(interaction.member, getTicketConfig(interaction.guildId))) throw new Error("Only ticket staff can delete tickets.")
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tix:confirmdelete:${ticket._id}`).setLabel("Delete permanently").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tix:canceldelete:${ticket._id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        )
        await interaction.reply({ content: "⚠️ This will permanently delete the ticket channel. The MongoDB ticket record and transcript reference will remain.", components: [row], ephemeral: true, allowedMentions: SAFE })
        return
    }
    await respond(interaction, `✅ Ticket #${ticket.ticketNumber} updated.`)
}

async function handleActionModal(interaction, action, ticketId) {
    await interaction.deferReply({ ephemeral: true })
    const ticket = await ticketForComponent(interaction, ticketId)
    if (action === "add" || action === "remove") {
        const userId = interaction.fields.getTextInputValue("user_id").trim()
        if (!/^\d{17,20}$/.test(userId)) throw new Error("Enter a valid Discord user ID.")
        if (action === "add") await addTicketUser(interaction.guild, ticket, userId, interaction.member)
        else await removeTicketUser(interaction.guild, ticket, userId, interaction.member)
    } else if (action === "rename") {
        await renameTicket(interaction.guild, ticket, interaction.fields.getTextInputValue("name"), interaction.member)
    } else if (action === "note") {
        await addTicketNote(ticket, interaction.member, interaction.fields.getTextInputValue("text"))
    } else if (action === "close") {
        await closeTicket(interaction.guild, ticket, interaction.member, interaction.fields.getTextInputValue("reason"))
    }
    await interaction.editReply({ content: `✅ Ticket #${ticket.ticketNumber} updated.`, allowedMentions: SAFE })
}

async function handleComponentInteraction(interaction) {
    const id = interaction.customId
    if (!id?.startsWith("tix:")) return false
    const parts = parseCustomId(id)
    try {
        if ((interaction.isButton() && parts[1] === "open") || (interaction.isStringSelectMenu() && parts[1] === "select")) {
            await handleOpenInteraction(interaction)
            return true
        }
        if (interaction.isModalSubmit() && parts[1] === "create") {
            await handleCreateModal(interaction, parts[2], parts[3])
            return true
        }
        if (interaction.isButton() && parts[1] === "action") {
            await handleAction(interaction, parts[2], parts[3])
            return true
        }
        if (interaction.isModalSubmit() && parts[1] === "modalaction") {
            await handleActionModal(interaction, parts[2], parts[3])
            return true
        }
        if (interaction.isStringSelectMenu() && parts[1] === "priority") {
            const ticket = await ticketForComponent(interaction, parts[2])
            await setTicketPriority(interaction.guild, ticket, interaction.values[0], interaction.member)
            await respond(interaction, `✅ Priority changed to **${interaction.values[0]}**.`)
            return true
        }
        if (interaction.isButton() && parts[1] === "confirmdelete") {
            await interaction.deferReply({ ephemeral: true })
            const ticket = await ticketForComponent(interaction, parts[2])
            await interaction.editReply({ content: "🗑️ Deleting ticket channel…", components: [], allowedMentions: SAFE })
            await deleteTicket(interaction.guild, ticket, interaction.member)
            return true
        }
        if (interaction.isButton() && parts[1] === "canceldelete") {
            await interaction.update({ content: "Deletion cancelled.", components: [], allowedMentions: SAFE })
            return true
        }
        if (interaction.isButton() && parts[1] === "rating") {
            const ticket = await rateTicket(parts[2], interaction.user.id, parts[3])
            if (!ticket) throw new Error("That feedback request is no longer available.")
            await interaction.update({ content: `⭐ Thanks for rating your CURSED support experience **${parts[3]}/5**.`, components: [], allowedMentions: SAFE })
            return true
        }
    } catch (error) {
        log.warn(`Ticket interaction failed: ${error.message}`)
        if (interaction.deferred) await interaction.editReply({ content: `❌ ${error.message}`, allowedMentions: SAFE }).catch(() => {})
        else await respond(interaction, `❌ ${error.message}`)
        return true
    }
    return false
}

async function trackTicketActivity(message) {
    if (!message.guild || message.author.bot || !mongoReady()) return
    const ticket = await TicketRecord.findOne({ guildId: message.guild.id, channelId: message.channel.id, status: { $in: ["open", "claimed", "waiting_user", "waiting_staff"] } })
    if (!ticket) return
    ticket.lastActivityAt = new Date()
    if (!ticket.firstStaffResponseAt && isTicketStaff(message.member, getTicketConfig(message.guild.id)) && message.author.id !== ticket.creatorId) {
        ticket.firstStaffResponseAt = new Date()
        ticket.events.push({ type: "first_staff_response", actorId: message.author.id, actorTag: message.author.tag, detail: "First staff response recorded", createdAt: new Date() })
    }
    await ticket.save().catch(() => {})
}

async function runTicketMaintenance(client) {
    if (!mongoReady() || !client?.isReady()) return
    const now = Date.now()
    const candidates = await TicketRecord.find({ status: { $in: ["open", "claimed", "waiting_user", "waiting_staff", "closed"] } }).limit(1000)
    for (const ticket of candidates) {
        const guild = client.guilds.cache.get(ticket.guildId)
        if (!guild) continue
        const config = getTicketConfig(guild.id)
        const botMember = guild.members.me
        try {
            if (ticket.status === "closed" && config.deleteAfterCloseMinutes > 0 && ticket.closedAt && now - ticket.closedAt.getTime() >= config.deleteAfterCloseMinutes * 60_000) {
                await deleteTicket(guild, ticket, botMember)
                continue
            }
            if (ticket.status !== "closed" && config.autoCloseHours > 0 && now - new Date(ticket.lastActivityAt).getTime() >= config.autoCloseHours * 3_600_000) {
                await closeTicket(guild, ticket, botMember, `Automatically closed after ${config.autoCloseHours} inactive hour(s)`)
                continue
            }
            if (!ticket.firstStaffResponseAt && !ticket.escalatedAt && config.firstResponseSlaMinutes > 0 && now - ticket.createdAt.getTime() >= config.firstResponseSlaMinutes * 60_000) {
                ticket.escalatedAt = new Date()
                ticket.events.push({ type: "sla_escalated", actorId: null, actorTag: "System", detail: `No staff response within ${config.firstResponseSlaMinutes} minute(s)`, createdAt: new Date() })
                await ticket.save()
                const channel = guild.channels.cache.get(ticket.channelId)
                if (channel?.isTextBased()) await channel.send({ content: `🚨 **Response SLA exceeded.** ${ticket.supportRoleIds.map(id => `<@&${id}>`).join(" ")}`, allowedMentions: { parse: [], roles: ticket.supportRoleIds, users: [] } }).catch(() => {})
                await logTicket(guild, ticket, "Escalated", botMember, "First-response SLA exceeded")
            }
        } catch (error) {
            log.warn(`Ticket maintenance failed for ${ticket.guildId}/${ticket.ticketNumber}: ${error.message}`)
        }
    }
}

function initializeTicketSystem(client) {
    if (initialized || !client) return
    initialized = true
    client.on(Events.InteractionCreate, interaction => {
        if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
            ticketsCommand.handleInteraction(interaction).catch(error => log.error(`Ticket command failed: ${error.message}`))
            return
        }
        handleComponentInteraction(interaction).catch(error => log.error(`Ticket component failed: ${error.message}`))
    })
    client.on(Events.MessageCreate, message => trackTicketActivity(message).catch(error => log.warn(`Ticket activity tracking failed: ${error.message}`)))
    scheduleRegistration(client)
    scheduler = setInterval(() => runTicketMaintenance(client).catch(error => log.error(`Ticket scheduler failed: ${error.message}`)), 10 * 60_000)
    scheduler.unref?.()
    setTimeout(() => runTicketMaintenance(client).catch(() => {}), 60_000).unref?.()
    log.info("CURSED Ticket System initialized")
}

module.exports = { initializeTicketSystem, registerTicketCommands, runTicketMaintenance }
