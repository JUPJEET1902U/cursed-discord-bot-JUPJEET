const { PermissionFlagsBits } = require("discord.js")

const SERVER_PAGE_SIZE = 6
const MEMBER_PAGE_SIZE = 15
const OWNER_INVITE_MAX_AGE_SECONDS = 60 * 60
const OWNER_INVITE_MAX_USES = 1
const OWNER_INVITE_REASON = "CURSED owner network inspector request"

function sanitizeInline(value, maxLength = 120) {
    return String(value ?? "Unknown")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/@/g, "＠")
        .replace(/`/g, "ˋ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength) || "Unknown"
}

function collectionValues(collection) {
    if (!collection) return []
    if (Array.isArray(collection)) return [...collection]
    if (typeof collection.values === "function") return [...collection.values()]
    if (collection.cache && typeof collection.cache.values === "function") return [...collection.cache.values()]
    return []
}

function discordTimestamp(value, style = "f") {
    if (!value) return "Unknown"
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return "Unknown"
    return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`
}

function clampPage(value, totalPages) {
    const page = Math.floor(Number(value) || 1)
    return Math.max(1, Math.min(Math.max(1, totalPages), page))
}

function verificationLabel(level) {
    return ({
        0: "None",
        1: "Low",
        2: "Medium",
        3: "High",
        4: "Very High",
    })[Number(level)] || sanitizeInline(level || "Unknown", 30)
}

function premiumTierLabel(tier) {
    return ({
        0: "None",
        1: "Tier 1",
        2: "Tier 2",
        3: "Tier 3",
    })[Number(tier)] || sanitizeInline(tier || "Unknown", 30)
}

function getCachedMemberBreakdown(guild) {
    const members = collectionValues(guild?.members?.cache)
    let bots = 0
    for (const member of members) if (member?.user?.bot) bots++
    return {
        cached: members.length,
        bots,
        humans: Math.max(0, members.length - bots),
        complete: Number(guild?.memberCount || 0) === members.length,
    }
}

function ownerFromCache(guild) {
    const member = guild?.members?.cache?.get?.(guild.ownerId)
    if (!member) return { id: guild?.ownerId || "Unknown", label: guild?.ownerId || "Unknown" }
    const user = member.user || {}
    return {
        id: user.id || guild.ownerId || "Unknown",
        label: sanitizeInline(user.tag || user.username || member.displayName || user.id, 80),
    }
}

async function fetchOwnerSummary(guild) {
    try {
        const member = await guild.fetchOwner()
        const user = member?.user || {}
        return {
            id: user.id || guild.ownerId || "Unknown",
            label: sanitizeInline(user.tag || user.username || member.displayName || user.id, 80),
        }
    } catch {
        return ownerFromCache(guild)
    }
}

function buildServerListPages(guilds, botName = "CURSED") {
    const sorted = [...(guilds || [])]
        .filter(Boolean)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
    const totalPages = Math.max(1, Math.ceil(sorted.length / SERVER_PAGE_SIZE))
    const pages = []

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const start = pageIndex * SERVER_PAGE_SIZE
        const entries = sorted.slice(start, start + SERVER_PAGE_SIZE).map((guild, offset) => {
            const owner = ownerFromCache(guild)
            return [
                `${start + offset + 1}. **${sanitizeInline(guild.name, 90)}**`,
                `   ID: \`${sanitizeInline(guild.id, 30)}\` • Members: **${Number(guild.memberCount || 0).toLocaleString()}**`,
                `   Owner: ${owner.label} • Channels: **${guild.channels?.cache?.size || 0}** • Roles: **${guild.roles?.cache?.size || 0}**`,
            ].join("\n")
        })

        pages.push(
            `🌐 **${sanitizeInline(botName, 40)} Network Inspector**\n` +
            `Servers: **${sorted.length}** • Page **${pageIndex + 1}/${totalPages}**\n\n` +
            (entries.length ? entries.join("\n\n") : "No servers are currently cached.") +
            `\n\nUse \`!serverinfo <server-id>\` for full details.`
        )
    }

    return pages
}

