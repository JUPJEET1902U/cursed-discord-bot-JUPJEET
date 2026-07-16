const test = require("node:test")
const assert = require("node:assert/strict")

const {
    sanitizeStoredText,
    parseKeywords,
    scoreEntry,
    looksLikeServerQuestion,
} = require("../utils/serverKnowledge")

const rulesEntry = {
    title: "Server Rules",
    category: "rules",
    keywords: ["rules", "spam", "harassment"],
    content: "No spam, harassment, or advertising without staff approval.",
}

test("sanitizes mass mentions and Discord mentions", () => {
    const value = sanitizeStoredText("@everyone hello <@123> <@&456> <#789>", 200)
    assert.equal(value, "everyone hello user-123 role-456 channel-789")
})

test("normalizes and deduplicates keywords", () => {
    assert.deepEqual(parseKeywords("Rules, spam, rules, EVENTS"), ["rules", "spam", "events"])
})

test("scores relevant entries above unrelated entries", () => {
    const relevant = scoreEntry("What are the server rules about spam?", rulesEntry)
    const unrelated = scoreEntry("When is the next tournament?", rulesEntry)
    assert.ok(relevant > unrelated)
    assert.ok(relevant >= 2)
})

test("detects likely server-information questions", () => {
    assert.equal(looksLikeServerQuestion("Who are the server moderators?"), true)
    assert.equal(looksLikeServerQuestion("Tell me a joke about cats"), false)
})
