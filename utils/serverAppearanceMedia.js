const dns = require("dns").promises
const net = require("net")

const REMOTE_IMAGE_TIMEOUT_MS = 5_000
const MAX_REMOTE_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_INLINE_IMAGE_BYTES = 170 * 1024
const MAX_REDIRECTS = 3
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif"])

function isPrivateAddress(address) {
    const value = String(address || "").toLowerCase().split("%")[0]
    const version = net.isIP(value)
    if (version === 4) {
        const [a, b] = value.split(".").map(Number)
        return a === 0
            || a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19))
            || a >= 224
    }
    if (version === 6) {
        if (["::", "::1"].includes(value)) return true
        if (value.startsWith("fc") || value.startsWith("fd")) return true
        if (/^fe[89ab]/.test(value)) return true
        if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7))
    }
    return false
}

async function validateRemoteImageUrl(value, options = {}) {
    const text = String(value || "").trim()
    if (!text || text.length > 2048) return false

    let url
    try { url = new URL(text) } catch { return false }
    if (url.protocol !== "https:" || url.username || url.password) return false

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false
    if (net.isIP(hostname)) return !isPrivateAddress(hostname)

    const lookup = options.lookup || dns.lookup
    try {
        const records = await lookup(hostname, { all: true, verbatim: true })
        const list = Array.isArray(records) ? records : [records]
        return list.length > 0 && list.every(record => record?.address && !isPrivateAddress(record.address))
    } catch {
        return false
    }
}

function sniffMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
    if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif"
    return null
}

function parseInlineImage(value) {
    const match = String(value || "").match(/^data:(image\/(?:jpeg|png|gif));base64,([A-Za-z0-9+/=]+)$/)
    if (!match) throw Object.assign(new Error("Use a JPG, PNG, or GIF image."), { code: "INVALID_IMAGE_DATA" })
    const buffer = Buffer.from(match[2], "base64")
    if (!buffer.length || buffer.length > MAX_INLINE_IMAGE_BYTES) {
        throw Object.assign(new Error("Uploaded image is too large after optimization."), { code: "IMAGE_TOO_LARGE" })
    }
    const detected = sniffMime(buffer)
    if (!detected || detected !== match[1]) {
        throw Object.assign(new Error("Uploaded image data does not match its file type."), { code: "INVALID_IMAGE_DATA" })
    }
    return buffer
}

async function readBoundedBody(response, maxBytes) {
    const declaredLength = Number(response.headers?.get?.("content-length") || 0)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw Object.assign(new Error("Remote image exceeds the size limit."), { code: "IMAGE_TOO_LARGE" })
    }

    if (response.body?.getReader) {
        const reader = response.body.getReader()
        const chunks = []
        let total = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = Buffer.from(value)
            total += chunk.length
            if (total > maxBytes) {
                await reader.cancel().catch(() => {})
                throw Object.assign(new Error("Remote image exceeds the size limit."), { code: "IMAGE_TOO_LARGE" })
            }
            chunks.push(chunk)
        }
        return Buffer.concat(chunks, total)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw Object.assign(new Error("Remote image exceeds the size limit."), { code: "IMAGE_TOO_LARGE" })
    return buffer
}

async function fetchRemoteImage(value, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    const lookup = options.lookup || dns.lookup
    const timeoutMs = Math.max(250, Math.min(10_000, Number(options.timeoutMs) || REMOTE_IMAGE_TIMEOUT_MS))
    const maxBytes = Math.max(64 * 1024, Math.min(4 * 1024 * 1024, Number(options.maxBytes) || MAX_REMOTE_IMAGE_BYTES))
    if (typeof fetchImpl !== "function") throw Object.assign(new Error("Remote image fetching is unavailable."), { code: "IMAGE_FETCH_UNAVAILABLE" })

    let current = String(value || "").trim()
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        if (!(await validateRemoteImageUrl(current, { lookup }))) {
            throw Object.assign(new Error("Use a public HTTPS image URL."), { code: "INVALID_IMAGE_URL" })
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        timer.unref?.()
        try {
            const response = await fetchImpl(current, {
                signal: controller.signal,
                redirect: "manual",
                headers: { Accept: "image/png,image/jpeg,image/gif" },
            })
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers?.get?.("location")
                if (!location || redirect === MAX_REDIRECTS) throw Object.assign(new Error("Image URL redirected too many times."), { code: "IMAGE_REDIRECT_LIMIT" })
                current = new URL(location, current).toString()
                continue
            }
            if (!response.ok) throw Object.assign(new Error("The remote image could not be downloaded."), { code: "IMAGE_FETCH_FAILED" })

            const contentType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase()
            if (!ALLOWED_MIME_TYPES.has(contentType)) throw Object.assign(new Error("Use a JPG, PNG, or GIF image."), { code: "INVALID_IMAGE_TYPE" })
            const buffer = await readBoundedBody(response, maxBytes)
            const detected = sniffMime(buffer)
            if (!detected || detected !== contentType) throw Object.assign(new Error("Remote image content does not match its file type."), { code: "INVALID_IMAGE_DATA" })
            return buffer
        } catch (err) {
            if (err?.name === "AbortError") throw Object.assign(new Error("Image download timed out."), { code: "IMAGE_FETCH_TIMEOUT" })
            throw err
        } finally {
            clearTimeout(timer)
        }
    }
    throw Object.assign(new Error("Image could not be resolved."), { code: "IMAGE_FETCH_FAILED" })
}

async function resolveAppearanceImage(value, options = {}) {
    const text = String(value || "").trim()
    if (!text) throw Object.assign(new Error("Choose an image first."), { code: "IMAGE_REQUIRED" })
    if (text.startsWith("data:")) return parseInlineImage(text)
    return fetchRemoteImage(text, options)
}

module.exports = {
    ALLOWED_MIME_TYPES,
    MAX_INLINE_IMAGE_BYTES,
    MAX_REMOTE_IMAGE_BYTES,
    isPrivateAddress,
    validateRemoteImageUrl,
    sniffMime,
    parseInlineImage,
    fetchRemoteImage,
    resolveAppearanceImage,
}