function channelBreakdown(guild) {
    const channels = collectionValues(guild?.channels?.cache)
    const counts = { text: 0, voice: 0, category: 0, forum: 0, stage: 0, other: 0 }
    for (const channel of channels) {
        const type = Number(channel?.type)
        if ([0, 5].includes(type)) counts.text++
        else if (type === 2) counts.voice++
        else if (type === 4) counts.category++
        else if ([15, 16].includes(type)) counts.forum++
        else if (type === 13) counts.stage++
        else counts.other++
    }
    return counts
}

function buildServerInfo(guild, owner = ownerFromCache(guild)) {
    const members = getCachedMemberBreakdown(guild)
    const channels = channelBreakdown(guild)
    const features = Array.isArray(guild.features) ? guild.features.slice(0, 12).map(item => sanitizeInline(item, 40)) : []
    const description = guild.description ? sanitizeInline(guild.description, 180) : "None"
    const icon = typeof guild.iconURL === "function" ? guild.iconURL({ size: 256 }) : null
    const banner = typeof guild.bannerURL === "function" ? guild.bannerURL({ size: 512 }) : null

    return [
        `🏠 **${sanitizeInline(guild.name, 100)}**`,
        `🆔 Server ID: \`${sanitizeInline(guild.id, 30)}\``,
        `👑 Owner: **${owner.label}** (\`${sanitizeInline(owner.id, 30)}\`)`,
        `👥 Members: **${Number(guild.memberCount || 0).toLocaleString()}**`,
        `   Cached breakdown: ${members.humans} humans • ${members.bots} bots${members.complete ? "" : " • cache is partial"}`,
        `📅 Created: ${discordTimestamp(guild.createdAt)}`,
        `📥 CURSED joined: ${discordTimestamp(guild.members?.me?.joinedAt)}`,
        `💬 Channels: **${guild.channels?.cache?.size || 0}** (${channels.text} text • ${channels.voice} voice • ${channels.forum} forum • ${channels.stage} stage • ${channels.category} categories)`,
        `🎭 Roles: **${guild.roles?.cache?.size || 0}** • 😀 Emojis: **${guild.emojis?.cache?.size || 0}** • 🏷 Stickers: **${guild.stickers?.cache?.size || 0}**`,
        `🚀 Boosts: **${Number(guild.premiumSubscriptionCount || 0)}** • Level: **${premiumTierLabel(guild.premiumTier)}**`,
        `🛡 Verification: **${verificationLabel(guild.verificationLevel)}** • Locale: **${sanitizeInline(guild.preferredLocale || "Unknown", 40)}**`,
        `📝 Description: ${description}`,
        `✨ Features: ${features.length ? features.join(", ") : "None reported"}`,
        `🖼 Icon: ${icon || "None"}`,
        `🌄 Banner: ${banner || "None"}`,
        `🔗 Vanity: ${guild.vanityURLCode ? `https://discord.gg/${sanitizeInline(guild.vanityURLCode, 50)}` : "None / unavailable"}`,
        `\nMembers: \`!servermembers ${sanitizeInline(guild.id, 30)} 1\``,
        `Invite: \`!serverinvite ${sanitizeInline(guild.id, 30)}\``,
    ].join("\n")
}

async function resolveGuild(client, guildId) {
    const id = String(guildId || "").trim()
    if (!/^\d{16,22}$/.test(id)) return null
    const cached = client?.guilds?.cache?.get?.(id)
    if (cached) return cached
    try {
        return await client?.guilds?.fetch?.(id)
    } catch {
        return null
    }
}

async function fetchMemberSnapshot(guild) {
    try {
        const fetched = await guild.members.fetch()
        return {
            members: collectionValues(fetched),
            partial: Number(guild.memberCount || 0) !== fetched.size,
            fetchError: null,
        }
    } catch (error) {
        return {
            members: collectionValues(guild?.members?.cache),
            partial: true,
            fetchError: String(error?.message || "Member fetch failed").slice(0, 160),
        }
    }
}

function memberSortKey(member) {
    const botPrefix = member?.user?.bot ? "1" : "0"
    const name = String(member?.displayName || member?.user?.username || member?.user?.id || "")
    return `${botPrefix}:${name.toLowerCase()}`
}

