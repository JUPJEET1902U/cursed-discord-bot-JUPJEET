const OpenAI = require("openai").default

const TIMEOUT_MS = 25_000  // 25 seconds per provider attempt

// ── Provider clients ───────────────────────────────────────────────────────────
const gemini = process.env.GEMINI_KEY ? new OpenAI({
    apiKey: process.env.GEMINI_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
}) : null

const groq = process.env.GROQ_KEY ? new OpenAI({
    apiKey: process.env.GROQ_KEY,
    baseURL: "https://api.groq.com/openai/v1"
}) : null

const openrouter = process.env.OPENROUTER_KEY ? new OpenAI({
    apiKey: process.env.OPENROUTER_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://cursed-bot.replit.app", "X-Title": "CURSED Bot" }
}) : null

const GEMINI_MODEL     = "gemini-2.0-flash"
const GROQ_MODEL       = "llama-3.1-8b-instant"
const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct"

let lastUsed = "none"

// ── Timeout wrapper ────────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Provider timed out")), ms)
        )
    ])
}

// ── Individual provider calls ──────────────────────────────────────────────────
async function callGemini(messages, maxTokens) {
    if (!gemini) throw new Error("Gemini not configured")
    const res = await withTimeout(
        gemini.chat.completions.create({ model: GEMINI_MODEL, messages, max_tokens: maxTokens }),
        TIMEOUT_MS
    )
    return { content: res.choices[0].message.content, provider: "gemini" }
}

async function callGroq(messages, maxTokens) {
    if (!groq) throw new Error("Groq not configured")
    const res = await withTimeout(
        groq.chat.completions.create({ model: GROQ_MODEL, messages, max_tokens: maxTokens }),
        TIMEOUT_MS
    )
    return { content: res.choices[0].message.content, provider: "groq" }
}

async function callOpenRouter(messages, maxTokens) {
    if (!openrouter) throw new Error("OpenRouter not configured")
    const res = await withTimeout(
        openrouter.chat.completions.create({ model: OPENROUTER_MODEL, messages, max_tokens: maxTokens }),
        TIMEOUT_MS
    )
    return { content: res.choices[0].message.content, provider: "openrouter" }
}

// ── Main entry — Gemini → Groq → OpenRouter ────────────────────────────────────
async function callAI(messages, options = {}) {
    const { maxTokens = 500 } = options
    const errors = []

    const chain = [
        { name: "Gemini",      fn: () => callGemini(messages, maxTokens)      },
        { name: "Groq",        fn: () => callGroq(messages, maxTokens)        },
        { name: "OpenRouter",  fn: () => callOpenRouter(messages, maxTokens)  },
    ]

    for (const { name, fn } of chain) {
        try {
            const result = await fn()
            lastUsed = result.provider
            console.log(`[AI] ${name} responded OK`)
            return result
        } catch (err) {
            // Derive a safe reason string — never log the raw key or full stack here
            const status = err.status ? `HTTP ${err.status}` : ""
            const reason = [status, err.message].filter(Boolean).join(" ")
            console.warn(`[AI] ${name} failed: ${reason}`)
            errors.push(`${name}: ${reason}`)
        }
    }

    throw new Error(`All AI providers failed — ${errors.join(" | ")}`)
}

function getStatus() {
    return {
        geminiConfigured:      !!gemini,
        groqConfigured:        !!groq,
        openRouterConfigured:  !!openrouter,
        lastUsed
    }
}

module.exports = { callAI, groq, gemini, GROQ_MODEL, GEMINI_MODEL, getStatus }
