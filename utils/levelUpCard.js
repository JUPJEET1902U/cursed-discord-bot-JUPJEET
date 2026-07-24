const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas")
const { getLevelProgress, totalXpForLevel } = require("./levelingMath")

const WIDTH = 1000
const HEIGHT = 360
const FONT_FAMILY = "Russo One"
const FONT_URLS = [
    "https://raw.githubusercontent.com/google/fonts/main/ofl/russoone/RussoOne-Regular.ttf",
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/russoone/RussoOne-Regular.ttf",
]

let displayFontPromise = null

// The compact vector alphabet remains as an offline fallback. Railway will use
// Russo One whenever the bundled-at-runtime font download succeeds.
const GLYPHS = {
    " ": ["00000","00000","00000","00000","00000","00000","00000"],
    "A": ["01110","10001","10001","11111","10001","10001","10001"],
    "B": ["11110","10001","10001","11110","10001","10001","11110"],
    "C": ["01111","10000","10000","10000","10000","10000","01111"],
    "D": ["11110","10001","10001","10001","10001","10001","11110"],
    "E": ["11111","10000","10000","11110","10000","10000","11111"],
    "F": ["11111","10000","10000","11110","10000","10000","10000"],
    "G": ["01111","10000","10000","10111","10001","10001","01111"],
    "H": ["10001","10001","10001","11111","10001","10001","10001"],
    "I": ["11111","00100","00100","00100","00100","00100","11111"],
    "J": ["00111","00010","00010","00010","10010","10010","01100"],
    "K": ["10001","10010","10100","11000","10100","10010","10001"],
    "L": ["10000","10000","10000","10000","10000","10000","11111"],
    "M": ["10001","11011","10101","10101","10001","10001","10001"],
    "N": ["10001","11001","10101","10011","10001","10001","10001"],
    "O": ["01110","10001","10001","10001","10001","10001","01110"],
    "P": ["11110","10001","10001","11110","10000","10000","10000"],
    "Q": ["01110","10001","10001","10001","10101","10010","01101"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "S": ["01111","10000","10000","01110","00001","00001","11110"],
    "T": ["11111","00100","00100","00100","00100","00100","00100"],
    "U": ["10001","10001","10001","10001","10001","10001","01110"],
    "V": ["10001","10001","10001","10001","10001","01010","00100"],
    "W": ["10001","10001","10001","10101","10101","10101","01010"],
    "X": ["10001","10001","01010","00100","01010","10001","10001"],
    "Y": ["10001","10001","01010","00100","00100","00100","00100"],
    "Z": ["11111","00001","00010","00100","01000","10000","11111"],
    "0": ["01110","10001","10011","10101","11001","10001","01110"],
    "1": ["00100","01100","00100","00100","00100","00100","01110"],
    "2": ["01110","10001","00001","00010","00100","01000","11111"],
    "3": ["11110","00001","00001","01110","00001","00001","11110"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "5": ["11111","10000","10000","11110","00001","00001","11110"],
    "6": ["01110","10000","10000","11110","10001","10001","01110"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "8": ["01110","10001","10001","01110","10001","10001","01110"],
    "9": ["01110","10001","10001","01111","00001","00001","01110"],
    "-": ["00000","00000","00000","11111","00000","00000","00000"],
    "_": ["00000","00000","00000","00000","00000","00000","11111"],
    ".": ["00000","00000","00000","00000","00000","00110","00110"],
    ",": ["00000","00000","00000","00000","00110","00110","01100"],
    "!": ["00100","00100","00100","00100","00100","00000","00100"],
    "?": ["01110","10001","00001","00010","00100","00000","00100"],
    ":": ["00000","00110","00110","00000","00110","00110","00000"],
    "/": ["00001","00010","00010","00100","01000","01000","10000"],
    "+": ["00000","00100","00100","11111","00100","00100","00000"],
    "#": ["01010","11111","01010","01010","11111","01010","00000"],
    "%": ["11001","11010","00100","01000","10110","00110","00000"],
    "@": ["01110","10001","10111","10101","10111","10000","01111"],
    ">": ["10000","01000","00100","00010","00100","01000","10000"],
    "<": ["00001","00010","00100","01000","00100","00010","00001"],
    "'": ["00100","00100","00000","00000","00000","00000","00000"],
    "(": ["00010","00100","01000","01000","01000","00100","00010"],
    ")": ["01000","00100","00010","00010","00010","00100","01000"],
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0))
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

async function fetchFontBuffer(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length < 10_000 || buffer.length > 1_000_000) return null
        return buffer
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}

async function ensureDisplayFont() {
    if (GlobalFonts.has(FONT_FAMILY)) return true
    if (!displayFontPromise) {
        displayFontPromise = (async () => {
            for (const url of FONT_URLS) {
                const buffer = await fetchFontBuffer(url)
                if (!buffer) continue
                try {
                    GlobalFonts.register(buffer)
                    if (GlobalFonts.has(FONT_FAMILY)) return true
                } catch {
                    // Try the next mirror, then use the vector fallback.
                }
            }
            return false
        })()
    }
    return displayFontPromise
}

function normalizeText(value, fallback = "MEMBER") {
    const source = String(value || fallback)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[•·|]/g, "-")
        .replace(/[→➜➝]/g, ">")
        .replace(/[↑⬆]/g, "+")
        .toUpperCase()

    let output = ""
    for (const character of source) {
        if (GLYPHS[character]) output += character
        else if (/\s/u.test(character)) output += " "
        else if (character.codePointAt(0) > 127) output += " "
        else output += "?"
    }
    return output.replace(/\s+/g, " ").trim() || fallback
}

