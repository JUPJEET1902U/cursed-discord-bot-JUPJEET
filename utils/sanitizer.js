/**
 * utils/sanitizer.js
 * Comprehensive input/output sanitization for CURSED bot (Phase 14)
 * Extends sanitizeMentions with additional protections.
 */

const { sanitizeMentions } = require("./sanitizeMentions")
const logger = require("./logger")
const log = logger.child("Sanitizer")

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS = [
    /ignore (all |previous |above |prior )?instructions/i,
    /disregard (all |previous |above |prior )?instructions/i,
    /forget (all |previous |above |prior )?instructions/i,
    /you are now/i,
    /new (system |)prompt/i,
    /override (system|instructions|prompt)/i,
    /act as (if you are|a different|an? (evil|unrestricted|jailbroken))/i,
    /jailbreak/i,
    /DAN mode/i,
    /developer mode/i,
]

// Patterns that should never appear in AI output
const DANGEROUS_OUTPUT_PATTERNS = [
    /@everyone/gi,
    /@here/gi,
    /<@!?\d+>/g,
    /<@&\d+>/g,
    /<#\d+>/g,
    /\b\d{17,20}\b/g,  // raw Discord snowflake IDs
]

/**
 * Sanitize user input before sending to AI.
 * Detects prompt injection and strips dangerous content.
 * @param {string} input
 * @returns {{ safe: boolean, sanitized: string, reason?: string }}
 */
function sanitizeUserInput(input) {
    if (!input || typeof input !== "string") return { safe: true, sanitized: "" }

    // Check for prompt injection
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(input)) {
            log.warn(`Prompt injection attempt detected: "${input.slice(0, 80)}"`)
            return {
                safe: false,
                sanitized: input,
                reason: "Prompt injection attempt detected"
            }
        }
    }

    // Strip any Discord mentions from user input (they shouldn't be in AI context)
    const sanitized = sanitizeMentions(input)
    return { safe: true, sanitized }
}

/**
 * Sanitize AI output before sending to Discord.
 * Removes all mention-like patterns and raw IDs.
 * @param {string} output
 * @returns {string}
 */
function sanitizeAIOutput(output) {
    if (!output || typeof output !== "string") return ""

    let result = output

    // Use the existing sanitizeMentions for mention patterns
    result = sanitizeMentions(result)

    // Additionally strip raw snowflake IDs that might slip through
    result = result.replace(/\b(\d{17,20})\b/g, "[id]")

    // Truncate excessively long responses (safety valve)
    if (result.length > 2000) {
        result = result.slice(0, 1990) + "..."
        log.warn("AI output truncated to 2000 chars")
    }

    return result
}

/**
 * Sanitize a display name for safe use in messages.
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
    if (!name || typeof name !== "string") return "Unknown"
    return name
        .replace(/@everyone/gi, "everyone")
        .replace(/@here/gi, "here")
        .replace(/<@!?\d+>/g, "[user]")
        .replace(/<@&\d+>/g, "[role]")
        .replace(/<#\d+>/g, "[channel]")
        .slice(0, 32)
}

/**
 * Validate and clamp a numeric amount from user input.
 * @param {string|number} value
 * @param {number} min
 * @param {number} max
 * @returns {{ valid: boolean, amount: number }}
 */
function validateAmount(value, min = 1, max = 1_000_000) {
    const amount = parseInt(value)
    if (isNaN(amount)) return { valid: false, amount: 0 }
    if (amount < min) return { valid: false, amount: 0 }
    if (amount > max) return { valid: false, amount: 0 }
    return { valid: true, amount }
}

module.exports = { sanitizeUserInput, sanitizeAIOutput, sanitizeName, validateAmount }
