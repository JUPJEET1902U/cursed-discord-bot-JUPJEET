const OpenAI = require("openai").default

const openai = new OpenAI({
    apiKey: process.env.GROQ_KEY,
    baseURL: "https://api.groq.com/openai/v1"
})

module.exports = openai
