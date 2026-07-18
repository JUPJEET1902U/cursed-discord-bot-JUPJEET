const {
    ChannelType,
    PermissionFlagsBits,
} = require("discord.js")
const { TicketPanel, TicketRecord, nextTicketNumber, mongoReady } = require("./ticketModels")
const { getTicketConfig, isTicketStaff, PRIORITIES } = require("./ticketConfig")
const { createTranscriptAttachment } = require("./ticketTranscript")
const { buildPanelMessage, buildTicketMessage, buildLogEmbed, feedbackComponents } = require("./ticketUi")

const OPEN_STATUSES = ["open", "claimed", "waiting_user", "waiting_staff"]
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }

function cleanName(value, fallback = "ticket") {
    const clean = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80)
    return clean || fallback
}

function actorFrom(subject) {
    const user = subject?.user || subject
    return {
        id: user?.id || null,
        tag: user?.tag || user?.username || subject?.displayName || "System",
    }
}

function event(type, actor, detail = null, metadata = {}) {
    const identity = actorFrom(actor)
    return { type, actorId: identity.id, actorTag: identity.tag, detail, metadata, createdAt: new Date() }
}

async function logTicket(guild, ticket, action, actor, detail) {
    const config = getTicketConfig(guild.id)
    const channel = config.logChannelId ? guild.channels.cache.get(config.logChannelId) : null
    if (!channel?.isTextBased()) return null
    return channel.send({ embeds: [buildLogEmbed(ticket, action, actorFrom(actor), detail)], allowedMentions: SAFE_MENTIONS }).catch(() => null)
}

async function findTicketByChannel(guildId, channelId) {
    if (!mongoReady()) return null
    return TicketRecord.findOne({ guildId, channelId }).sort({ createdAt: -1 })
}

async function getTicket(guildId, idOrNumber) {
    if (!mongoReady()) return null
    const query = /^\d+$/.test(String(idOrNumber || ""))
        ? { guildId, ticketNumber: Number(idOrNumber) }
        : { guildId, _id: idOrNumber }
    return TicketRecord.findOne(query)
}

function panelCategory(panel, categoryKey) {
    return panel?.categories?.find(item => item.id === categoryKey) || null
}

function supportRoles(config, category) {
    return [...new Set([...(category?.supportRoleIds || []), ...config.supportRoleIds])]
}

async function createPanel(guildId, data, actor) {
    if (!mongoReady()) throw Object.assign(new Error("MongoDB is required for ticket panels."), { code: "MONGO_UNAVAILABLE" })
    return TicketPanel.create({
        guildId,
        name: data.name,
        title: data.title,
        description: data.description,
        color: data.color,
        imageUrl: data.imageUrl || null,
        footer: data.footer || "Powered by CURSED Support",
        style: data.style || "select",
        categories: data.categories || [],
        enabled: data.enabled !== false,
        createdById: actor?.id || null,
        updatedById: actor?.id || null,
    })
}

async function updatePanel(guildId, panelId, data, actor) {
    return TicketPanel.findOneAndUpdate(
        { _id: panelId, guildId },
        { $set: { ...data, updatedById: actor?.id || null, updatedAt: new Date() } },
        { new: true, runValidators: true }
    )
}

async function deletePanel(guild, panelId) {
    const panel = await TicketPanel.findOneAndDelete({ _id: panelId, guildId: guild.id })
    if (!panel) return null
    if (panel.channelId && panel.messageId) {
        const channel = guild.channels.cache.get(panel.channelId)
        if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(panel.messageId).catch(() => null)
            await message?.delete().catch(() => {})
        }
    }
    return panel
}

