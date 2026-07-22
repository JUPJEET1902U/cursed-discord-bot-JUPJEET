const crypto = require("node:crypto")
const { AttachmentBuilder, EmbedBuilder } = require("discord.js")
const { checkCooldown } = require("./cooldowns")
const logger = require("./logger")

const log = logger.child("ImageGeneration")

const SAFE_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false }
const MAX_PROMPT_LENGTH = 500
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const GENERATION_TIMEOUT_MS = 90 * 1000
const LAST_REQUEST_TTL_MS = 6 * 60 * 60 * 1000
const IMAGE_COOLDOWN_MS = 30 * 1000
const NEGATIVE_PROMPT = "blurry, low quality, duplicate face, duplicate subject, deformed anatomy, distorted hands, unreadable text, watermark"

const lastRequests = new Map()
const activeGenerations = new Set()

class ImageGenerationError extends Error {
    constructor(code, message, status = null) {
        super(message)
        this.name = "ImageGenerationError"
        this.code = code
        this.status = status
    }
}

function requestKey(message) {
    return `${message.guild?.id || "dm"}:${message.author.id}`
}

function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
}

function stripDiscordMentions(value) {
    return normalizeWhitespace(
        String(value || "")
            .replace(/<@!?\d{17,20}>/g, " ")
            .replace(/@everyone|@here/gi, " ")
    )
}

function parseImagineRequest(message) {
    const raw = normalizeWhitespace(String(message.content || "").replace(/^!imagine\b/i, ""))
    const lowered = raw.toLowerCase()

    if (["retry", "again"].includes(lowered)) {
        return { ok: true, mode: "retry" }
    }

    const variationMatch = lowered.match(/^(variation|variations)(?:\s+(\d+))?$/)
    if (variationMatch) {
        const requested = Number(variationMatch[2] || (variationMatch[1] === "variation" ? 1 : 2))
        return { ok: true, mode: "variations", count: Math.max(1, Math.min(2, requested || 2)) }
    }

    const referenceUser = message.mentions?.users?.first?.() || null
    const prompt = stripDiscordMentions(raw).slice(0, MAX_PROMPT_LENGTH)

    if (referenceUser && !prompt) {
        return {
            ok: false,
            error: "Tell me what to create with that avatar. Example: `!imagine @user as a cyberpunk warrior`",
        }
    }

    if (!prompt) {
        return {
            ok: false,
            error: "Give me a real image prompt. Example: `!imagine a cursed cat riding a skateboard through neon rain`",
        }
    }

    return { ok: true, mode: "generate", prompt, referenceUser }
}

function enhanceImagePrompt(prompt, options = {}) {
    const cleaned = stripDiscordMentions(prompt).slice(0, MAX_PROMPT_LENGTH)
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length

    if (options.referenceImageUrl) {
        const referenceName = normalizeWhitespace(options.referenceName || "the referenced person").slice(0, 80)
        return [
            `Use the supplied reference image as the visual identity reference for ${referenceName}.`,
            "Preserve recognizable facial structure, hairstyle, skin tone, and important visual traits from the reference.",
            `Transform the subject according to this request: ${cleaned}.`,
            "Create one coherent subject with natural anatomy, detailed textures, intentional composition, and cinematic lighting.",
        ].join(" ")
    }

    if (wordCount <= 4) {
        return [
            `Create a polished and visually distinctive interpretation of: ${cleaned}.`,
            "Use a clear main subject, intentional composition, detailed textures, cinematic lighting, and a coherent background.",
        ].join(" ")
    }

    return `${cleaned}. High detail, coherent composition, balanced cinematic lighting, clean anatomy, detailed textures, and a visually distinct result.`
}

function createRandomSeed() {
    return crypto.randomInt(1, 2147483647)
}

function getPollinationsKey() {
    return process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY || null
}

function buildGenerationUrl({ prompt, seed, referenceImageUrl = null }) {
    const params = new URLSearchParams({
        model: referenceImageUrl ? "kontext" : "flux",
        width: "1024",
        height: "1024",
        seed: String(seed),
        enhance: "true",
        safe: "true",
    })

    if (referenceImageUrl) {
        params.set("image", referenceImageUrl)
    } else {
        params.set("negative_prompt", NEGATIVE_PROMPT)
    }

    return `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params.toString()}`
}

