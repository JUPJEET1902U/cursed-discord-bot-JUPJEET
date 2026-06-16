/**
 * Sanitization utility to prevent Discord mention abuse.
 * 
 * Protects against:
 * - @everyone pings
 * - @here pings
 * - User mentions (<@ID>, <@!ID>)
 * - Role mentions (<@&ID>)
 * - Channel mentions (<#ID>)
 * 
 * Uses zero-width spaces to break mention syntax while keeping text readable.
 */

/**
 * Sanitize text to prevent Discord mention triggers.
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text safe from mention parsing
 */
function sanitizeMentions(text) {
    if (!text) return ""

    return String(text)
        // @everyone → @​everyone (zero-width space between @ and everyone)
        .replace(/@everyone/gi, "@\u200Beveryone")
        // @here → @​here (zero-width space between @ and here)
        .replace(/@here/gi, "@\u200Bhere")
        // <@ID> and <@!ID> (user mentions) → [user]
        .replace(/<@!?\d+>/g, "[user]")
        // <@&ID> (role mentions) → [role]
        .replace(/<@&\d+>/g, "[role]")
        // <#ID> (channel mentions) → [channel]
        .replace(/<#\d+>/g, "[channel]")
}

/**
 * Validate response content is non-empty, safe, and properly sized.
 * @param {string} content - Content to validate
 * @returns {string} - Validated, non-empty, sanitized content
 */
function validateResponse(content) {
    // Ensure content is non-null and non-empty
    if (!content || !String(content).trim()) {
        return "Sorry, I couldn't generate a response right now. Try asking something else."
    }

    // Trim whitespace and enforce Discord 2000 character limit
    // (leave 100 chars buffer for safety)
    return String(content).trim().slice(0, 1900)
}

/**
 * Create a safe Discord message object with full mention protection.
 * 
 * Applies:
 * - Mention sanitization
 * - Response validation
 * - Discord allowedMentions restrictions
 * - Character limit enforcement
 * 
 * @param {string} content - Message content
 * @returns {object} - Safe Discord message object ready to send
 */
function createSafeMessage(content) {
    // Validate and cap length
    const validated = validateResponse(content)
    
    // Sanitize mention syntax
    const sanitized = sanitizeMentions(validated)

    return {
        content: sanitized,
        allowedMentions: {
            parse: [],        // Don't parse any mentions
            users: [],        // Don't mention any users
            roles: [],        // Don't mention any roles
            repliedUser: false // Don't mention replied-to user
        }
    }
}

/**
 * Safely send a message to a Discord channel with full protections.
 * @param {Discord.Message|Discord.TextChannel} target - Message or channel to send to
 * @param {string} content - Message content
 * @returns {Promise<Discord.Message>} - Sent message
 */
async function sendSafeMessage(target, content) {
    if (!target) throw new Error("Invalid target for sendSafeMessage")
    
    const safeMsg = createSafeMessage(content)
    
    // Handle both Message and TextChannel targets
    if (target.reply && typeof target.reply === "function") {
        // Discord Message object with reply() method
        return await target.reply(safeMsg).catch(err => {
            console.error("Failed to reply:", err.message)
            throw err
        })
    } else if (target.send && typeof target.send === "function") {
        // Discord Channel object with send() method
        return await target.send(safeMsg).catch(err => {
            console.error("Failed to send:", err.message)
            throw err
        })
    } else {
        throw new Error("Target must be a Discord Message or Channel")
    }
}

module.exports = {
    sanitizeMentions,
    validateResponse,
    createSafeMessage,
    sendSafeMessage
}
