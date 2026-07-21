const moderation = require("./moderation")
const advanced = require("./moderationAdvanced")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const SNOWFLAKE = /^\d{17,20}$/
const FOUNDATION_COMMANDS = new Set([
    "warn", "warnings", "clearwarns", "timeout", "mute", "untimeout", "unmute",
    "kick", "ban", "unban", "case", "cases",
])
const ADVANCED_COMMANDS = new Set([
    "lock", "unlock", "slowmode", "nickname", "tempban", "softban", "note", "history",
])
const CASE_ACTIONS = new Set([
    "WARN", "CLEAR_WARNINGS", "TIMEOUT", "UNTIMEOUT", "MUTE", "UNMUTE", "KICK", "BAN",
    "UNBAN", "TEMPBAN", "SOFTBAN", "PURGE", "LOCK", "UNLOCK", "SLOWMODE", "NICKNAME",
    "NOTE", "ANTI_SPAM", "ANTI_LINK", "ANTI_INVITE",
])

function tokenizeArguments(input) {
    const tokens = []
    const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g
    const text = String(input || "")
    let match
    while ((match = pattern.exec(text))) {
        const token = match[1] ?? match[2] ?? match[3] ?? ""
        tokens.push(token.replace(/\\([\\"'])/g, "$1"))
    }
    return tokens
}

function parseDurationToMinutes(input, maxMinutes = 40320) {
    const match = String(input || "").trim().toLowerCase().match(/^(\d+)(m|h|d|w)?$/)
    if (!match) return null
    const amount = Number(match[1])
    const unit = match[2] || "m"
    const multiplier = unit === "m" ? 1 : unit === "h" ? 60 : unit === "d" ? 1440 : 10080
    const minutes = amount * multiplier
    return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= maxMinutes ? minutes : null
}

function parseInteger(input, min, max) {
    const value = Number(input)
    return Number.isInteger(value) && value >= min && value <= max ? value : null
}

function looksLikeUserToken(token) {
    const id = String(token || "").replace(/[<@!>]/g, "")
    return SNOWFLAKE.test(id)
}

function looksLikeChannelToken(token) {
    const raw = String(token || "")
    const id = raw.replace(/[<#>]/g, "")
    return raw.startsWith("<#") && SNOWFLAKE.test(id)
}

async function resolveUser(message, token) {
    const id = String(token || "").replace(/[<@!>]/g, "")
    if (!SNOWFLAKE.test(id)) return null
    const cached = message.mentions?.users?.get?.(id) || message.client?.users?.cache?.get?.(id) || null
    if (cached) return cached
    if (typeof message.client?.users?.fetch !== "function") return null
    return message.client.users.fetch(id).catch(() => null)
}

async function resolveChannel(message, token) {
    const id = String(token || "").replace(/[<#>]/g, "")
    if (!SNOWFLAKE.test(id)) return null
    const cached = message.mentions?.channels?.get?.(id) || message.guild?.channels?.cache?.get?.(id) || null
    if (cached) return cached
    if (typeof message.guild?.channels?.fetch !== "function") return null
    return message.guild.channels.fetch(id).catch(() => null)
}

function makeFailure(prefix, usage, message = null) {
    return {
        ok: false,
        error: message || `Usage: \`${prefix}${usage}\``,
    }
}

async function parsePrefixInvocation(message, canonicalContent, prefix) {
    const match = String(canonicalContent || "").trim().match(/^!(\S+)(?:\s+([\s\S]*))?$/)
    if (!match) return null
    const commandName = match[1].toLowerCase()
    const args = tokenizeArguments(match[2] || "")

    if (commandName === "warn") {
        const user = await resolveUser(message, args[0])
        const reason = args.slice(1).join(" ").trim()
        if (!user || !reason) return makeFailure(prefix, "warn @user <reason>")
        return { ok: true, target: "foundation", commandName, options: { user, reason } }
    }

    if (commandName === "warnings") {
        const user = await resolveUser(message, args[0])
        if (!user) return makeFailure(prefix, "warnings @user")
        return { ok: true, target: "foundation", commandName, options: { user } }
    }

    if (commandName === "clearwarns") {
        const user = await resolveUser(message, args[0])
        if (!user) return makeFailure(prefix, "clearwarns @user [reason]")
        return { ok: true, target: "foundation", commandName, options: { user, reason: args.slice(1).join(" ").trim() || null } }
    }

    if (commandName === "timeout" || commandName === "mute") {
        const user = await resolveUser(message, args[0])
        if (!user) return makeFailure(prefix, `${commandName} @user [10m|2h|1d] [reason]`)
        const duration = parseDurationToMinutes(args[1])
        const reasonStart = duration ? 2 : 1
        return {
            ok: true,
            target: "foundation",
            commandName,
            options: { user, duration, reason: args.slice(reasonStart).join(" ").trim() || null },
        }
    }

    if (commandName === "untimeout" || commandName === "unmute") {
        const user = await resolveUser(message, args[0])
        if (!user) return makeFailure(prefix, `${commandName} @user [reason]`)
        return { ok: true, target: "foundation", commandName, options: { user, reason: args.slice(1).join(" ").trim() || null } }
    }

    if (commandName === "kick" || commandName === "ban") {
        const user = await resolveUser(message, args[0])
        const reason = args.slice(1).join(" ").trim()
        if (!user || !reason) return makeFailure(prefix, `${commandName} @user <reason>`)
        return {
            ok: true,
            target: "foundation",
            commandName,
            options: { user, reason, delete_days: commandName === "ban" ? 0 : null },
        }
    }

    if (commandName === "unban") {
        const userId = String(args[0] || "").replace(/[<@!>]/g, "")
        if (!SNOWFLAKE.test(userId)) return makeFailure(prefix, "unban <user ID> [reason]")
        return { ok: true, target: "foundation", commandName, options: { user_id: userId, reason: args.slice(1).join(" ").trim() || null } }
    }

    if (commandName === "case") {
        const subcommand = String(args[0] || "").toLowerCase()
        const number = parseInteger(args[1], 1, Number.MAX_SAFE_INTEGER)
        if (!["view", "reason", "revoke", "delete"].includes(subcommand) || !number) {
            return makeFailure(prefix, "case view|reason|revoke|delete <number> [reason]")
        }
        const reason = args.slice(2).join(" ").trim() || null
        if (subcommand === "reason" && !reason) return makeFailure(prefix, "case reason <number> <new reason>")
        return { ok: true, target: "foundation", commandName, options: { subcommand, number, reason } }
    }

    if (commandName === "cases") {
        let user = null
        let action = null
        let limit = null
        for (const token of args) {
            if (!user && looksLikeUserToken(token)) {
                user = await resolveUser(message, token)
                if (!user) return makeFailure(prefix, "cases [@user] [action] [limit]", "❌ I could not resolve that user.")
                continue
            }
            const upper = token.toUpperCase()
            if (!action && CASE_ACTIONS.has(upper)) {
                action = upper
                continue
            }
            if (limit === null) {
                const parsed = parseInteger(token, 1, 20)
                if (parsed) {
                    limit = parsed
                    continue
                }
            }
            return makeFailure(prefix, "cases [@user] [action] [limit]")
        }
        return { ok: true, target: "foundation", commandName, options: { user, action, limit } }
    }

    if (commandName === "lock" || commandName === "unlock") {
        let channel = null
        let reasonStart = 0
        if (looksLikeChannelToken(args[0])) {
            channel = await resolveChannel(message, args[0])
            if (!channel) return makeFailure(prefix, `${commandName} [#channel] [reason]`, "❌ I could not resolve that channel.")
            reasonStart = 1
        }
        return { ok: true, target: "advanced", commandName, options: { channel, reason: args.slice(reasonStart).join(" ").trim() || null } }
    }

    if (commandName === "slowmode") {
        const seconds = parseInteger(args[0], 0, 21600)
        if (seconds === null) return makeFailure(prefix, "slowmode <0-21600> [#channel] [reason]")
        let channel = null
        let reasonStart = 1
        if (looksLikeChannelToken(args[1])) {
            channel = await resolveChannel(message, args[1])
            if (!channel) return makeFailure(prefix, "slowmode <0-21600> [#channel] [reason]", "❌ I could not resolve that channel.")
            reasonStart = 2
        }
        return { ok: true, target: "advanced", commandName, options: { seconds, channel, reason: args.slice(reasonStart).join(" ").trim() || null } }
    }

    if (commandName === "nickname") {
        const user = await resolveUser(message, args[0])
        if (!user || !args[1]) return makeFailure(prefix, 'nickname @user <nickname|reset> [reason] (quote multi-word nicknames)')
        const requested = args[1]
        const nickname = ["reset", "clear", "none"].includes(requested.toLowerCase()) ? null : requested
        return { ok: true, target: "advanced", commandName, options: { user, nickname, reason: args.slice(2).join(" ").trim() || null } }
    }

    if (commandName === "tempban") {
        const user = await resolveUser(message, args[0])
        const duration = args[1]
        if (!user || !duration || parseDurationToMinutes(duration, 525600) === null) return makeFailure(prefix, "tempban @user <30m|2h|7d|2w> [reason]")
        return { ok: true, target: "advanced", commandName, options: { user, duration, reason: args.slice(2).join(" ").trim() || null, evidence: null } }
    }

    if (commandName === "softban") {
        const user = await resolveUser(message, args[0])
        if (!user) return makeFailure(prefix, "softban @user [delete days 0-7] [reason]")
        const deleteDays = parseInteger(args[1], 0, 7)
        const reasonStart = deleteDays === null ? 1 : 2
        return {
            ok: true,
            target: "advanced",
            commandName,
            options: { user, delete_days: deleteDays, reason: args.slice(reasonStart).join(" ").trim() || null, evidence: null },
        }
    }

    if (commandName === "note") {
        const user = await resolveUser(message, args[0])
        const text = args.slice(1).join(" ").trim()
        if (!user || !text) return makeFailure(prefix, "note @user <private note>")
        return { ok: true, target: "advanced", commandName, options: { user, text, evidence: null } }
    }

    if (commandName === "history") {
        const user = await resolveUser(message, args[0])
        const limit = args[1] ? parseInteger(args[1], 1, 20) : null
        if (!user || (args[1] && limit === null)) return makeFailure(prefix, "history @user [1-20]")
        return { ok: true, target: "advanced", commandName, options: { user, limit } }
    }

    return null
}

function normalizePayload(payload) {
    const body = typeof payload === "string" ? { content: payload } : { ...(payload || {}) }
    delete body.ephemeral
    if (!body.allowedMentions) body.allowedMentions = SAFE_MENTIONS
    return body
}

function createOptions(values) {
    const read = (name, required = false) => {
        const value = values[name]
        if (required && (value === null || value === undefined || value === "")) {
            throw new Error(`Missing required option: ${name}`)
        }
        return value ?? null
    }
    return {
        getUser: read,
        getString: read,
        getInteger: read,
        getBoolean: read,
        getChannel: read,
        getRole: read,
        getAttachment: read,
        getSubcommand: (required = true) => read("subcommand", required),
    }
}

function createSyntheticInteraction(message, commandName, values) {
    let deferred = false
    let replied = false

    const send = async (payload, useReply = true) => {
        const body = normalizePayload(payload)
        if (useReply && typeof message.reply === "function") {
            const response = await message.reply(body).catch(() => null)
            if (response) return response
        }
        return message.channel.send(body)
    }

    return {
        isChatInputCommand: () => true,
        inGuild: () => true,
        commandName,
        guild: message.guild,
        guildId: message.guild.id,
        channel: message.channel,
        channelId: message.channel.id,
        member: message.member,
        memberPermissions: message.member.permissions,
        user: message.author,
        options: createOptions(values),
        get deferred() { return deferred },
        get replied() { return replied },
        async reply(payload) {
            replied = true
            return send(payload, true)
        },
        async deferReply() {
            deferred = true
            return null
        },
        async editReply(payload) {
            replied = true
            return send(payload, true)
        },
        async followUp(payload) {
            return send(payload, false)
        },
    }
}

async function handleModerationPrefix(message, canonicalContent, prefix) {
    const parsed = await parsePrefixInvocation(message, canonicalContent, prefix)
    if (!parsed) return false
    if (!parsed.ok) {
        await message.reply({ content: parsed.error, allowedMentions: SAFE_MENTIONS }).catch(() =>
            message.channel.send({ content: parsed.error, allowedMentions: SAFE_MENTIONS }).catch(() => null)
        )
        return true
    }

    const interaction = createSyntheticInteraction(message, parsed.commandName, parsed.options)
    return parsed.target === "advanced"
        ? advanced.handleInteraction(interaction)
        : moderation.handleInteraction(interaction)
}

module.exports = {
    FOUNDATION_COMMANDS,
    ADVANCED_COMMANDS,
    CASE_ACTIONS,
    tokenizeArguments,
    parseDurationToMinutes,
    parseInteger,
    parsePrefixInvocation,
    createSyntheticInteraction,
    handleModerationPrefix,
}