function buildLegacyGenerationUrl({ prompt, seed }) {
    const params = new URLSearchParams({
        model: "flux",
        width: "1024",
        height: "1024",
        seed: String(seed),
        enhance: "true",
        safe: "true",
        negative_prompt: NEGATIVE_PROMPT,
    })
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`
}

function extensionForContentType(contentType) {
    const normalized = String(contentType || "").toLowerCase()
    if (normalized.includes("png")) return "png"
    if (normalized.includes("webp")) return "webp"
    return "jpg"
}

async function downloadImage(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)
    timer.unref?.()

    const headers = {
        Accept: "image/png,image/jpeg,image/webp",
        "Cache-Control": "no-cache",
        "User-Agent": "CURSED-Discord-Bot/2.0",
    }
    const key = getPollinationsKey()
    if (key) headers.Authorization = `Bearer ${key}`

    try {
        const response = await fetch(url, { headers, signal: controller.signal })
        if (!response.ok) {
            throw new ImageGenerationError("provider_http", `Provider returned HTTP ${response.status}`, response.status)
        }

        const contentType = response.headers.get("content-type") || ""
        if (!contentType.toLowerCase().startsWith("image/")) {
            throw new ImageGenerationError("invalid_content", "Provider did not return an image")
        }

        const declaredLength = Number(response.headers.get("content-length") || 0)
        if (declaredLength > MAX_IMAGE_BYTES) {
            throw new ImageGenerationError("too_large", "Generated image is too large to upload")
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
            throw new ImageGenerationError("too_large", "Generated image is empty or too large to upload")
        }

        return { buffer, contentType }
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new ImageGenerationError("timeout", "Image provider timed out")
        }
        throw error
    } finally {
        clearTimeout(timer)
    }
}

async function generateImageAsset(request, options = {}) {
    const seed = options.seed || createRandomSeed()
    const variationNumber = Number(options.variationNumber || 0)
    const generationPrompt = variationNumber > 0
        ? `${request.enhancedPrompt} Create a clearly distinct variation with a different camera angle, composition, lighting, and background while preserving the requested subject.`
        : request.enhancedPrompt

    const primaryUrl = buildGenerationUrl({
        prompt: generationPrompt,
        seed,
        referenceImageUrl: request.referenceImageUrl,
    })

    let downloaded
    let provider = "pollinations-unified"
    try {
        downloaded = await downloadImage(primaryUrl)
    } catch (error) {
        if (request.referenceImageUrl) throw error
        log.warn(`Unified image endpoint failed; trying compatibility endpoint: ${error.message}`)
        downloaded = await downloadImage(buildLegacyGenerationUrl({ prompt: generationPrompt, seed }))
        provider = "pollinations-compatibility"
    }

    const extension = extensionForContentType(downloaded.contentType)
    return {
        buffer: downloaded.buffer,
        filename: `cursed-imagine-${seed}.${extension}`,
        seed,
        provider,
        variationNumber,
    }
}

function getAvatarReference(user) {
    if (!user || typeof user.displayAvatarURL !== "function") return null
    return user.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true })
}

function createStoredRequest(parsed) {
    const referenceImageUrl = getAvatarReference(parsed.referenceUser)
    const referenceName = parsed.referenceUser
        ? normalizeWhitespace(parsed.referenceUser.globalName || parsed.referenceUser.username || "Discord user")
        : null

    return {
        prompt: parsed.prompt,
        enhancedPrompt: enhanceImagePrompt(parsed.prompt, { referenceImageUrl, referenceName }),
        referenceImageUrl,
        referenceName,
        referenceUserId: parsed.referenceUser?.id || null,
        createdAt: Date.now(),
    }
}

function rememberRequest(key, request) {
    lastRequests.set(key, { ...request, createdAt: Date.now() })
}

function getRememberedRequest(key) {
    const request = lastRequests.get(key)
    if (!request) return null
    if (Date.now() - request.createdAt > LAST_REQUEST_TTL_MS) {
        lastRequests.delete(key)
        return null
    }
    return { ...request }
}

function compactPrompt(value) {
    const safe = normalizeWhitespace(value).replace(/`/g, "'")
    return safe.length > 900 ? `${safe.slice(0, 897)}...` : safe
}

async function deliverResult(message, loadingMessage, request, assets, options = {}) {
    const attachments = assets.map(asset => new AttachmentBuilder(asset.buffer, { name: asset.filename }))
    const embeds = assets.map((asset, index) => {
        const title = assets.length > 1 ? `🎨 Image Variation ${index + 1}` : "🎨 Image Generated"
        const mode = request.referenceImageUrl ? "Avatar reference" : "Text prompt"
        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle(title)
            .setDescription(`**Prompt**\n${compactPrompt(request.prompt)}`)
            .addFields(
                { name: "Mode", value: mode, inline: true },
                { name: "Seed", value: String(asset.seed), inline: true },
            )
            .setImage(`attachment://${asset.filename}`)
            .setFooter({
                text: request.referenceImageUrl
                    ? `Reference used: ${request.referenceName || "Discord avatar"}`
                    : "Use !imagine retry or !imagine variations",
            })
            .setTimestamp()
        return embed
    })

    const payload = {
        content: options.partialFailure ? "⚠️ One requested variation failed, so CURSED sent the successful result(s)." : "",
        embeds,
        files: attachments,
        allowedMentions: SAFE_MENTIONS,
    }

    try {
        await loadingMessage.edit(payload)
    } catch {
        await message.channel.send(payload)
        await loadingMessage.delete().catch(() => {})
    }
}