function vectorMetrics(height, spacingRatio = 0.18, tracking = 0) {
    const cell = height / 7
    return { cell, glyphWidth: cell * 5, spacing: height * spacingRatio + tracking }
}

function measureVectorText(value, height, spacingRatio = 0.18, tracking = 0) {
    const output = normalizeText(value, "")
    if (!output) return 0
    const metrics = vectorMetrics(height, spacingRatio, tracking)
    return output.length * metrics.glyphWidth + Math.max(0, output.length - 1) * metrics.spacing
}

function drawVectorText(ctx, value, x, y, options = {}) {
    const {
        size = options.height || 20,
        minSize = options.minHeight || 8,
        color = "#FFFFFF",
        maxWidth,
        align = "left",
        baseline = "alphabetic",
        glowColor,
        glowBlur = 0,
        spacingRatio = 0.18,
        tracking = 0,
        weight = 700,
    } = options
    const normalized = normalizeText(value, options.fallback || "MEMBER")
    let height = size
    const measured = measureVectorText(normalized, height, spacingRatio, tracking)
    if (maxWidth && measured > maxWidth) height = Math.max(minSize, height * (maxWidth / measured))
    let output = normalized
    while (maxWidth && output.length > 1 && measureVectorText(output, height, spacingRatio, tracking) > maxWidth) {
        output = `${output.slice(0, -4).trimEnd()}...`
    }
    const metrics = vectorMetrics(height, spacingRatio, tracking)
    const width = measureVectorText(output, height, spacingRatio, tracking)
    let cursorX = x
    if (align === "center") cursorX -= width / 2
    if (align === "right") cursorX -= width
    let topY = y
    if (baseline === "middle") topY = y - height / 2
    else if (["alphabetic", "bottom"].includes(baseline)) topY = y - height * 0.84
    const insetRatio = weight >= 850 ? 0.03 : weight >= 700 ? 0.075 : 0.13
    const inset = Math.max(0.35, metrics.cell * insetRatio)
    const block = Math.max(0.8, metrics.cell - inset * 2)
    const radius = Math.max(0.5, Math.min(2.4, block * 0.18))

    ctx.save()
    ctx.fillStyle = color
    if (glowColor && glowBlur) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
    }
    for (const character of output) {
        const glyph = GLYPHS[character] || GLYPHS["?"]
        for (let row = 0; row < 7; row += 1) {
            for (let column = 0; column < 5; column += 1) {
                if (glyph[row][column] !== "1") continue
                roundRect(
                    ctx,
                    cursorX + column * metrics.cell + inset,
                    topY + row * metrics.cell + inset,
                    block,
                    block,
                    radius,
                )
                ctx.fill()
            }
        }
        cursorX += metrics.glyphWidth + metrics.spacing
    }
    ctx.restore()
    return { text: output, width, size: height, renderer: "vector" }
}

function setDisplayFont(ctx, size) {
    ctx.font = `${Math.max(1, Math.floor(size))}px "${FONT_FAMILY}"`
}

function measureTrackedText(ctx, value, tracking) {
    const characters = [...String(value || "")]
    return characters.reduce((sum, character) => sum + ctx.measureText(character).width, 0)
        + tracking * Math.max(0, characters.length - 1)
}

