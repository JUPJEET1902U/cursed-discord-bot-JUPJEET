/**
 * utils/welcomeCard.js
 * Premium PNG welcome-card generation backed by @napi-rs/canvas.
 * Remote images are validated, bounded, and fetched with a hard timeout.
 */

const dns = require("dns").promises
const net = require("net")
const { createCanvas, loadImage } = require("@napi-rs/canvas")
const { isGuildPremium } = require("./premium")

const WIDTH = 1000
const HEIGHT = 420
const IMAGE_TIMEOUT_MS = 5_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3
const DEFAULT_ACCENT = "#5865F2"

const THEMES = Object.freeze({
    classic: {
        background: ["#111827", "#1F2937"], panel: "rgba(17, 24, 39, 0.82)",
        text: "#FFFFFF", muted: "#D1D5DB", accent: "#5865F2", glow: "rgba(88, 101, 242, 0.42)",
    },
    modern: {
        background: ["#0F172A", "#0F766E"], panel: "rgba(15, 23, 42, 0.78)",
        text: "#F8FAFC", muted: "#CCFBF1", accent: "#2DD4BF", glow: "rgba(45, 212, 191, 0.42)",
    },
    minimal: {
        background: ["#F8FAFC", "#E2E8F0"], panel: "rgba(255, 255, 255, 0.9)",
        text: "#0F172A", muted: "#475569", accent: "#334155", glow: "rgba(51, 65, 85, 0.2)",
    },
    glass: {
        background: ["#312E81", "#0F766E"], panel: "rgba(255, 255, 255, 0.16)",
        text: "#FFFFFF", muted: "#E0E7FF", accent: "#A5B4FC", glow: "rgba(165, 180, 252, 0.5)",
    },
    dark: {
        background: ["#030712", "#111827"], panel: "rgba(3, 7, 18, 0.9)",
        text: "#F9FAFB", muted: "#9CA3AF", accent: "#6B7280", glow: "rgba(156, 163, 175, 0.32)",
    },
    purple: {
        background: ["#2E1065", "#701A75"], panel: "rgba(46, 16, 101, 0.76)",
        text: "#FFFFFF", muted: "#F5D0FE", accent: "#D946EF", glow: "rgba(217, 70, 239, 0.5)",
    },
    neon: {
        background: ["#12001F", "#111827"], panel: "rgba(17, 24, 39, 0.74)",
        text: "#FFFFFF", muted: "#E9D5FF", accent: "#22D3EE", glow: "rgba(34, 211, 238, 0.58)",
    },
    gold: {
        background: ["#1C1917", "#78350F"], panel: "rgba(28, 25, 23, 0.82)",
        text: "#FFFBEB", muted: "#FDE68A", accent: "#F59E0B", glow: "rgba(245, 158, 11, 0.5)",
    },
    // Retained for existing guild configurations.
    midnight: {
        background: ["#020617", "#172554"], panel: "rgba(2, 6, 23, 0.84)",
        text: "#F8FAFC", muted: "#CBD5E1", accent: "#60A5FA", glow: "rgba(96, 165, 250, 0.42)",
    },
})

const SUPPORTED_THEMES = Object.freeze(Object.keys(THEMES))

function normalizeTheme(theme) {
    const value = String(theme || "").toLowerCase()
    return THEMES[value] ? value : "classic"
}

function normalizeHex(value, fallback = DEFAULT_ACCENT) {
    if (typeof value !== "string") return fallback
    const raw = value.trim().replace(/^#/, "")
    return /^[0-9A-Fa-f]{6}$/.test(raw) ? `#${raw.toUpperCase()}` : fallback
}

function isPrivateAddress(address) {
    const value = String(address || "").toLowerCase().split("%")[0]
    const version = net.isIP(value)
    if (version === 4) {
        const parts = value.split(".").map(Number)
        const [a, b] = parts
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
    if (!["http:", "https:"].includes(url.protocol)) return false
    if (url.username || url.password) return false

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        return false
    }

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

async function readBoundedBody(response, maxBytes) {
    const declaredLength = Number(response.headers?.get?.("content-length") || 0)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error("Remote image exceeds the size limit")
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
                throw new Error("Remote image exceeds the size limit")
            }
            chunks.push(chunk)
        }
        return Buffer.concat(chunks, total)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error("Remote image exceeds the size limit")
    return buffer
}

