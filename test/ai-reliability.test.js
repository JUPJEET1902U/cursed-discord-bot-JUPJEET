const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")

const ROOT = path.resolve(__dirname, "..")
const calls = { gemini: [], groq: [], openrouter: [] }
const queues = { gemini: [], groq: [], openrouter: [] }

function providerFromBaseUrl(baseURL = "") {
    if (baseURL.includes("generativelanguage")) return "gemini"
    if (baseURL.includes("groq.com")) return "groq"
    return "openrouter"
}

class FakeOpenAI {
    constructor(options = {}) {
        const provider = providerFromBaseUrl(options.baseURL)
        this.chat = {
            completions: {
                create: async (payload) => {
                    calls[provider].push(payload)
                    const next = queues[provider].shift()
                    if (typeof next === "function") return next(payload)
                    if (next instanceof Error) throw next
                    if (next) return next
                    return response(`${provider} default response with enough detail.`)
                },
            },
        }
    }
}

function response(content) {
    return { choices: [{ message: { content } }], usage: { total_tokens: 10 } }
}

function providerError(status, message, headers = {}) {
    const error = new Error(message)
    error.status = status
    error.headers = headers
    return error
}

process.env.GEMINI_KEY = "test-gemini"
process.env.GROQ_KEY = "test-groq"
process.env.OPENROUTER_KEY = "test-openrouter"
process.env.AI_GEMINI_MODEL = "gemini-test-model"
process.env.AI_GROQ_MODEL = "groq-test-model"
process.env.AI_OPENROUTER_MODEL = "openrouter-test-model"

const originalLoad = Module._load
let ai
try {
    Module._load = function aiReliabilityLoader(request, parent, isMain) {
        if (request === "openai") return { default: FakeOpenAI }
        if (request === "./botKnowledge" && /ai(?:Legacy|ConversationQuality)?\.js$/.test(parent?.filename || "")) {
            return { buildBotKnowledgeContext: () => "" }
        }
        if (request === "./aiPhase3" && /ai(?:Legacy|ConversationQuality)?\.js$/.test(parent?.filename || "")) {
            return {
                AI_CHAT_MAX_CHARS: 500,
                analyzeRequestedOutputLength: () => ({ oversized: false }),
                buildLengthLimitReply: () => "limited",
                extractExplicitConstraints: () => [],
                classifyIntelligenceLevel: () => "standard",
                getLevelTokenBudget: () => 700,
                buildPhase3Instruction: () => "",
                assessPhase3Response: () => [],
                compactToCharacterLimit: (value, max) => String(value).slice(0, max),
            }
        }
        return originalLoad.call(this, request, parent, isMain)
    }
    delete require.cache[require.resolve(path.join(ROOT, "utils", "ai.js"))]
    ai = require(path.join(ROOT, "utils", "ai.js"))
} finally {
    Module._load = originalLoad
}

function reset() {
    for (const key of Object.keys(calls)) calls[key].length = 0
    for (const key of Object.keys(queues)) queues[key].length = 0
    ai.resetProviderStateForTests()
}

test("Railway model variables override safe defaults", () => {
    assert.equal(ai.GEMINI_MODEL, "gemini-test-model")
    assert.equal(ai.GROQ_MODEL, "groq-test-model")
    assert.equal(ai.OPENROUTER_MODEL, "openrouter-test-model")
    assert.deepEqual(ai.getStatus().models, {
        gemini: "gemini-test-model",
        groq: "groq-test-model",
        openrouter: "openrouter-test-model",
    })
})

test("Retry-After supports seconds, dates and millisecond headers", () => {
    const now = Date.parse("2026-08-06T12:00:00Z")
    assert.equal(ai.parseRetryAfterMs(providerError(429, "limited", { "retry-after": "2.5" }), now), 2500)
    assert.equal(ai.parseRetryAfterMs(providerError(429, "limited", { "retry-after-ms": "750" }), now), 750)
    assert.equal(
        ai.parseRetryAfterMs(providerError(429, "limited", { "retry-after": "Thu, 06 Aug 2026 12:00:03 GMT" }), now),
        3000
    )
})

test("retry delays use exponential backoff, jitter and Retry-After", () => {
    const plain = providerError(500, "temporary")
    assert.equal(ai.calculateRetryDelayMs(plain, 0, { baseDelayMs: 400, maxDelayMs: 5000, randomFn: () => 0 }), 400)
    assert.equal(ai.calculateRetryDelayMs(plain, 2, { baseDelayMs: 400, maxDelayMs: 5000, randomFn: () => 0 }), 1600)
    const limited = providerError(429, "limited", { "retry-after": "4" })
    assert.equal(ai.calculateRetryDelayMs(limited, 0, { baseDelayMs: 400, maxDelayMs: 5000, randomFn: () => 0 }), 4000)
})

test("repeated 429 failures cool Gemini down and the next call skips it", async () => {
    reset()
    queues.gemini.push(
        providerError(429, "rate limited", { "retry-after-ms": "1" }),
        providerError(429, "rate limited", { "retry-after-ms": "1" })
    )
    queues.groq.push(response("Groq fallback response with useful detail."), response("Groq second response with useful detail."))
    const delays = []

    const first = await ai.callAI([{ role: "user", content: "test" }], {
        smart: false,
        providerOrder: ["gemini", "groq", "openrouter"],
        retries: 1,
        sleepFn: async ms => delays.push(ms),
        randomFn: () => 0,
        totalTimeoutMs: 5000,
    })
    assert.equal(first.provider, "groq")
    assert.equal(calls.gemini.length, 2)
    assert.equal(delays.length, 1)

    const second = await ai.callAI([{ role: "user", content: "test again" }], {
        smart: false,
        providerOrder: ["gemini", "groq", "openrouter"],
        retries: 0,
        totalTimeoutMs: 5000,
    })
    assert.equal(second.provider, "groq")
    assert.equal(calls.gemini.length, 2)

    const status = ai.getStatus().providerStats
    assert.equal(status.gemini.rateLimits, 2)
    assert.equal(status.gemini.cooldowns, 1)
    assert.equal(status.gemini.skippedCooldown, 1)
    assert.equal(status.groq.fallbackSuccess, 2)
})

