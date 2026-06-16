/**
 * commands/images.js
 * AI image analysis features (Phase 11)
 * Analyzes images attached to messages using AI vision capabilities.
 */

const { callAI } = require("../utils/ai")
const { checkCooldown } = require("../utils/cooldowns")
const { createSafeMessage } = require("../utils/sanitizeMentions")
const { sanitizeAIOutput, sanitizeName } = require("../utils/sanitizer")
const logger = require("../utils/logger")
const log = logger.child("Images")

/**
 * Attempt to analyze an image URL using the AI provider.
 * Returns null if the provider doesn't support vision.
 */
async function analyzeImageWithAI(imageUrl, prompt) {
    // Try Gemini first (better vision support via OpenAI-compatible API)
    const { gemini, GEMINI_MODEL } = require("../utils/ai")
    if (gemini) {
        try {
            const res = await gemini.chat.completions.create({
                model: GEMINI_MODEL,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: imageUrl } }
                        ]
                    }
                ],
                max_tokens: 500
            })
            return res.choices[0].message.content
        } catch (err) {
            log.warn(`Gemini vision failed: ${err.message}`)
        }
    }

    // Fallback: describe based on URL only (text-only AI)
    return null
}

async function handle(message) {
    const msgLower = message.content.toLowerCase().trim()
    const senderName = sanitizeName(message.member?.displayName || message.author.username)
    const userId = message.author.id

    if (!msgLower.startsWith("!analyze") && !msgLower.startsWith("!roastimage") && !msgLower.startsWith("!ocr")) {
        return false
    }

    const cd = checkCooldown(userId, "imageanalysis", 30 * 1000)
    if (!cd.ok) {
        await createSafeMessage(message.channel, `⏳ Wait **${cd.remaining}s** before analyzing another image.`)
        return true
    }

    // Get image from attachment or URL in message
    let imageUrl = null

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first()
        if (attachment.contentType?.startsWith("image/")) {
            imageUrl = attachment.url
        }
    }

    if (!imageUrl) {
        // Try to extract URL from message content
        const urlMatch = message.content.match(/https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)/i)
        if (urlMatch) imageUrl = urlMatch[0]
    }

    if (!imageUrl) {
        await createSafeMessage(message.channel,
            `🖼️ **Image Analysis**\n\nAttach an image or include an image URL with your command!\n\n` +
            `Commands:\n` +
            `\`!analyze\` — Describe what's in the image\n` +
            `\`!roastimage\` — Roast the image\n` +
            `\`!ocr\` — Extract text from the image`)
        return true
    }

    await createSafeMessage(message.channel, `🔍 Analyzing image...`)

    try {
        let prompt, successMsg

        if (msgLower.startsWith("!roastimage")) {
            prompt = `You are CURSED, a roast bot. Look at this image and roast it mercilessly but humorously. Be creative and funny. 2-3 sentences max. Never mention Discord IDs or mentions.`
            successMsg = "🔥 **Image Roast:**"
        } else if (msgLower.startsWith("!ocr")) {
            prompt = `Extract and transcribe ALL text visible in this image. Format it clearly. If there's no text, say so.`
            successMsg = "📝 **Text Extracted:**"
        } else {
            prompt = `Describe this image in detail. What do you see? Be specific about objects, people, colors, and context. 3-4 sentences.`
            successMsg = "🖼️ **Image Analysis:**"
        }

        const result = await analyzeImageWithAI(imageUrl, prompt)

        if (result) {
            const sanitized = sanitizeAIOutput(result)
            await createSafeMessage(message.channel, `${successMsg}\n\n${sanitized}`)
        } else {
            // Fallback: use text-only AI to acknowledge the image
            const fallback = await callAI([
                { role: "system", content: "You are CURSED. The user shared an image but you can't see it. Respond humorously about not being able to see it. 1-2 sentences." },
                { role: "user", content: `${senderName} shared an image and wants: ${msgLower}` }
            ], { maxTokens: 150 })
            await createSafeMessage(message.channel, `🖼️ ${sanitizeAIOutput(fallback.content)}\n\n*Note: Full image analysis requires Gemini API.*`)
        }
    } catch (err) {
        log.error(`Image analysis error: ${err.message}`)
        await createSafeMessage(message.channel, "❌ Image analysis failed. Make sure the image is publicly accessible!")
    }

    return true
}

module.exports = { handle }
