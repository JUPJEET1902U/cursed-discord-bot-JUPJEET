const test = require("node:test")
const assert = require("node:assert/strict")

const {
    parseMessageLink,
    sanitizeTranscriptText,
    shouldIncludeMessage,
    buildTranscript,
    chunkTranscript,
    parseStructuredSummary,
} = require("../utils/channelSummary")

function fakeMessage(id, timestamp, content, options = {}) {
    return {
        id,
        createdTimestamp: timestamp,
        content,
        deleted: false,
        webhookId: options.webhookId || null,
        system: false,
        author: {
            id: options.authorId || `user-${id}`,
            username: options.username || `User${id}`,
            bot: Boolean(options.bot),
        },
        member: { displayName: options.username || `User${id}` },
        attachments: new Map(),
    }
}

test("parses same-server Discord message links", () => {
    assert.deepEqual(
        parseMessageLink("https://discord.com/channels/111/222/333"),
        { guildId: "111", channelId: "222", messageId: "333" }
    )
    assert.equal(parseMessageLink("https://example.com/channels/111/222/333"), null)
})

test("sanitizes mentions and raw snowflake IDs in transcript text", () => {
    const value = sanitizeTranscriptText("@everyone hello <@123456789012345678> 123456789012345678", 500)
    assert.equal(value.includes("@everyone"), false)
    assert.equal(value.includes("123456789012345678"), false)
})

test("filters bot, webhook, and command-only messages", () => {
    assert.equal(shouldIncludeMessage(fakeMessage("1", 1, "hello")), true)
    assert.equal(shouldIncludeMessage(fakeMessage("2", 2, "hello", { bot: true })), false)
    assert.equal(shouldIncludeMessage(fakeMessage("3", 3, "hello", { webhookId: "webhook" })), false)
    assert.equal(shouldIncludeMessage(fakeMessage("4", 4, "!balance")), false)
})

test("builds a chronological transcript and coverage timestamps", () => {
    const messages = [
        fakeMessage("1", 1000, "first"),
        fakeMessage("2", 2000, "second https://example.com/info"),
    ]
    const result = buildTranscript(messages)
    assert.match(result.transcript, /first[\s\S]*second/)
    assert.deepEqual(result.links, ["https://example.com/info"])
    assert.equal(result.includedCount, 2)
    assert.equal(result.startTime, 1000)
    assert.equal(result.endTime, 2000)
})

test("chunks transcripts without losing line order", () => {
    const transcript = ["one", "two", "three", "four"].join("\n")
    const chunks = chunkTranscript(transcript, 8)
    assert.ok(chunks.length > 1)
    assert.equal(chunks.join("\n"), transcript)
})

test("parses structured AI summary sections", () => {
    const parsed = parseStructuredSummary([
        "OVERVIEW: Quick recap",
        "MAIN_TOPICS:",
        "• Launch planning",
        "DECISIONS: Ship Friday",
        "ACTION_ITEMS: Test the bot",
        "UNANSWERED_QUESTIONS: Who posts the announcement?",
    ].join("\n"))
    assert.equal(parsed.overview, "Quick recap")
    assert.match(parsed.topics, /Launch planning/)
    assert.equal(parsed.decisions, "Ship Friday")
})
