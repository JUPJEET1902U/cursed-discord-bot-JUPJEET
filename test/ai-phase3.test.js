const assert = require("node:assert/strict")
const fs = require("node:fs")

const {
    AI_CHAT_MAX_CHARS,
    analyzeRequestedOutputLength,
    buildLengthLimitReply,
    extractExplicitConstraints,
    classifyIntelligenceLevel,
    getLevelTokenBudget,
    buildPhase3Instruction,
    assessConstraintViolations,
    assessPhase3Response,
    compactToCharacterLimit,
} = require("../utils/aiPhase3")
const {
    callAI,
    getStatus,
    isSmartConversation,
    prepareSmartMessages,
} = require("../utils/ai")

async function run() {
    assert.equal(AI_CHAT_MAX_CHARS, 500)

    const oversizedWords = analyzeRequestedOutputLength("Write an essay of 2000 words about friendship.")
    assert.equal(oversizedWords.oversized, true)
    assert.equal(oversizedWords.count, 2000)
    assert.equal(oversizedWords.unit, "words")
    assert.equal(analyzeRequestedOutputLength("Write a 60 word summary.").oversized, false)
    assert.equal(analyzeRequestedOutputLength("I have 2000 coins.").oversized, false)

    const limitReply = buildLengthLimitReply(oversizedWords)
    assert.ok(limitReply.length <= AI_CHAT_MAX_CHARS)
    assert.match(limitReply, /concise version|outline/i)

    const constraints = extractExplicitConstraints(
        "Keep Railway, do not change economy, and use exactly three providers."
    )
    assert.equal(constraints.some(item => item.type === "forbid" && /economy/i.test(item.target)), true)
    assert.equal(constraints.some(item => /Railway/i.test(item.text)), true)
    assert.equal(constraints.some(item => /three providers/i.test(item.text)), true)

    assert.equal(classifyIntelligenceLevel("yo", "casual", { score: 0, wordCount: 1 }), "quick")
    assert.equal(classifyIntelligenceLevel("Explain this feature", "factual", { score: 1, wordCount: 3 }), "standard")
    assert.equal(classifyIntelligenceLevel("Debug and redesign this safely", "technical", { score: 3, wordCount: 5 }), "expert")
    assert.equal(getLevelTokenBudget("quick") < getLevelTokenBudget("expert"), true)

    const expertInstruction = buildPhase3Instruction({
        input: "Debug this and do not change economy",
        intent: "technical",
        complexity: { score: 3, wordCount: 7 },
        constraints,
    })
    assert.match(expertInstruction, /PHASE 3 ADAPTIVE INTELLIGENCE — EXPERT/)
    assert.match(expertInstruction, /500 characters or fewer/)
    assert.match(expertInstruction, /do not change economy/i)

    assert.equal(assessConstraintViolations("Change economy to fix it.", constraints).length > 0, true)
    assert.equal(assessConstraintViolations("Do not change economy.", constraints).length, 0)
    assert.equal(assessPhase3Response("x".repeat(501), { maxChars: 500 }).length > 0, true)
    assert.equal(assessPhase3Response("A useful short reply.", { maxChars: 500 }).length, 0)

    const compacted = compactToCharacterLimit("Sentence one. ".repeat(50), 500)
    assert.ok(compacted.length <= 500)
    assert.match(compacted, /…$/)

    const smartMessages = prepareSmartMessages([
        { role: "system", content: "RELIABILITY AND REASONING RULES" },
        { role: "user", content: "Debug this issue and do not change economy." },
    ], "technical", {
        complexity: { score: 3, wordCount: 8 },
        constraints: extractExplicitConstraints("Do not change economy."),
        maxResponseChars: 500,
    })
    assert.match(smartMessages[0].content, /PHASE 3 ADAPTIVE INTELLIGENCE/)
    assert.match(smartMessages[0].content, /AI CHAT OUTPUT POLICY/)

    const policyResult = await callAI([
        { role: "system", content: "RELIABILITY AND REASONING RULES" },
        { role: "user", content: "Write an essay of 2000 words about artificial intelligence." },
    ])
    assert.equal(policyResult.provider, "policy")
    assert.equal(policyResult.policyLimited, true)
    assert.ok(policyResult.content.length <= 500)

    assert.equal(isSmartConversation([{ role: "system", content: "Output ONLY valid JSON" }]), false)
    assert.equal(getStatus().aiChatMaxChars, 500)

    const aiSource = fs.readFileSync(require.resolve("../utils/ai"), "utf8")
    assert.match(aiSource, /const maxResponseChars = smart \? AI_CHAT_MAX_CHARS : null/)
    assert.match(aiSource, /phase3-response-policy/)
    assert.match(aiSource, /compactToCharacterLimit/)

    const indexSource = fs.readFileSync(require.resolve("../index"), "utf8")
    assert.ok(indexSource.indexOf("dispatchCommand(message, commandModules)") < indexSource.indexOf("const botMentioned"))
    assert.doesNotMatch(indexSource, /AI_CHAT_MAX_CHARS/)

    console.log("AI Intelligence Phase 3 contracts passed")
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