async function publishPanel(guild, panelId, channelId, actor) {
    const panel = await TicketPanel.findOne({ _id: panelId, guildId: guild.id })
    if (!panel) throw Object.assign(new Error("Ticket panel not found."), { code: "PANEL_NOT_FOUND" })
    const channel = guild.channels.cache.get(channelId)
    if (!channel?.isTextBased()) throw Object.assign(new Error("Choose a text channel for the panel."), { code: "INVALID_CHANNEL" })
    const permissions = channel.permissionsFor(guild.members.me)
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        throw Object.assign(new Error("CURSED needs View Channel, Send Messages, and Embed Links there."), { code: "MISSING_PERMISSIONS" })
    }
    if (panel.channelId && panel.messageId) {
        const oldChannel = guild.channels.cache.get(panel.channelId)
        const oldMessage = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(panel.messageId).catch(() => null) : null
        await oldMessage?.delete().catch(() => {})
    }
    const message = await channel.send(buildPanelMessage(panel))
    panel.channelId = channel.id
    panel.messageId = message.id
    panel.updatedById = actor?.id || null
    await panel.save()
    return panel
}

function ticketChannelName(config, number, creator, category) {
    return cleanName(
        config.namingTemplate
            .replaceAll("{number}", String(number).padStart(4, "0"))
            .replaceAll("{user}", creator.username || "user")
            .replaceAll("{category}", category.label || "ticket"),
        `ticket-${number}`
    )
}

async function openTicket({ guild, creator, panel, category, answers = [] }) {
    const config = getTicketConfig(guild.id)
    if (!config.enabled) throw Object.assign(new Error("The ticket system is disabled in this server."), { code: "TICKETS_DISABLED" })
    if (config.blacklistUserIds.includes(creator.id)) throw Object.assign(new Error("You are not allowed to open tickets in this server."), { code: "TICKET_BLACKLISTED" })
    if (!mongoReady()) throw Object.assign(new Error("Tickets are temporarily unavailable because MongoDB is disconnected."), { code: "MONGO_UNAVAILABLE" })

    const openCount = await TicketRecord.countDocuments({ guildId: guild.id, creatorId: creator.id, status: { $in: OPEN_STATUSES } })
    if (openCount >= config.maxOpenPerUser) throw Object.assign(new Error(`You already have ${openCount} open ticket(s). The limit is ${config.maxOpenPerUser}.`), { code: "TICKET_LIMIT" })

    if (config.cooldownMinutes > 0) {
        const recent = await TicketRecord.findOne({ guildId: guild.id, creatorId: creator.id }).sort({ createdAt: -1 }).lean()
        const remaining = recent ? recent.createdAt.getTime() + config.cooldownMinutes * 60_000 - Date.now() : 0
        if (remaining > 0) throw Object.assign(new Error(`Wait ${Math.ceil(remaining / 60_000)} minute(s) before opening another ticket.`), { code: "TICKET_COOLDOWN" })
    }

    const botMember = guild.members.me
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        throw Object.assign(new Error("CURSED needs Manage Channels to create tickets."), { code: "MISSING_PERMISSIONS" })
    }

    const number = await nextTicketNumber(guild.id)
    const roleIds = supportRoles(config, category).filter(id => guild.roles.cache.has(id))
    const parentId = category.categoryId || config.defaultCategoryId || null
    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: creator.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ...roleIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] })),
    ]

    let channel
    let ticket
    try {
        channel = await guild.channels.create({
            name: ticketChannelName(config, number, creator, category),
            type: ChannelType.GuildText,
            parent: parentId && guild.channels.cache.has(parentId) ? parentId : undefined,
            topic: `CURSED Ticket #${number} • Creator ${creator.id} • ${category.label}`.slice(0, 1024),
            permissionOverwrites: overwrites,
            reason: `CURSED ticket #${number} opened by ${creator.tag}`,
        })
        ticket = await TicketRecord.create({
            guildId: guild.id,
            ticketNumber: number,
            channelId: channel.id,
            panelId: panel?._id || null,
            creatorId: creator.id,
            creatorTag: creator.tag || creator.username,
            categoryKey: category.id,
            categoryLabel: category.label,
            parentCategoryId: channel.parentId || null,
            supportRoleIds: roleIds,
            status: "open",
            priority: category.priority || config.defaultPriority,
            subject: answers[0]?.value?.slice(0, 200) || null,
            answers,
            lastActivityAt: new Date(),
            events: [event("opened", creator, `Opened in ${category.label}`)],
        })
        const control = await channel.send(buildTicketMessage(ticket, guild))
        ticket.events.push(event("control_message", guild.members.me, "Ticket controls created", { messageId: control.id }))
        await ticket.save()
        await logTicket(guild, ticket, "Opened", creator, `Channel: ${channel}`)
        return { ticket, channel }
    } catch (error) {
        if (ticket?._id) await TicketRecord.deleteOne({ _id: ticket._id }).catch(() => {})
        if (channel) await channel.delete("Rolling back failed ticket creation").catch(() => {})
        throw error
    }
}

