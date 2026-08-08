const OpenAI = require("openai").default

function firstEnv(names = []) {
    for (const name of names) {
        const value = String(process.env[name] || "").trim()
        if (value) return value
    }
    return null
}

function readModelEnv(names, fallback) {
    return (firstEnv(names) || fallback).slice(0, 160)
}

const geminiKey = firstEnv(["GEMINI_KEY", "GEMINI_API_KEY"])
const groqKey = firstEnv(["GROQ_KEY", "GROQ_API_KEY"])
const openrouterKey = firstEnv(["OPENROUTER_KEY", "OPENROUTER_API_KEY"])

const gemini = geminiKey ? new OpenAI({
    apiKey: geminiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
}) : null

const groq = groqKey ? new OpenAI({
    apiKey: groqKey,
    baseURL: "https://api.groq.com/openai/v1",
}) : null

const openrouter = openrouterKey ? new OpenAI({
    apiKey: openrouterKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": process.env.DASHBOARD_URL || "https://cursed-discord-bot-dashboard.vercel.app",
        "X-Title": "CURSED Discord Bot",
    },
}) : null

const GEMINI_MODEL = readModelEnv(["AI_GEMINI_MODEL", "GEMINI_MODEL"], "gemini-2.0-flash")
const GROQ_MODEL = readModelEnv(["AI_GROQ_MODEL", "GROQ_MODEL"], "llama-3.1-8b-instant")
const OPENROUTER_MODEL = readModelEnv(["AI_OPENROUTER_MODEL", "OPENROUTER_MODEL"], "mistralai/mistral-7b-instruct")

const PROVIDERS = Object.freeze({
    gemini: Object.freeze({ client: gemini, model: GEMINI_MODEL, label: "Gemini" }),
    groq: Object.freeze({ client: groq, model: GROQ_MODEL, label: "Groq" }),
    openrouter: Object.freeze({ client: openrouter, model: OPENROUTER_MODEL, label: "OpenRouter" }),
})

module.exports = {
    gemini,
    groq,
    openrouter,
    GEMINI_MODEL,
    GROQ_MODEL,
    OPENROUTER_MODEL,
    PROVIDERS,
}
