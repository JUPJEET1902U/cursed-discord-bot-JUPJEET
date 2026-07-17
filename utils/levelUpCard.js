const fs = require("node:fs")
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas")

const WIDTH = 760
const HEIGHT = 240

// Railway's Linux image may not include Arial. @napi-rs/canvas can still draw
// shapes and images in that situation, but fillText may produce invisible text.
// Resolve and verify a real installed font once, then reuse it for every card.
const COMMON_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf",
    "/usr/local/share/fonts/DejaVuSans.ttf",
]

let resolvedFontFamily = null
let fontResolutionAttempted = false

function cleanFontFamily(value) {
    return String(value || "").replace(/["\\]/g, "").trim()
}

function getInstalledFontFamilies() {
    try {
        // These methods differ between @napi-rs/canvas releases. Optional calls
        // make the renderer compatible with both older and newer versions.
        GlobalFonts?.loadSystemFonts?.()
        GlobalFonts?.loadFontsFromDir?.("/usr/share/fonts")

        let families = GlobalFonts?.families
        if (typeof families === "string") {
            try { families = JSON.parse(families) } catch { families = [] }
        }
        if (!Array.isArray(families)) return []

        return [...new Set(families
            .map(entry => typeof entry === "string" ? entry : (entry?.family || entry?.name))
            .map(cleanFontFamily)
            .filter(Boolean))]
    } catch {
        return []
    }
}

function fontRendersLatin(family) {
    const safeFamily = cleanFontFamily(family)
    if (!safeFamily) return false

    try {
        const probe = createCanvas(260, 60)
        const probeCtx = probe.getContext("2d")
        probeCtx.clearRect(0, 0, 260, 60)
        probeCtx.fillStyle = "#FFFFFF"
        // Avoid numeric font weights here. Some minimal Linux/fontconfig setups
        // reject a weighted Arial declaration without throwing an exception.
        probeCtx.font = `28px "${safeFamily}"`
        probeCtx.textBaseline = "alphabetic"
        probeCtx.fillText("CURSED LEVEL 123", 4, 40)

        if (typeof probeCtx.getImageData === "function") {
            const pixels = probeCtx.getImageData(0, 0, 260, 60).data
            for (let index = 3; index < pixels.length; index += 4) {
                if (pixels[index] > 0) return true
            }
            return false
        }

        return probeCtx.measureText("CURSED LEVEL 123").width > 1
    } catch {
        return false
    }
}

function registerCommonLinuxFont() {
    if (!GlobalFonts?.registerFromPath) return null

    for (let index = 0; index < COMMON_FONT_PATHS.length; index++) {
        const fontPath = COMMON_FONT_PATHS[index]
        if (!fs.existsSync(fontPath)) continue

        const alias = `CURSED Card Font ${index + 1}`
        try {
            const registered = GlobalFonts.registerFromPath(fontPath, alias)
            if (registered !== false && fontRendersLatin(alias)) return alias
        } catch {
            // Try the next known Linux font path.
        }
    }

    return null
}

function resolveFontFamily() {
    if (resolvedFontFamily) return resolvedFontFamily
    if (fontResolutionAttempted) {
        throw new Error("No usable Latin font is available for the level-up card")
    }
    fontResolutionAttempted = true

    const installed = getInstalledFontFamilies()
    const preferredPatterns = [
        /dejavu sans/i,
        /liberation sans/i,
        /noto sans/i,
        /roboto/i,
        /ubuntu/i,
        /arial/i,
        /sans/i,
    ]

    const ordered = []
    for (const pattern of preferredPatterns) {
        ordered.push(...installed.filter(name => pattern.test(name)))
    }
    ordered.push(...installed)
    ordered.push("sans-serif")

    for (const family of [...new Set(ordered)]) {
        if (fontRendersLatin(family)) {
            resolvedFontFamily = family
            return resolvedFontFamily
        }
    }

    resolvedFontFamily = registerCommonLinuxFont()
    if (resolvedFontFamily) return resolvedFontFamily

    throw new Error("No usable Latin font is available for the level-up card")
}

function setCardFont(ctx, size) {
    const family = resolveFontFamily()
    ctx.font = `${size}px "${cleanFontFamily(family)}"`
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
    let sx = 0
    let sy = 0
    let sw = image.width
    let sh = image.height

    if (sourceRatio > targetRatio) {
        sw = image.height * targetRatio
        sx = (image.width - sw) / 2
    } else {
        sh = image.width / targetRatio
        sy = (image.height - sh) / 2
    }

    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height)
}

async function loadRemoteImage(url) {
    if (!url || typeof fetch !== "function") return null
    try {
        const parsed = new URL(url)
        if (!["https:", "http:"].includes(parsed.protocol)) return null
        const response = await fetch(parsed)
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        return await loadImage(buffer)
    } catch {
        return null
    }
}

function truncateText(ctx, text, maxWidth) {
    let value = String(text || "Member")
    if (ctx.measureText(value).width <= maxWidth) return value
    while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
        value = value.slice(0, -1)
    }
    return `${value}…`
}