async function fetchRemoteImage(value, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    const loadImageImpl = options.loadImageImpl || loadImage
    const lookup = options.lookup || dns.lookup
    const timeoutMs = Math.max(250, Math.min(15_000, Number(options.timeoutMs) || IMAGE_TIMEOUT_MS))
    const maxBytes = Math.max(64 * 1024, Math.min(16 * 1024 * 1024, Number(options.maxBytes) || MAX_IMAGE_BYTES))
    if (typeof fetchImpl !== "function") return null

    let current = String(value || "").trim()
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        if (!(await validateRemoteImageUrl(current, { lookup }))) return null

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        timer.unref?.()
        try {
            const response = await fetchImpl(current, {
                signal: controller.signal,
                redirect: "manual",
                headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8" },
            })

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers?.get?.("location")
                if (!location || redirect === MAX_REDIRECTS) return null
                current = new URL(location, current).toString()
                continue
            }
            if (!response.ok) return null

            const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase()
            if (!contentType.startsWith("image/")) return null

            const buffer = await readBoundedBody(response, maxBytes)
            return await loadImageImpl(buffer)
        } catch {
            return null
        } finally {
            clearTimeout(timer)
        }
    }
    return null
}

function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
}

function drawCoverImage(ctx, image, x, y, width, height) {
    const sourceRatio = image.width / image.height
    const targetRatio = width / height
    let sx = 0, sy = 0, sw = image.width, sh = image.height
    if (sourceRatio > targetRatio) {
        sw = image.height * targetRatio
        sx = (image.width - sw) / 2
    } else {
        sh = image.width / targetRatio
        sy = (image.height - sh) / 2
    }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height)
}

function truncateText(ctx, text, maxWidth) {
    if (!text) return ""
    let output = String(text)
    if (ctx.measureText(output).width <= maxWidth) return output
    while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1)
    return `${output}…`
}

