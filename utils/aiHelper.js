/**
 * @fileoverview Centralized AI call helper for CURSED Bot.
 * Wraps utils/ai.js with logging, error handling, response validation,
 * and output sanitization. All commands should use this instead of
 * calling callAI directly.
 */

"use strict"

const { callAI, getStatus } = require("./ai")
const logger                = require("./logger")
const { sanitizeAIOutput, isValidAIResponse } = require("./inputValidator")

// ─── Typed AI Call ────────────────────────────────────────────────────────────

/**
 * Make an AI call with logging, validation, and sanitization.
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {object} [options]
 * @param {number}  [options.maxTokens=500]
 * @param {boolean} [options.preferGemini=false]
 * @param {boolean} [options.sanitize=true]   - Sanitize output for Discord
 * @param {string}  [options.context="AI"]    - Log context label
 * @returns {Promise<{ content: string, provider: string }>}
 * @throws {Error} if both providers fail
 */
async function ask(messages, options = {}) {
    const {
        maxTokens    = 500,
        preferGemini = false,
        sanitize     = true,
        context      = "AI",
    } = options

    try {
        const result = await callAI(messages, { maxTokens, preferGemini })

        if (!isValidAIResponse(result)) {
            throw new Error("AI returned an empty or invalid response")
        }

        logger.ai(result.provider, result.content)

        return {
            content:  sanitize ? sanitizeAIOutput(result.content) : result.content,
            provider: result.provider,
        }
    } catch (err) {
        logger.error(context, `AI call failed: ${err.message}`)
        throw err
    }
}

/**
 * Make an AI call and return only the content string.
 * Returns a fallback string on failure instead of throwing.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [options]
 * @param {string} [options.fallback="⚠️ AI is unavailable right now. Try again!"]
 * @returns {Promise<string>}
 */
async function askSafe(messages, options = {}) {
    const { fallback = "⚠️ AI is unavailable right now. Try again!", ...rest } = options
    try {
        const result = await ask(messages, rest)
        return result.content
    } catch (err) {
        if (err.status === 429) {
            return "⚠️ AI is rate limited right now. Try again in a moment!"
        }
        return fallback
    }
}

/**
 * Get current AI provider status.
 * @returns {{ groqConfigured: boolean, geminiConfigured: boolean, lastUsed: string, groqFailCount: number }}
 */
function getAIStatus() {
    return getStatus()
}

module.exports = { ask, askSafe, getAIStatus }
