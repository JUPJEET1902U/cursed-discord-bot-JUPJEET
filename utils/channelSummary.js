/**
 * On-demand channel history collection and transcript preparation for /summary.
 * Raw messages are never written to disk or MongoDB.
 */

const { sanitizeMentions } = require("./sanitizeMentions")
const { sanitizeName } = require("./sanitizer")

const MAX_MESSAGES = 200
const MAX_HOURS = 72
const MAX_TRANSCRIPT_CHARS = 48_000
const CHUNK_TARGET_CHARS = 9_000
const MAX_CHUNKS = 8

function parseMessageLink(value) {
    const match = String(value || "").match(
        /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/i
    )
    if (!match) return null
    return { guildId: match[1], channelId: match[2], messageId: match[3] }
}

function isSupportedTextChannel(channel) {
    return Boolean(
        channel &&
        typeof channel.isTextBased === "function" &&
        channel.isTextBased() &&
        channel.messages &&
        typeof channel.messages.fetch === "function"
    )
}

function extractSafeLinks(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s<>]+/gi) || []
    return [...new Set(matches.map(link => link.replace(/[),.;!?]+$/g, "")))].slice(0, 20)
}

function sanitizeTranscriptText(value, maxLength = 1800) {
    return sanitizeMentions(String(value || ""))
        .replace(/\u0000/g, "")
        .replace(/\b\d{17,20}\b/g, "[id]")
        .replace(/</g, "‹")
        .replace(/>/g, "›")
        .replace(/[\t ]+/g, " ")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim()
        .slice(0, maxLength)
}

function isCommandOnly(content) {
    const text = String(content || "").trim()
    if (!text) return false
    if (/^\/[a-z0-9_-]+(?:\s+\S+)*$/i.test(text)) return true
    if (/^![a-z0-9_-]+(?:\s+\S+){0,2}$/i.test(text) && text.length < 100) return true
    return false
}

function shouldIncludeMessage(message, botUserId = null) {
    if (!message || message.deleted) return false
    if (message.webhookId) return false
    if (message.system) return false
    if (message.author?.bot) return false
    if (botUserId && message.author?.id === botUserId) return false

    const content = String(message.content || "").trim()
    const attachmentCount = message.attachments?.size || 0
    if (!content && attachmentCount === 0) return false
    if (isCommandOnly(content) && attachmentCount === 0) return false
    return true
}

function messageTimestamp(message) {
    const value = Number(message?.createdTimestamp)
    return Number.isFinite(value) ? value : new Date(message?.createdAt || 0).getTime()
}

function formatTranscriptMessage(message) {
    const timestamp = new Date(messageTimestamp(message)).toISOString()
    const displayName = sanitizeName(
        message.member?.displayName ||
        message.author?.globalName ||
        message.author?.username ||
        "Unknown"
    )
    const content = sanitizeTranscriptText(message.content, 1800)
    const attachmentNames = message.attachments
        ? [...message.attachments.values()].map(item => sanitizeTranscriptText(item.name || "attachment", 120))
        : []

    const parts = []
    if (content) parts.push(content)
    if (attachmentNames.length) parts.push(`[Attachments: ${attachmentNames.join(", ")}]`)

    return `[${timestamp}] ${displayName}: ${parts.join(" ")}`
}