async function updateTicketMessage(guild, ticket) {
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel?.isTextBased()) return
    const controlEvent = [...ticket.events].reverse().find(item => item.type === "control_message")
    const messageId = controlEvent?.metadata?.messageId
    const message = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null
    if (message) await message.edit(buildTicketMessage(ticket, guild)).catch(() => {})
}

async function claimTicket(guild, ticket, member) {
    const config = getTicketConfig(guild.id)
    if (!isTicketStaff(member, config)) throw Object.assign(new Error("Only ticket staff can claim tickets."), { code: "NOT_TICKET_STAFF" })
    if (["closed", "deleted"].includes(ticket.status)) throw new Error("This ticket is closed.")
    if (ticket.claimedById && ticket.claimedById !== member.id) throw new Error(`This ticket is already claimed by <@${ticket.claimedById}>.`)
    ticket.claimedById = member.id
    ticket.claimedByTag = member.user.tag
    ticket.status = "claimed"
    ticket.events.push(event("claimed", member, "Ticket claimed"))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    await logTicket(guild, ticket, "Claimed", member, "Ticket assigned to staff")
    return ticket
}

async function unclaimTicket(guild, ticket, member) {
    const config = getTicketConfig(guild.id)
    if (!isTicketStaff(member, config)) throw new Error("Only ticket staff can unclaim tickets.")
    ticket.claimedById = null
    ticket.claimedByTag = null
    ticket.status = "open"
    ticket.events.push(event("unclaimed", member, "Ticket returned to queue"))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    await logTicket(guild, ticket, "Unclaimed", member, "Ticket returned to queue")
    return ticket
}

async function setTicketPriority(guild, ticket, priority, member) {
    if (!PRIORITIES.includes(priority)) throw new Error("Invalid ticket priority.")
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can change priority.")
    ticket.priority = priority
    ticket.events.push(event("priority", member, `Priority changed to ${priority}`))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    await logTicket(guild, ticket, "Priority updated", member, priority)
    return ticket
}

async function setTicketStatus(guild, ticket, status, member) {
    if (!["open", "claimed", "waiting_user", "waiting_staff"].includes(status)) throw new Error("Invalid ticket status.")
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can change ticket status.")
    ticket.status = status
    ticket.events.push(event("status", member, `Status changed to ${status}`))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    return ticket
}

async function addTicketUser(guild, ticket, userId, member) {
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can add users.")
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel) throw new Error("Ticket channel is unavailable.")
    await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true })
    if (!ticket.addedUserIds.includes(userId)) ticket.addedUserIds.push(userId)
    ticket.events.push(event("user_added", member, `Added user ${userId}`))
    await ticket.save()
    return ticket
}

async function removeTicketUser(guild, ticket, userId, member) {
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can remove users.")
    if (userId === ticket.creatorId) throw new Error("The ticket creator cannot be removed. Close the ticket instead.")
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel) throw new Error("Ticket channel is unavailable.")
    await channel.permissionOverwrites.delete(userId).catch(() => {})
    ticket.addedUserIds = ticket.addedUserIds.filter(id => id !== userId)
    ticket.events.push(event("user_removed", member, `Removed user ${userId}`))
    await ticket.save()
    return ticket
}

async function renameTicket(guild, ticket, name, member) {
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can rename tickets.")
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel) throw new Error("Ticket channel is unavailable.")
    const clean = cleanName(name, `ticket-${ticket.ticketNumber}`)
    await channel.setName(clean, `Ticket renamed by ${member.user.tag}`)
    ticket.events.push(event("renamed", member, clean))
    await ticket.save()
    return ticket
}