test("provider statistics include latency, empty responses and fallback attempts", async () => {
    reset()
    queues.gemini.push(response(""))
    queues.groq.push(response("Fallback answer with enough useful detail."))
    const result = await ai.callAI([{ role: "user", content: "test empty response" }], {
        smart: false,
        providerOrder: ["gemini", "groq", "openrouter"],
        retries: 0,
        totalTimeoutMs: 5000,
    })
    assert.equal(result.provider, "groq")
    const status = ai.getStatus().providerStats
    assert.equal(status.gemini.emptyResponses, 1)
    assert.equal(status.groq.fallbackAttempts, 1)
    assert.equal(status.groq.fallbackSuccess, 1)
    assert.equal(typeof status.groq.averageLatencyMs, "number")
})

test("one total deadline covers retries, fallback and repair", async () => {
    reset()
    queues.gemini.push(() => new Promise(resolve => setTimeout(() => resolve(response("late")), 100)))
    await assert.rejects(
        ai.callAI([{ role: "user", content: "deadline" }], {
            smart: false,
            providerOrder: ["gemini", "groq", "openrouter"],
            retries: 0,
            timeoutMs: 1000,
            totalTimeoutMs: 15,
        }),
        error => error?.code === "AI_TOTAL_TIMEOUT"
    )
    assert.equal(calls.groq.length, 0)
})

test("irrelevant memory is removed instead of injecting top-ranked personal facts", () => {
    const system = [
        "SYSTEM",
        "",
        "WHAT YOU KNOW ABOUT THIS USER:",
        "- [type=preference importance=5 confidence=1 lastConfirmed=2026-08-01] Loves Punjabi music",
        "- [type=project importance=5 confidence=1 lastConfirmed=2026-08-01] Builds a Discord bot",
        "",
        "SERVER-SPECIFIC INSTRUCTIONS:",
        "Be concise",
    ].join("\n")
    const unrelated = ai.filterMemoryContext(system, "Explain photosynthesis")
    assert.doesNotMatch(unrelated, /Punjabi music|Discord bot/)
    const relevant = ai.filterMemoryContext(system, "Help with my Discord bot")
    assert.match(relevant, /Builds a Discord bot/)
})

test("short follow-ups inherit the prior topic and receive explicit continuity guidance", () => {
    const messages = [
        { role: "system", content: "RELIABILITY AND REASONING RULES" },
        { role: "user", content: "Jupjeet: Debug this MongoDB connection error" },
        { role: "assistant", content: "The connection is opening twice." },
        { role: "user", content: "Jupjeet: why?" },
    ]
    assert.equal(ai.classifyShortFollowUp("Jupjeet: why?"), "why")
    assert.equal(ai.resolveConversationIntent(messages), "technical")
    const prepared = ai.prepareSmartMessages(messages, "technical", {
        complexity: { score: 0, wordCount: 1 },
        constraints: [],
        maxResponseChars: 500,
    })
    assert.match(prepared[0].content, /SHORT FOLLOW-UP: WHY/)
    assert.match(prepared[0].content, /preceding context/i)
})

test("continue and explain follow-ups do not restart the conversation", () => {
    assert.match(
        ai.buildShortFollowUpInstruction("continue"),
        /Do not restart, recap, or repeat/i
    )
    assert.match(
        ai.buildShortFollowUpInstruction("clarify"),
        /simpler, more explicit language/i
    )
})

test("AI orchestration never sends Discord replies during retries or repair", () => {
    const aiSource = ["ai.js", "aiProviderReliability.js", "aiConversationQuality.js"]
        .map(file => fs.readFileSync(path.join(ROOT, "utils", file), "utf8"))
        .join("\n")
    const indexSource = fs.readFileSync(path.join(ROOT, "index.js"), "utf8")
    assert.doesNotMatch(aiSource, /replySafe\(|message\.reply\(|channel\.send\(/)
    assert.ok(indexSource.indexOf("const result = await callAI") < indexSource.indexOf("await replySafe(message, safeOutput)"))
    assert.match(aiSource, /requestId/)
    assert.match(aiSource, /const result = await executeProviderChain/)
})

test("English-only prompts, Premium limits, memory persistence and provider order stay untouched", () => {
    const promptSource = fs.readFileSync(path.join(ROOT, "utils", "prompts.js"), "utf8")
    const premiumSource = fs.readFileSync(path.join(ROOT, "utils", "premium.js"), "utf8")
    const memorySource = fs.readFileSync(path.join(ROOT, "utils", "memory.js"), "utf8")
    assert.match(promptSource, /Always respond in English only/)
    assert.match(premiumSource, /aiReplyCooldownMs/)
    assert.match(memorySource, /short_term_memories|ShortTermMemory/)
    assert.deepEqual(ai.DEFAULT_PROVIDER_ORDER, ["gemini", "groq", "openrouter"])
})

test("package exposes the focused AI reliability test command", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    assert.equal(packageJson.scripts["test:ai-reliability"], "node --test test/ai-reliability.test.js")
})