async function fetchMessagesOnDemand(channel, options = {}) {
    if (!isSupportedTextChannel(channel)) throw new Error("Unsupported text channel.")

    const requestedLimit = Math.min(MAX_MESSAGES, Math.max(1, Number(options.limit) || 50))
    const startTime = Number(options.startTime) || null
    const afterMessageId = options.afterMessageId ? String(options.afterMessageId) : null
    const botUserId = options.botUserId ? String(options.botUserId) : null

    const collected = []
    let before
    let exhausted = false
    let crossedStart = false
    let pages = 0

    while (collected.length < requestedLimit && pages < 10) {
        const batchLimit = Math.min(100, requestedLimit - collected.length + 30)
        const batch = await channel.messages.fetch({ limit: batchLimit, ...(before ? { before } : {}) })
        const values = [...batch.values()]
        pages += 1

        if (values.length === 0) {
            exhausted = true
            break
        }

        values.sort((a, b) => messageTimestamp(b) - messageTimestamp(a))
        const oldest = values[values.length - 1]
        before = oldest?.id

        for (const message of values) {
            const created = messageTimestamp(message)
            if (startTime && created < startTime) {
                crossedStart = true
                continue
            }
            if (afterMessageId && message.id === afterMessageId) continue
            if (!shouldIncludeMessage(message, botUserId)) continue
            collected.push(message)
            if (collected.length >= requestedLimit) break
        }

        if (startTime && messageTimestamp(oldest) < startTime) {
            crossedStart = true
            break
        }
        if (values.length < batchLimit) {
            exhausted = true
            break
        }
        if (!before) {
            exhausted = true
            break
        }
    }

    collected.sort((a, b) => messageTimestamp(a) - messageTimestamp(b))

    const truncatedByWindow = Boolean(
        startTime &&
        collected.length >= requestedLimit &&
        !crossedStart &&
        !exhausted
    )

    return {
        messages: collected.slice(-requestedLimit),
        truncated: truncatedByWindow,
        exhausted,
    }
}

function buildTranscript(messages) {
    const lines = []
    const links = []
    let used = 0
    let truncated = false
    let startTime = null
    let endTime = null

    // Prefer the most recent messages when the character budget is reached,
    // while restoring chronological order in the final transcript.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        const line = formatTranscriptMessage(message)
        if (!line) continue
        if (used + line.length + 1 > MAX_TRANSCRIPT_CHARS) {
            truncated = true
            break
        }
        lines.unshift(line)
        used += line.length + 1
        links.push(...extractSafeLinks(message.content))
        const created = messageTimestamp(message)
        startTime = created
        if (endTime === null) endTime = created
    }

    return {
        transcript: lines.join("\n"),
        links: [...new Set(links)].slice(0, 10),
        includedCount: lines.length,
        startTime,
        endTime,
        truncated,
    }
}

function chunkTranscript(transcript, targetChars = CHUNK_TARGET_CHARS) {
    const lines = String(transcript || "").split("\n").filter(Boolean)
    if (lines.length === 0) return []

    const chunks = []
    let current = []
    let size = 0

    for (const line of lines) {
        if (current.length > 0 && size + line.length + 1 > targetChars) {
            chunks.push(current.join("\n"))
            current = []
            size = 0
            if (chunks.length >= MAX_CHUNKS) break
        }
        current.push(line)
        size += line.length + 1
    }

    if (current.length && chunks.length < MAX_CHUNKS) chunks.push(current.join("\n"))
    return chunks
}

function parseStructuredSummary(value) {
    const sections = {
        overview: "",
        topics: "",
        decisions: "",
        actions: "",
        questions: "",
    }
    const labels = {
        OVERVIEW: "overview",
        MAIN_TOPICS: "topics",
        DECISIONS: "decisions",
        ACTION_ITEMS: "actions",
        UNANSWERED_QUESTIONS: "questions",
    }

    let current = null
    for (const rawLine of String(value || "").split("\n")) {
        const line = rawLine.trimEnd()
        const match = line.match(/^([A-Z_]+):\s*(.*)$/)
        if (match && labels[match[1]]) {
            current = labels[match[1]]
            if (match[2]) sections[current] += match[2]
            continue
        }
        if (current && line.trim()) {
            sections[current] += `${sections[current] ? "\n" : ""}${line}`
        }
    }

    if (!Object.values(sections).some(Boolean)) {
        sections.overview = String(value || "").trim()
    }

    return sections
}

module.exports = {
    MAX_MESSAGES,
    MAX_HOURS,
    MAX_TRANSCRIPT_CHARS,
    CHUNK_TARGET_CHARS,
    MAX_CHUNKS,
    parseMessageLink,
    isSupportedTextChannel,
    extractSafeLinks,
    sanitizeTranscriptText,
    isCommandOnly,
    shouldIncludeMessage,
    messageTimestamp,
    formatTranscriptMessage,
    fetchMessagesOnDemand,
    buildTranscript,
    chunkTranscript,
    parseStructuredSummary,
}
