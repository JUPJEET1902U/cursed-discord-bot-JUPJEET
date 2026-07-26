const assert = require("node:assert/strict")
const fs = require("node:fs")
const { replySafe, SAFE_ALLOWED_MENTIONS } = require("../utils/mentionSanitizer")

async function run() {
    const replyPayloads = []
    const fallbackPayloads = []
    const message = {
        author: { id: "123456789012345678" },
        reply: async payload => {
            replyPayloads.push(payload)
            return { id: "reply-message" }
        },
        channel: {
            send: async payload => {
                fallbackPayloads.push(payload)
                return { id: "fallback-message" }
            },
        },
    }

    const result = await replySafe(message, "Hello <@123456789012345678> @everyone")
    assert.equal(result.id, "reply-message")
    assert.equal(replyPayloads.length, 1, "native Discord reply should be used first")
    assert.equal(fallbackPayloads.length, 0, "successful replies must not create duplicates")
    assert.equal(replyPayloads[0].failIfNotExists, false)
    assert.equal(replyPayloads[0].allowedMentions.repliedUser, true, "native reply should notify the replied author")
    assert.deepEqual(replyPayloads[0].allowedMentions.users, [], "no explicit user mention may be allowed in response text")
    assert.deepEqual(replyPayloads[0].allowedMentions.roles, [])
    assert.doesNotMatch(replyPayloads[0].content, /<@!?\d+>/)
    assert.doesNotMatch(replyPayloads[0].content, /@everyone/)

    const failedReplies = []
    const fallbackSends = []
    const missingReferenceMessage = {
        author: { id: "123456789012345678" },
        reply: async payload => {
            failedReplies.push(payload)
            throw new Error("Unknown Message")
        },
        channel: {
            send: async payload => {
                fallbackSends.push(payload)
                return { id: "fallback-only" }
            },
        },
    }

    const fallbackResult = await replySafe(missingReferenceMessage, "Fallback response")
    assert.equal(fallbackResult.id, "fallback-only")
    assert.equal(failedReplies.length, 1)
    assert.equal(fallbackSends.length, 1, "failed message references should create exactly one fallback")
    assert.deepEqual(fallbackSends[0].allowedMentions, SAFE_ALLOWED_MENTIONS)
    assert.equal(fallbackSends[0].allowedMentions.repliedUser, false, "normal fallback messages must not ping anyone")
    assert.deepEqual(fallbackSends[0].allowedMentions.users, [])

    await assert.rejects(
        () => replySafe(missingReferenceMessage, "No fallback", { fallbackToChannel: false }),
        /Unknown Message/
    )
    assert.equal(fallbackSends.length, 1, "disabled fallback must not send another message")

    const silentReplyPayloads = []
    const silentMessage = {
        ...message,
        reply: async payload => {
            silentReplyPayloads.push(payload)
            return { id: "silent-reply" }
        },
    }
    await replySafe(silentMessage, "Silent reply", { mentionAuthor: false })
    assert.equal(silentReplyPayloads[0].allowedMentions.repliedUser, false)

    const indexSource = fs.readFileSync(require.resolve("../index"), "utf8")
    assert.match(indexSource, /const \{ sendSafe, replySafe \} = require\("\.\/utils\/mentionSanitizer"\)/)
    assert.match(indexSource, /const \{ formatError \} = require\("\.\/utils\/errorFormatter"\)/)

    const aiStart = indexSource.indexOf("const botMentioned =")
    const aiEnd = indexSource.indexOf("async function shutdown")
    assert.ok(aiStart >= 0 && aiEnd > aiStart, "AI chat section must be discoverable")

    const aiSection = indexSource.slice(aiStart, aiEnd)
    assert.match(aiSection, /await replySafe\(message, safeOutput\)/)
    assert.match(aiSection, /formatError\(err, "ai-chat"/)
    assert.match(aiSection, /await replySafe\(message, userMessage\)/)
    assert.doesNotMatch(aiSection, /sendSafe\(message\.channel/)
    assert.doesNotMatch(aiSection, /<@\$\{userId\}>|<@!\$\{userId\}>/)

    console.log("AI native reply notification contracts passed")
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