function drawFontText(ctx, value, x, y, options = {}) {
    const {
        size: preferredSize = options.height || 20,
        minSize = options.minHeight || 8,
        color = "#FFFFFF",
        maxWidth,
        align = "left",
        baseline = "alphabetic",
        glowColor,
        glowBlur = 0,
        tracking = 0,
    } = options
    const raw = String(value || options.fallback || "MEMBER")
    let size = preferredSize
    setDisplayFont(ctx, size)
    const widthFor = text => tracking ? measureTrackedText(ctx, text, tracking) : ctx.measureText(text).width
    while (maxWidth && size > minSize && widthFor(raw) > maxWidth) {
        size -= 1
        setDisplayFont(ctx, size)
    }
    let output = raw
    while (maxWidth && output.length > 1 && widthFor(output) > maxWidth) {
        output = `${output.slice(0, -2).trimEnd()}…`
    }
    const width = widthFor(output)
    let cursor = x
    if (align === "center") cursor -= width / 2
    if (align === "right") cursor -= width

    ctx.save()
    ctx.fillStyle = color
    ctx.textBaseline = baseline
    ctx.textAlign = tracking ? "left" : align
    if (glowColor && glowBlur) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
    }
    if (!tracking) {
        ctx.fillText(output, x, y)
    } else {
        for (const character of output) {
            ctx.fillText(character, cursor, y)
            cursor += ctx.measureText(character).width + tracking
        }
    }
    ctx.restore()
    return { text: output, width, size, renderer: "font" }
}

function drawText(ctx, value, x, y, options = {}) {
    return GlobalFonts.has(FONT_FAMILY)
        ? drawFontText(ctx, value, x, y, options)
        : drawVectorText(ctx, value, x, y, options)
}

function cover(ctx, image, x, y, width, height) {
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

async function remoteImage(url) {
    if (!url || typeof fetch !== "function") return null
    try {
        const response = await fetch(new URL(url))
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length > 8 * 1024 * 1024) return null
        return await loadImage(buffer)
    } catch {
        return null
    }
}

function pill(ctx, x, y, width, label, options = {}) {
    const height = 38
    ctx.fillStyle = options.background || "rgba(255,255,255,0.065)"
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.fill()
    ctx.strokeStyle = options.border || "rgba(255,255,255,0.10)"
    ctx.lineWidth = 1
    ctx.stroke()
    if (options.dot) {
        ctx.fillStyle = options.dot
        ctx.beginPath()
        ctx.arc(x + 17, y + height / 2, 4, 0, Math.PI * 2)
        ctx.fill()
    }
    drawText(ctx, label, options.dot ? x + 30 : x + width / 2, y + height / 2 + 1, {
        size: 13,
        minSize: 9,
        color: options.color || "#E9D5FF",
        maxWidth: width - (options.dot ? 42 : 20),
        align: options.dot ? "left" : "center",
        baseline: "middle",
    })
}

function progressBar(ctx, x, y, width, ratio) {
    const height = 16
    ctx.fillStyle = "rgba(255,255,255,0.075)"
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.fill()
    const safeRatio = clamp(ratio, 0, 1)
    if (safeRatio > 0) {
        const gradient = ctx.createLinearGradient(x, y, x + width, y)
        gradient.addColorStop(0, "#7C3AED")
        gradient.addColorStop(0.52, "#A855F7")
        gradient.addColorStop(1, "#EC4899")
        ctx.save()
        ctx.fillStyle = gradient
        ctx.shadowColor = "rgba(168,85,247,0.8)"
        ctx.shadowBlur = 14
        roundRect(ctx, x, y, Math.min(width, Math.max(height, width * safeRatio)), height, height / 2)
        ctx.fill()
        ctx.restore()
    }
    ctx.strokeStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.stroke()
}

function background(ctx) {
    const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    base.addColorStop(0, "#05030A")
    base.addColorStop(0.48, "#10051B")
    base.addColorStop(1, "#27063F")
    ctx.fillStyle = base
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    const violet = ctx.createRadialGradient(90, 40, 5, 90, 40, 330)
    violet.addColorStop(0, "rgba(124,58,237,0.48)")
    violet.addColorStop(1, "rgba(124,58,237,0)")
    ctx.fillStyle = violet
    ctx.fillRect(0, 0, 450, HEIGHT)
    const pink = ctx.createRadialGradient(900, 265, 5, 900, 265, 320)
    pink.addColorStop(0, "rgba(236,72,153,0.28)")
    pink.addColorStop(1, "rgba(236,72,153,0)")
    ctx.fillStyle = pink
    ctx.fillRect(580, 0, 420, HEIGHT)
    ctx.save()
    ctx.globalAlpha = 0.11
    ctx.strokeStyle = "#C084FC"
    for (let x = -100; x < WIDTH + 120; x += 74) {
        ctx.beginPath()
        ctx.moveTo(x, HEIGHT)
        ctx.lineTo(x + 190, 0)
        ctx.stroke()
    }
    ctx.restore()
}

