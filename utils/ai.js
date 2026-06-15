const OpenAI = require("openai").default
const logger  = require("./logger")
const { AI }  = require("../config/constants")

const groq = new OpenAI({
    apiKey:  process.env.GROQ_KEY || "not-needed",
    baseURL: "https://api.groq.com/openai/v1",
})

const gemini = process.env.GEMINI_KEY ? new OpenAI({
    apiKey:  process.env.GEMINI_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
}) : null

const GROQ_MODEL   = AI.GROQ_MODEL
const GEMINI_MODEL = AI.GEMINI_MODEL

let lastUsed      = "groq"
let groqFailCount = 0

async function callGroq(messages, maxTokens) {
    const res = await groq.chat.completions.create({ model: GROQ_MODEL, messages, max_tokens: maxTokens })
    return { content: res.choices[0].message.content, provider: "groq" }
}

async function callGemini(messages, maxTokens) {
    if (!gemini) throw new Error("Gemini not configured")
    const res = await gemini.chat.completions.create({ model: GEMINI_MODEL, messages, max_tokens: maxTokens })
    return { content: res.choices[0].message.content, provider: "gemini" }
}

async function callAI(messages, options = {}) {
    const { maxTokens = AI.DEFAULT_MAX_TOKENS, preferGemini = false } = options

    if (preferGemini && gemini) {
        try {
            const result = await callGemini(messages, maxTokens)
            lastUsed = "gemini"
            groqFailCount = 0
            return result
        } catch (err) {
            logger.warn("AI", `Gemini failed, falling back to Groq: ${err.message}`)
        }
    }

    if (groqFailCount >= AI.GROQ_FAIL_THRESHOLD && gemini) {
        try {
            const result = await callGemini(messages, maxTokens)
            lastUsed = "gemini"
            return result
        } catch {
            groqFailCount = 0
        }
    }

    try {
        const result = await callGroq(messages, maxTokens)
        lastUsed = "groq"
        groqFailCount = 0
        return result
    } catch (err) {
        if (gemini && (err.status === 429 || err.code === "rate_limit_exceeded" || err.message?.includes("rate"))) {
            groqFailCount++
            logger.warn("AI", `Groq rate limited (${groqFailCount}), switching to Gemini: ${err.message}`)
            try {
                const result = await callGemini(messages, maxTokens)
                lastUsed = "gemini"
                return result
            } catch (geminiErr) {
                logger.error("AI", `Both AI providers failed: ${geminiErr.message}`)
                throw geminiErr
            }
        }
        throw err
    }
}

function getStatus() {
    return {
        groqConfigured: !!process.env.GROQ_KEY,
        geminiConfigured: !!gemini,
        lastUsed,
        groqFailCount
    }
}

module.exports = { callAI, groq, gemini, GROQ_MODEL, GEMINI_MODEL, getStatus }
