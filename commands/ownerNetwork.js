const { createSafeMessage } = require("../utils/sanitizeMentions")
const logger = require("../utils/logger")
const {
    buildServerListPages,
    fetchOwnerSummary,
    buildServerInfo,
    resolveGuild,
    fetchMemberSnapshot,
    buildMemberPage,
    createOwnerInvite,
    buildInviteReport,
    clampPage,
} = require("../utils/ownerNetworkInspector")

const log = logger.child("OwnerNetwork")
const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)

const OWNER_NETWORK_COMMANDS = new Set([
    "!botservers",
    "!servers",
    "!serverinfo",
    "!servermembers",
    "!serverinvite",
    "!networkhelp",
])

function isBotOwnerId(userId, ownerIds = BOT_OWNER_IDS) {
    return ownerIds.includes(String(userId || ""))
}

function parseCommand(content) {
    const parts = String(content || "").trim().split(/\s+/).filter(Boolean)
    return {
        name: String(parts[0] || "").toLowerCase(),
        args: parts.slice(1),
    }
}

function splitDiscordContent(value, maxLength = 1900) {
    const text = String(value || "")
    if (text.length <= maxLength) return [text]

    const chunks = []
    let current = ""
    for (const line of text.split("\n")) {
        const addition = `${line}\n`
        if (addition.length > maxLength) {
            if (current) {
                chunks.push(current.trimEnd())
                current = ""
            }
            for (let index = 0; index < line.length; index += maxLength) {
                chunks.push(line.slice(index, index + maxLength))
            }
            continue
        }
        if ((current + addition).length > maxLength) {
            chunks.push(current.trimEnd())
            current = addition
        } else {
            current += addition
        }
    }
    if (current.trim()) chunks.push(current.trimEnd())
    return chunks.filter(Boolean)
}

async function sendOwnerDm(message, contents, acknowledgement = "✅ I sent the private CURSED network report to your DMs.") {
    const payloads = Array.isArray(contents) ? contents : [contents]
    try {
        for (const rawContent of payloads) {
            for (const content of splitDiscordContent(rawContent)) {
                await message.author.send({
                    content,
                    allowedMentions: SAFE_MENTIONS,
                })
            }
        }
        await createSafeMessage(message.channel, acknowledgement)
        return true
    } catch (error) {
        log.warn(`Could not DM owner ${message.author.id}: ${error.message}`)
        await createSafeMessage(
            message.channel,
            "❌ I couldn't send you a DM. Enable direct messages for this server and try again."
        )
        return false
    }
}

function usageText() {
    return [
        "🛰️ **CURSED Network Inspector — Owner Only**",
        "",
        "`!botservers [page]` — private server list with member/channel/role counts",
        "`!serverinfo <server-id>` — full server information",
        "`!servermembers <server-id> [page]` — private paginated member list",
        "`!serverinvite <server-id>` — vanity link or one-use one-hour invite when CURSED has permission",
        "`!networkhelp` — this help message",
        "",
        "All sensitive results are sent only to the configured bot owner's DMs.",
    ].join("\n")
}

async function handle(message) {
    const { name, args } = parseCommand(message.content)
    if (!OWNER_NETWORK_COMMANDS.has(name)) return false

    if (!isBotOwnerId(message.author.id)) {
        await createSafeMessage(message.channel, "🔒 This command is restricted to the CURSED bot owner.")
        return true
    }

    if (name === "!networkhelp") {
        await sendOwnerDm(message, usageText())
        return true
    }

    if (name === "!botservers" || name === "!servers") {
        const guilds = [...message.client.guilds.cache.values()]
        const pages = buildServerListPages(guilds, message.client.user?.username || "CURSED")
        const page = clampPage(args[0], pages.length)
        await sendOwnerDm(
            message,
            pages[page - 1],
            `✅ I sent CURSED server list page **${page}/${pages.length}** to your DMs.`
        )
        return true
    }

    const guildId = args[0]
    if (!guildId) {
        await sendOwnerDm(message, `Usage: \`${name} <server-id>${name === "!servermembers" ? " [page]" : ""}\``)
        return true
    }

    const guild = await resolveGuild(message.client, guildId)
    if (!guild) {
        const safeId = String(guildId).replace(/`/g, "").slice(0, 30)
        await sendOwnerDm(message, `❌ CURSED could not find a server with ID \`${safeId}\` in its current guild list.`)
        return true
    }

    if (name === "!serverinfo") {
        try {
            await guild.fetch?.()
        } catch {}
        const owner = await fetchOwnerSummary(guild)
        await sendOwnerDm(message, buildServerInfo(guild, owner))
        return true
    }

    if (name === "!servermembers") {
        const snapshot = await fetchMemberSnapshot(guild)
        const memberPage = buildMemberPage(guild, snapshot, args[1])
        await sendOwnerDm(
            message,
            memberPage.content,
            `✅ I sent member page **${memberPage.page}/${memberPage.totalPages}** to your DMs.`
        )
        return true
    }

    if (name === "!serverinvite") {
        try {
            const result = await createOwnerInvite(guild)
            await sendOwnerDm(
                message,
                buildInviteReport(guild, result),
                "✅ I sent the private server invite result to your DMs."
            )
        } catch (error) {
            log.warn(`Owner invite unavailable for guild ${guild.id}: ${error.message}`)
            await sendOwnerDm(
                message,
                `❌ **Invite unavailable for ${String(guild.name || "that server").replace(/@/g, "＠").slice(0, 90)}**\n${String(error.message || "CURSED could not create an invite.").replace(/@/g, "＠").slice(0, 300)}`
            )
        }
        return true
    }

    return false
}

module.exports = {
    handle,
    isBotOwnerId,
    parseCommand,
    splitDiscordContent,
    usageText,
    OWNER_NETWORK_COMMANDS,
}