async function createTranscript(guild, ticket, actor) {
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel?.isTextBased()) throw new Error("Ticket channel is unavailable.")
    const attachment = await createTranscriptAttachment(channel, ticket)
    const config = getTicketConfig(guild.id)
    const destination = config.transcriptChannelId ? guild.channels.cache.get(config.transcriptChannelId) : null
    let sent = null
    if (destination?.isTextBased()) {
        sent = await destination.send({
            content: `📄 Transcript for ticket **#${ticket.ticketNumber}** • creator <@${ticket.creatorId}>`,
            files: [attachment],
            allowedMentions: SAFE_MENTIONS,
        })
        ticket.transcriptMessageUrl = sent.url
    } else {
        sent = await channel.send({ content: `📄 Transcript requested by <@${actorFrom(actor).id}>`, files: [attachment], allowedMentions: SAFE_MENTIONS })
        ticket.transcriptMessageUrl = sent.url
    }
    ticket.transcriptGeneratedAt = new Date()
    ticket.events.push(event("transcript", actor, "Transcript generated", { url: sent.url }))
    await ticket.save()
    return sent
}

async function closeTicket(guild, ticket, member, reason = "Resolved") {
    const config = getTicketConfig(guild.id)
    const staff = isTicketStaff(member, config)
    if (!staff && !(config.allowCreatorClose && member.id === ticket.creatorId)) throw new Error("You cannot close this ticket.")
    if (["closed", "deleted"].includes(ticket.status)) throw new Error("This ticket is already closed.")
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel) throw new Error("Ticket channel is unavailable.")

    if (config.transcriptOnClose) await createTranscript(guild, ticket, member).catch(() => null)
    await channel.permissionOverwrites.edit(ticket.creatorId, { SendMessages: false, AddReactions: false }).catch(() => {})
    if (config.archiveCategoryId && guild.channels.cache.has(config.archiveCategoryId)) await channel.setParent(config.archiveCategoryId, { lockPermissions: false }).catch(() => {})
    await channel.setName(cleanName(`closed-${ticket.ticketNumber}`)).catch(() => {})
    ticket.status = "closed"
    ticket.closedAt = new Date()
    ticket.closedById = member.id
    ticket.closeReason = String(reason || "Resolved").slice(0, 2000)
    ticket.events.push(event("closed", member, ticket.closeReason))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    await logTicket(guild, ticket, "Closed", member, ticket.closeReason)

    const creator = await guild.client.users.fetch(ticket.creatorId).catch(() => null)
    if (creator && config.dmOnClose) {
        const payload = {
            content: `🔒 Your ticket **#${ticket.ticketNumber}** in **${guild.name}** was closed.\nReason: ${ticket.closeReason}${ticket.transcriptMessageUrl ? `\nTranscript: ${ticket.transcriptMessageUrl}` : ""}`,
            allowedMentions: SAFE_MENTIONS,
        }
        if (config.feedbackEnabled) payload.components = feedbackComponents(ticket._id)
        await creator.send(payload).catch(() => {})
    }
    if (config.deleteAfterCloseMinutes > 0) ticket.events.push(event("delete_scheduled", null, `${config.deleteAfterCloseMinutes} minute(s)`))
    await ticket.save()
    return ticket
}

async function reopenTicket(guild, ticket, member) {
    const config = getTicketConfig(guild.id)
    if (!isTicketStaff(member, config)) throw new Error("Only ticket staff can reopen tickets.")
    if (ticket.status !== "closed") throw new Error("Only closed tickets can be reopened.")
    const channel = guild.channels.cache.get(ticket.channelId)
    if (!channel) throw new Error("Ticket channel is unavailable.")
    await channel.permissionOverwrites.edit(ticket.creatorId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {})
    if (ticket.parentCategoryId && guild.channels.cache.has(ticket.parentCategoryId)) await channel.setParent(ticket.parentCategoryId, { lockPermissions: false }).catch(() => {})
    await channel.setName(cleanName(`ticket-${ticket.ticketNumber}`)).catch(() => {})
    ticket.status = ticket.claimedById ? "claimed" : "open"
    ticket.reopenedAt = new Date()
    ticket.closedAt = null
    ticket.closedById = null
    ticket.closeReason = null
    ticket.events.push(event("reopened", member, "Ticket reopened"))
    await ticket.save()
    await updateTicketMessage(guild, ticket)
    await logTicket(guild, ticket, "Reopened", member, "Ticket reopened")
    return ticket
}