function userFacingError(error, request) {
    if (error?.code === "timeout") return "❌ Image generation timed out. Try again in a moment."
    if (error?.code === "too_large") return "❌ The generated image was too large for CURSED to upload safely."
    if (error?.status === 429) return "⏳ The image provider is busy or rate-limited. Wait a little and try again."
    if (request?.referenceImageUrl && [401, 402, 403].includes(error?.status)) {
        return "❌ Avatar-reference generation needs valid Pollinations access. Add or refresh `POLLINATIONS_API_KEY` on Railway; normal text images can still use the compatibility fallback."
    }
    if ([401, 402, 403].includes(error?.status)) {
        return "❌ The image provider rejected the request. Check the optional `POLLINATIONS_API_KEY` Railway variable."
    }
    return "❌ CURSED could not generate that image safely. Try a clearer prompt or try again later."
}

async function handleImagineCommand(message, options = {}) {
    const parsed = parseImagineRequest(message)
    if (!parsed.ok) {
        await message.channel.send({ content: parsed.error, allowedMentions: SAFE_MENTIONS })
        return true
    }

    const key = requestKey(message)
    if (activeGenerations.has(key)) {
        await message.channel.send({ content: "⏳ Your previous image is still generating.", allowedMentions: SAFE_MENTIONS })
        return true
    }

    let request
    if (parsed.mode === "retry" || parsed.mode === "variations") {
        request = getRememberedRequest(key)
        if (!request) {
            await message.channel.send({
                content: "ℹ️ You do not have a recent image request to reuse. Start with `!imagine <prompt>`.",
                allowedMentions: SAFE_MENTIONS,
            })
            return true
        }
    } else {
        request = createStoredRequest(parsed)
    }

    const cooldown = checkCooldown(message.author.id, "imagine", IMAGE_COOLDOWN_MS)
    if (!cooldown.ok) {
        await message.channel.send({
            content: `⏳ Wait **${cooldown.remaining}s** before generating another image.`,
            allowedMentions: SAFE_MENTIONS,
        })
        return true
    }

    activeGenerations.add(key)
    const loadingMessage = await message.channel.send({
        content: request.referenceImageUrl
            ? "🎨 Preparing an avatar-reference image..."
            : parsed.mode === "variations"
                ? "🎨 Creating fresh image variations..."
                : "🎨 Enhancing your prompt and generating the image...",
        allowedMentions: SAFE_MENTIONS,
    })

    try {
        const count = parsed.mode === "variations" ? parsed.count : 1
        const tasks = Array.from({ length: count }, (_, index) => generateImageAsset(request, {
            seed: createRandomSeed(),
            variationNumber: parsed.mode === "variations" ? index + 1 : 0,
        }))
        const settled = await Promise.allSettled(tasks)
        const assets = settled.filter(result => result.status === "fulfilled").map(result => result.value)
        const failures = settled.filter(result => result.status === "rejected")

        if (!assets.length) throw failures[0]?.reason || new ImageGenerationError("unknown", "No image returned")

        await deliverResult(message, loadingMessage, request, assets, { partialFailure: failures.length > 0 })
        rememberRequest(key, request)
        await options.onSuccess?.()
        return true
    } catch (error) {
        log.error(`Image generation failed: ${error.message}`, {
            code: error.code,
            status: error.status,
            guildId: message.guild?.id,
            userId: message.author.id,
            reference: Boolean(request.referenceImageUrl),
        })
        await loadingMessage.edit({ content: userFacingError(error, request), embeds: [], attachments: [] }).catch(async () => {
            await message.channel.send({ content: userFacingError(error, request), allowedMentions: SAFE_MENTIONS }).catch(() => {})
        })
        return true
    } finally {
        activeGenerations.delete(key)
    }
}

module.exports = {
    MAX_PROMPT_LENGTH,
    NEGATIVE_PROMPT,
    stripDiscordMentions,
    parseImagineRequest,
    enhanceImagePrompt,
    createRandomSeed,
    buildGenerationUrl,
    buildLegacyGenerationUrl,
    getAvatarReference,
    createStoredRequest,
    generateImageAsset,
    handleImagineCommand,
}