function drawUpArrow(ctx, x, y) {
    ctx.save()
    ctx.strokeStyle = "#FFFFFF"
    ctx.fillStyle = "#FFFFFF"
    ctx.lineWidth = 4
    ctx.lineCap = "round"
    ctx.shadowColor = "rgba(255,255,255,0.8)"
    ctx.shadowBlur = 5
    ctx.beginPath()
    ctx.moveTo(x, y + 9)
    ctx.lineTo(x, y - 7)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y - 11)
    ctx.lineTo(x - 7, y - 3)
    ctx.lineTo(x + 7, y - 3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}

async function avatar(ctx, user, x, y, size) {
    const image = await remoteImage(user?.displayAvatarURL?.({ extension: "png", forceStatic: true, size: 512 }))
    const ring = ctx.createLinearGradient(x, y, x + size, y + size)
    ring.addColorStop(0, "#8B5CF6")
    ring.addColorStop(0.55, "#D946EF")
    ring.addColorStop(1, "#FB7185")
    ctx.save()
    ctx.fillStyle = ring
    ctx.shadowColor = "rgba(168,85,247,0.9)"
    ctx.shadowBlur = 28
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    if (image) cover(ctx, image, x, y, size, size)
    else {
        const fallback = ctx.createLinearGradient(x, y, x + size, y + size)
        fallback.addColorStop(0, "#21152F")
        fallback.addColorStop(1, "#48145F")
        ctx.fillStyle = fallback
        ctx.fillRect(x, y, size, size)
        drawText(ctx, "?", x + size / 2, y + size / 2, {
            size: 72,
            minSize: 42,
            color: "#E9D5FF",
            align: "center",
            baseline: "middle",
        })
    }
    ctx.restore()
    ctx.fillStyle = "#09050F"
    ctx.beginPath()
    ctx.arc(x + size - 5, y + size - 5, 28, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ring
    ctx.beginPath()
    ctx.arc(x + size - 5, y + size - 5, 22, 0, Math.PI * 2)
    ctx.fill()
    drawUpArrow(ctx, x + size - 5, y + size - 5)
}

function guildBadge(ctx, guildName) {
    ctx.fillStyle = "rgba(7,3,16,0.48)"
    roundRect(ctx, 715, 48, 226, 42, 16)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.09)"
    ctx.stroke()
    ctx.fillStyle = "#A855F7"
    ctx.beginPath()
    ctx.arc(738, 69, 5, 0, Math.PI * 2)
    ctx.fill()
    drawText(ctx, normalizeText(guildName || "Discord Server", "DISCORD SERVER"), 752, 69, {
        size: 12,
        minSize: 8,
        color: "#DDD6FE",
        maxWidth: 170,
        baseline: "middle",
    })
}

function medallion(ctx, x, y, radius, level) {
    const outer = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
    outer.addColorStop(0, "#7C3AED")
    outer.addColorStop(0.5, "#D946EF")
    outer.addColorStop(1, "#FB7185")
    ctx.save()
    ctx.fillStyle = outer
    ctx.shadowColor = "rgba(168,85,247,0.65)"
    ctx.shadowBlur = 34
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    const inner = ctx.createRadialGradient(x - 28, y - 34, 8, x, y, radius - 8)
    inner.addColorStop(0, "#451B67")
    inner.addColorStop(1, "#09050F")
    ctx.fillStyle = inner
    ctx.beginPath()
    ctx.arc(x, y, radius - 8, 0, Math.PI * 2)
    ctx.fill()
    drawText(ctx, "LEVEL", x, y - 43, {
        size: 15,
        minSize: 10,
        color: "#D8B4FE",
        align: "center",
        baseline: "middle",
        tracking: 1,
    })
    drawText(ctx, String(level), x, y + 13, {
        size: 76,
        minSize: 40,
        maxWidth: radius * 1.35,
        align: "center",
        baseline: "middle",
        glowColor: "rgba(216,180,254,0.75)",
        glowBlur: 12,
    })
    drawText(ctx, "UNLOCKED", x, y + 68, {
        size: 11,
        minSize: 8,
        color: "#F0ABFC",
        align: "center",
        baseline: "middle",
        tracking: 0.5,
    })
}