function drawGradientBackground(ctx, theme) {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    gradient.addColorStop(0, theme.background[0])
    gradient.addColorStop(1, theme.background[1])
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    ctx.save()
    ctx.globalAlpha = 0.2
    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(870, 15, 210, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(80, 430, 180, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
}

function drawCircularImage(ctx, image, x, y, size, options = {}) {
    const accent = options.accent || DEFAULT_ACCENT
    ctx.save()
    ctx.shadowColor = options.glow || "rgba(0, 0, 0, 0.4)"
    ctx.shadowBlur = options.shadowBlur || 20
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2 + (options.border || 7), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    if (image) drawCoverImage(ctx, image, x, y, size, size)
    else {
        ctx.fillStyle = "#374151"
        ctx.fillRect(x, y, size, size)
        ctx.fillStyle = "#D1D5DB"
        ctx.font = `700 ${Math.round(size * 0.4)}px Arial`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("?", x + size / 2, y + size / 2)
    }
    ctx.restore()
}

function drawServerIdentity(ctx, guildName, serverIcon, theme, accent) {
    const size = 62
    const x = 870
    const y = 58
    drawCircularImage(ctx, serverIcon, x, y, size, { accent, glow: theme.glow, border: 3, shadowBlur: 12 })

    ctx.textAlign = "right"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = theme.muted
    ctx.font = "600 18px Arial"
    ctx.fillText(truncateText(ctx, guildName, 255), 850, 84)
    ctx.fillStyle = theme.text
    ctx.font = "700 15px Arial"
    ctx.fillText("SERVER WELCOME", 850, 108)
}

async function generateWelcomeCard(member, config = {}, options = {}) {
    if (!isGuildPremium(member.guild)) {
        const error = new Error("Premium welcome cards are not enabled for this server owner.")
        error.code = "PREMIUM_REQUIRED"
        throw error
    }

    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext("2d")
    const themeName = normalizeTheme(config.welcomeCardTheme)
    const theme = THEMES[themeName]
    const accent = normalizeHex(config.welcomeAccentColor || config.welcomeColor, theme.accent)

    const [background, avatarImage, serverIcon] = await Promise.all([
        fetchRemoteImage(config.welcomeCardBackground || config.welcomeMediaUrl),
        fetchRemoteImage(member.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 })),
        fetchRemoteImage(member.guild?.iconURL?.({ extension: "png", forceStatic: true, size: 128 })),
    ])

    if (background) {
        drawCoverImage(ctx, background, 0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = themeName === "minimal" ? "rgba(255, 255, 255, 0.62)" : "rgba(0, 0, 0, 0.52)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
    } else {
        drawGradientBackground(ctx, theme)
    }

    ctx.save()
    ctx.shadowColor = "rgba(0, 0, 0, 0.34)"
    ctx.shadowBlur = 26
    ctx.fillStyle = theme.panel
    roundRect(ctx, 34, 34, WIDTH - 68, HEIGHT - 68, 34)
    ctx.fill()
    ctx.restore()

    const accentGradient = ctx.createLinearGradient(34, 34, 34, HEIGHT - 34)
    accentGradient.addColorStop(0, accent)
    accentGradient.addColorStop(1, theme.background[1])
    ctx.fillStyle = accentGradient
    roundRect(ctx, 34, 34, 10, HEIGHT - 68, 5)
    ctx.fill()

    drawCircularImage(ctx, avatarImage, 68, 91, 208, { accent, glow: theme.glow, border: 8, shadowBlur: 24 })

    const guildName = member.guild?.name || "the server"
    const displayName = member.displayName || member.user?.globalName || member.user?.username || "new member"
    const memberCount = member.guild?.memberCount ? `Member #${member.guild.memberCount}` : "New member"
    const assignedRole = options.assignedRoleId
        ? member.guild?.roles?.cache?.get?.(options.assignedRoleId)?.name || "Role assigned"
        : null

    drawServerIdentity(ctx, guildName, serverIcon, theme, accent)

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = accent
    ctx.font = "800 30px Arial"
    ctx.fillText("WELCOME", 322, 126)

    ctx.fillStyle = theme.text
    ctx.font = "800 55px Arial"
    ctx.fillText(truncateText(ctx, displayName, 585), 322, 194)

    ctx.fillStyle = theme.muted
    ctx.font = "500 27px Arial"
    ctx.fillText(truncateText(ctx, `We’re glad you joined ${guildName}`, 585), 322, 238)

    ctx.fillStyle = themeName === "minimal" ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.13)"
    roundRect(ctx, 322, 277, 604, 72, 18)
    ctx.fill()

    ctx.fillStyle = theme.text
    ctx.font = "700 23px Arial"
    ctx.fillText(memberCount, 348, 321)

    if (assignedRole) {
        ctx.textAlign = "right"
        ctx.fillStyle = theme.muted
        ctx.font = "600 18px Arial"
        ctx.fillText(truncateText(ctx, assignedRole, 275), 900, 319)
    }

    return canvas.toBuffer("image/png")
}

module.exports = {
    generateWelcomeCard,
    WIDTH,
    HEIGHT,
    THEMES,
    SUPPORTED_THEMES,
    IMAGE_TIMEOUT_MS,
    MAX_IMAGE_BYTES,
    normalizeTheme,
    normalizeHex,
    isPrivateAddress,
    validateRemoteImageUrl,
    fetchRemoteImage,
}