async function generateLevelUpCard({ user, displayName, guildName, oldLevel, newLevel }) {
    // Resolve and test the font before creating an attachment. When no usable
    // font exists, this throws and sendLevelUpAnnouncement keeps its text-only
    // fallback instead of sending a visually blank image.
    resolveFontFamily()

    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext("2d")

    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    background.addColorStop(0, "#08030F")
    background.addColorStop(0.48, "#160822")
    background.addColorStop(1, "#2D0A48")
    ctx.fillStyle = background
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    ctx.save()
    ctx.globalAlpha = 0.24
    const glow = ctx.createRadialGradient(610, 10, 10, 610, 10, 260)
    glow.addColorStop(0, "#D946EF")
    glow.addColorStop(1, "rgba(217, 70, 239, 0)")
    ctx.fillStyle = glow
    ctx.fillRect(350, 0, 410, 240)
    ctx.restore()

    ctx.fillStyle = "rgba(255,255,255,0.075)"
    roundRect(ctx, 18, 18, WIDTH - 36, HEIGHT - 36, 26)
    ctx.fill()

    ctx.fillStyle = "#A855F7"
    roundRect(ctx, 18, 18, 8, HEIGHT - 36, 5)
    ctx.fill()

    const avatarSize = 154
    const avatarX = 50
    const avatarY = 43
    const avatarUrl = user?.displayAvatarURL?.({ extension: "png", forceStatic: true, size: 256 })
    const avatar = await loadRemoteImage(avatarUrl)

    ctx.save()
    ctx.shadowColor = "rgba(168, 85, 247, 0.8)"
    ctx.shadowBlur = 20
    ctx.fillStyle = "#A855F7"
    ctx.beginPath()
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
    ctx.clip()
    if (avatar) {
        drawCoverImage(ctx, avatar, avatarX, avatarY, avatarSize, avatarSize)
    } else {
        ctx.fillStyle = "#252033"
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
        ctx.fillStyle = "#D8B4FE"
        setCardFont(ctx, 62)
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.lineWidth = 2
        ctx.strokeStyle = "rgba(216,180,254,0.35)"
        ctx.strokeText("?", avatarX + avatarSize / 2, avatarY + avatarSize / 2)
        ctx.fillText("?", avatarX + avatarSize / 2, avatarY + avatarSize / 2)
    }
    ctx.restore()

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = "#F5D0FE"
    setCardFont(ctx, 22)
    ctx.fillText("CURSED LEVELING", 235, 52)

    ctx.fillStyle = "#FFFFFF"
    setCardFont(ctx, 48)
    ctx.shadowColor = "rgba(168,85,247,0.45)"
    ctx.shadowBlur = 8
    ctx.fillText("LEVEL-UP!", 235, 105)
    ctx.shadowBlur = 0

    ctx.fillStyle = "#E9D5FF"
    setCardFont(ctx, 27)
    ctx.fillText(truncateText(ctx, displayName || user?.username || "Member", 285), 235, 142)

    ctx.fillStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, 535, 53, 174, 128, 22)
    ctx.fill()

    ctx.fillStyle = "#D8B4FE"
    setCardFont(ctx, 17)
    ctx.textAlign = "center"
    ctx.fillText("LEVEL", 622, 83)

    ctx.fillStyle = "#FFFFFF"
    setCardFont(ctx, 39)
    ctx.fillText(`${oldLevel}  •  ${newLevel}`, 622, 132)

    ctx.fillStyle = "#C4B5FD"
    setCardFont(ctx, 15)
    ctx.fillText(truncateText(ctx, guildName || "Discord Server", 145), 622, 160)

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