function safeMemberName(displayName, user) {
    const preferred = normalizeText(displayName || user?.globalName || "", "")
    if (/[A-Z0-9]/.test(preferred)) return preferred
    return normalizeText(user?.username || "MEMBER", "MEMBER")
}

async function generateLevelUpCard({ user, displayName, guildName, oldLevel, newLevel, xp = 0, xpGain = 0 }) {
    await ensureDisplayFont()
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext("2d")
    const announcedLevel = Math.max(0, Math.floor(Number(newLevel) || 0))
    const suppliedXp = Math.max(0, Math.floor(Number(xp) || 0))
    const totalXp = suppliedXp || totalXpForLevel(announcedLevel)
    const progress = getLevelProgress(totalXp)
    const currentLevel = Math.max(announcedLevel, progress.level)
    const gained = Math.max(0, Math.floor(Number(xpGain) || 0))

    background(ctx)
    ctx.save()
    ctx.fillStyle = "rgba(9,5,16,0.84)"
    ctx.shadowColor = "rgba(0,0,0,0.7)"
    ctx.shadowBlur = 38
    roundRect(ctx, 28, 28, WIDTH - 56, HEIGHT - 56, 30)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = "rgba(216,180,254,0.16)"
    ctx.lineWidth = 1.5
    roundRect(ctx, 28, 28, WIDTH - 56, HEIGHT - 56, 30)
    ctx.stroke()
    const edge = ctx.createLinearGradient(28, 28, 28, HEIGHT - 28)
    edge.addColorStop(0, "#A855F7")
    edge.addColorStop(1, "#EC4899")
    ctx.fillStyle = edge
    roundRect(ctx, 28, 28, 7, HEIGHT - 56, 4)
    ctx.fill()

    await avatar(ctx, user, 66, 96, 160)
    guildBadge(ctx, guildName)
    drawText(ctx, "CURSED  //  LEVELING", 270, 71, {
        size: 16,
        minSize: 11,
        color: "#C4B5FD",
        tracking: 1.2,
    })
    drawText(ctx, `LEVEL ${currentLevel} UNLOCKED`, 270, 128, {
        size: 39,
        minSize: 27,
        maxWidth: 430,
        glowColor: "rgba(168,85,247,0.5)",
        glowBlur: 12,
    })
    drawText(ctx, safeMemberName(displayName, user), 270, 171, {
        size: 23,
        minSize: 15,
        color: "#E9D5FF",
        maxWidth: 425,
    })
    pill(ctx, 270, 194, 158, `${oldLevel}  >  ${currentLevel}`, {
        background: "rgba(168,85,247,0.12)",
        border: "rgba(192,132,252,0.24)",
        color: "#F5D0FE",
    })
    pill(ctx, 440, 194, 130, gained ? `+${gained.toLocaleString()} XP` : "MILESTONE", {
        background: "rgba(236,72,153,0.09)",
        border: "rgba(244,114,182,0.20)",
        color: "#FBCFE8",
        dot: "#EC4899",
    })
    pill(ctx, 582, 194, 128, `${totalXp.toLocaleString()} XP`, {
        background: "rgba(124,58,237,0.10)",
        border: "rgba(167,139,250,0.20)",
        color: "#DDD6FE",
        dot: "#8B5CF6",
    })
    drawText(ctx, `PROGRESS TO LEVEL ${currentLevel + 1}`, 270, 263, {
        size: 12,
        minSize: 9,
        color: "#C4B5FD",
        tracking: 0.6,
    })
    drawText(ctx, `${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP`, 710, 263, {
        size: 12,
        minSize: 9,
        color: "#E9D5FF",
        align: "right",
    })
    progressBar(ctx, 270, 278, 440, progress.ratio)
    drawText(ctx, `${Math.max(0, progress.needed - progress.current).toLocaleString()} XP UNTIL NEXT LEVEL`, 270, 318, {
        size: 11,
        minSize: 8,
        color: "rgba(233,213,255,0.72)",
    })
    medallion(ctx, 835, 208, 99, currentLevel)
    return canvas.toBuffer("image/png")
}

module.exports = {
    generateLevelUpCard,
    WIDTH,
    HEIGHT,
    FONT_FAMILY,
    ensureDisplayFont,
    drawText,
    drawVectorText,
    normalizeText,
}