async function deleteTicket(guild, ticket, member) {
    if (!isTicketStaff(member, getTicketConfig(guild.id))) throw new Error("Only ticket staff can delete tickets.")
    const channel = guild.channels.cache.get(ticket.channelId)
    ticket.status = "deleted"
    ticket.deletedAt = new Date()
    ticket.events.push(event("deleted", member, "Ticket channel deleted"))
    await ticket.save()
    await logTicket(guild, ticket, "Deleted", member, `Channel ${ticket.channelId}`)
    if (channel) await channel.delete(`Ticket #${ticket.ticketNumber} deleted by ${member.user.tag}`)
    return ticket
}

async function addTicketNote(ticket, member, text) {
    if (!isTicketStaff(member, getTicketConfig(member.guild.id))) throw new Error("Only ticket staff can add notes.")
    ticket.events.push(event("staff_note", member, String(text).slice(0, 2000)))
    await ticket.save()
    return ticket
}

async function rateTicket(ticketId, userId, rating) {
    if (!mongoReady()) return null
    const value = Math.max(1, Math.min(5, Number(rating)))
    return TicketRecord.findOneAndUpdate(
        { _id: ticketId, creatorId: userId },
        { $set: { feedbackRating: value }, $push: { events: event("feedback", { id: userId, tag: "Ticket creator" }, `${value}/5`) } },
        { new: true }
    )
}

async function listPanels(guildId) {
    return TicketPanel.find({ guildId }).sort({ createdAt: 1 }).lean()
}

async function listTickets(guildId, { status, limit = 100 } = {}) {
    const query = { guildId }
    if (status) query.status = Array.isArray(status) ? { $in: status } : status
    return TicketRecord.find(query).sort({ updatedAt: -1 }).limit(Math.min(250, limit)).lean()
}

async function ticketAnalytics(guildId) {
    if (!mongoReady()) return { total: 0, open: 0, closed: 0, avgFirstResponseMinutes: null, avgCloseMinutes: null, ratingsAverage: null, topCategory: null, staffLeaderboard: [] }
    const [total, open, closed, docs] = await Promise.all([
        TicketRecord.countDocuments({ guildId }),
        TicketRecord.countDocuments({ guildId, status: { $in: OPEN_STATUSES } }),
        TicketRecord.countDocuments({ guildId, status: "closed" }),
        TicketRecord.find({ guildId }).select("createdAt closedAt firstStaffResponseAt feedbackRating categoryLabel claimedById claimedByTag").lean(),
    ])
    const avg = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null
    const response = docs.filter(d => d.firstStaffResponseAt).map(d => (d.firstStaffResponseAt - d.createdAt) / 60_000)
    const close = docs.filter(d => d.closedAt).map(d => (d.closedAt - d.createdAt) / 60_000)
    const ratings = docs.filter(d => d.feedbackRating).map(d => d.feedbackRating)
    const categories = new Map()
    const staff = new Map()
    for (const doc of docs) {
        categories.set(doc.categoryLabel, (categories.get(doc.categoryLabel) || 0) + 1)
        if (doc.claimedById) staff.set(doc.claimedById, { id: doc.claimedById, tag: doc.claimedByTag || doc.claimedById, count: (staff.get(doc.claimedById)?.count || 0) + 1 })
    }
    const topCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    return {
        total, open, closed,
        avgFirstResponseMinutes: avg(response),
        avgCloseMinutes: avg(close),
        ratingsAverage: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
        topCategory,
        staffLeaderboard: [...staff.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    }
}

module.exports = {
    OPEN_STATUSES,
    createPanel,
    updatePanel,
    deletePanel,
    publishPanel,
    openTicket,
    findTicketByChannel,
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
    listPanels,
    listTickets,
    ticketAnalytics,
    updateTicketMessage,
    logTicket,
}