function buildMemberPage(guild, snapshot, requestedPage = 1) {
    const sorted = [...(snapshot?.members || [])].sort((a, b) => memberSortKey(a).localeCompare(memberSortKey(b)))
    const totalPages = Math.max(1, Math.ceil(sorted.length / MEMBER_PAGE_SIZE))
    const page = clampPage(requestedPage, totalPages)
    const start = (page - 1) * MEMBER_PAGE_SIZE
    const entries = sorted.slice(start, start + MEMBER_PAGE_SIZE).map((member, offset) => {
        const user = member?.user || {}
        const display = sanitizeInline(member?.displayName || user.globalName || user.username || user.id, 60)
        const username = sanitizeInline(user.tag || user.username || user.id, 60)
        const bot = user.bot ? " 🤖" : ""
        return `${start + offset + 1}. **${display}**${bot} — ${username} — \`${sanitizeInline(user.id, 30)}\``
    })

    const partialNote = snapshot?.partial
        ? "\n⚠️ Member list is partial because Discord did not return the full guild member set."
        : ""

    return {
        page,
        totalPages,
        content: `👥 **${sanitizeInline(guild.name, 90)} Members**\n` +
            `Server total: **${Number(guild.memberCount || 0).toLocaleString()}** • Loaded: **${sorted.length.toLocaleString()}** • Page **${page}/${totalPages}**\n\n` +
            (entries.length ? entries.join("\n") : "No members are currently available.") +
            partialNote,
    }
}

function canCreateInvite(channel, guild) {
    if (!channel || typeof channel.createInvite !== "function" || channel.isThread?.()) return false
    const me = guild?.members?.me
    if (!me || typeof channel.permissionsFor !== "function") return false
    const permissions = channel.permissionsFor(me)
    if (!permissions?.has) return false
    return permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreateInstantInvite])
}

function findInviteChannel(guild) {
    const candidates = []
    if (guild?.systemChannel) candidates.push(guild.systemChannel)
    for (const channel of collectionValues(guild?.channels?.cache)) {
        if (!candidates.includes(channel)) candidates.push(channel)
    }
    return candidates.find(channel => canCreateInvite(channel, guild)) || null
}

async function createOwnerInvite(guild) {
    if (guild?.vanityURLCode) {
        return {
            url: `https://discord.gg/${guild.vanityURLCode}`,
            source: "vanity",
            created: false,
            expiresInSeconds: null,
            maxUses: null,
            channelId: null,
        }
    }

    const channel = findInviteChannel(guild)
    if (!channel) {
        const error = new Error("CURSED does not have Create Invite permission in an accessible server channel.")
        error.code = "OWNER_INVITE_PERMISSION_MISSING"
        throw error
    }

    const invite = await channel.createInvite({
        maxAge: OWNER_INVITE_MAX_AGE_SECONDS,
        maxUses: OWNER_INVITE_MAX_USES,
        unique: true,
        reason: OWNER_INVITE_REASON,
    })

    return {
        url: invite?.url || `https://discord.gg/${invite?.code}`,
        source: "created",
        created: true,
        expiresInSeconds: OWNER_INVITE_MAX_AGE_SECONDS,
        maxUses: OWNER_INVITE_MAX_USES,
        channelId: channel.id,
    }
}

function buildInviteReport(guild, result) {
    if (result.source === "vanity") {
        return `🔗 **${sanitizeInline(guild.name, 90)}**\nVanity invite: ${result.url}\nNo new invite was created.`
    }
    return `🔗 **${sanitizeInline(guild.name, 90)}**\n${result.url}\n` +
        `Created by CURSED in channel \`${sanitizeInline(result.channelId, 30)}\`.\n` +
        `Expires in **1 hour** • Maximum uses: **1** • Creation is visible in the server audit log.`
}

module.exports = {
    SERVER_PAGE_SIZE,
    MEMBER_PAGE_SIZE,
    OWNER_INVITE_MAX_AGE_SECONDS,
    OWNER_INVITE_MAX_USES,
    OWNER_INVITE_REASON,
    sanitizeInline,
    collectionValues,
    discordTimestamp,
    clampPage,
    ownerFromCache,
    fetchOwnerSummary,
    getCachedMemberBreakdown,
    buildServerListPages,
    buildServerInfo,
    resolveGuild,
    fetchMemberSnapshot,
    buildMemberPage,
    canCreateInvite,
    findInviteChannel,
    createOwnerInvite,
    buildInviteReport,
}
