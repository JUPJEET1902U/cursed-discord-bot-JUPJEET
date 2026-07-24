const { createCanvas, loadImage } = require("@napi-rs/canvas")
const { getLevelProgress, totalXpForLevel } = require("./levelingMath")

const WIDTH = 1000
const HEIGHT = 360

// Railway containers do not guarantee any system fonts. These embedded 5x7
// glyphs keep every critical label visible without shipping or loading fonts.
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
    return {
        cell,
        glyphWidth: cell * 5,
        spacing: height * spacingRatio + tracking,
    }
}

function measureVectorText(value, height, spacingRatio = 0.18, tracking = 0) {
    const text = normalizeText(value, "")
    if (!text) return 0
    const metrics = vectorMetrics(height, spacingRatio, tracking)
    return text.length * metrics.glyphWidth + Math.max(0, text.length - 1) * metrics.spacing
}

function fittedVectorHeight(value, maxWidth, preferred, minimum, spacingRatio, tracking) {
    const measured = measureVectorText(value, preferred, spacingRatio, tracking)
    if (!maxWidth || measured <= maxWidth) return preferred
    return Math.max(minimum, preferred * (maxWidth / measured))
}

function shortenVectorText(value, height, maxWidth, spacingRatio, tracking) {
    let output = normalizeText(value, "")
    if (!maxWidth || measureVectorText(output, height, spacingRatio, tracking) <= maxWidth) return output
    const suffix = "..."
    while (output.length > 1 && measureVectorText(`${output}${suffix}`, height, spacingRatio, tracking) > maxWidth) {
        output = output.slice(0, -1).trimEnd()
    }
    return `${output}${suffix}`
}

function drawVectorText(ctx, value, x, y, options = {}) {
    const {
        height: preferredHeight = 20,
        minHeight = 8,
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
    const height = fittedVectorHeight(normalized, maxWidth, preferredHeight, minHeight, spacingRatio, tracking)
    const output = shortenVectorText(normalized, height, maxWidth, spacingRatio, tracking)
    const metrics = vectorMetrics(height, spacingRatio, tracking)
    const width = measureVectorText(output, height, spacingRatio, tracking)

    let cursorX = x
    if (align === "center") cursorX -= width / 2
    if (align === "right") cursorX -= width

    let topY = y
    if (baseline === "middle") topY = y - height / 2
    else if (baseline === "alphabetic" || baseline === "bottom") topY = y - height * 0.84

    const insetRatio = weight >= 850 ? 0.03 : weight >= 700 ? 0.075 : 0.13
    const inset = Math.max(0.35, metrics.cell * insetRatio)
    const block = Math.max(0.8, metrics.cell - inset * 2)
    const radius = Math.max(0.5, Math.min(2.4, block * 0.18))

    ctx.save()
    ctx.globalAlpha = 1
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
                const px = cursorX + column * metrics.cell + inset
                const py = topY + row * metrics.cell + inset
                roundRect(ctx, px, py, block, block, radius)
                ctx.fill()
            }
        }
        cursorX += metrics.glyphWidth + metrics.spacing
    }
    ctx.restore()

    return { text: output, width, height }
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
        const parsed = new URL(url)
        if (!["http:", "https:"].includes(parsed.protocol)) return null
        const response = await fetch(parsed)
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

    drawVectorText(ctx, label, options.dot ? x + 30 : x + width / 2, y + height / 2, {
        height: 13,
        minHeight: 8,
        weight: 800,
        color: options.color || "#E9D5FF",
        maxWidth: width - (options.dot ? 42 : 20),
        align: options.dot ? "left" : "center",
        baseline: "middle",
        spacingRatio: 0.11,
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
    if (image) {
        cover(ctx, image, x, y, size, size)
    } else {
        const fallback = ctx.createLinearGradient(x, y, x + size, y + size)
        fallback.addColorStop(0, "#21152F")
        fallback.addColorStop(1, "#48145F")
        ctx.fillStyle = fallback
        ctx.fillRect(x, y, size, size)
        drawVectorText(ctx, "?", x + size / 2, y + size / 2, {
            height: 72,
            minHeight: 42,
            weight: 900,
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
    drawVectorText(ctx, guildName || "Discord Server", 752, 69, {
        height: 12,
        minHeight: 7,
        weight: 700,
        color: "#DDD6FE",
        maxWidth: 170,
        baseline: "middle",
        spacingRatio: 0.11,
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

    drawVectorText(ctx, "LEVEL", x, y - 43, {
        height: 15,
        minHeight: 10,
        weight: 800,
        color: "#D8B4FE",
        align: "center",
        baseline: "middle",
        tracking: 1,
        spacingRatio: 0.11,
    })
    drawVectorText(ctx, String(level), x, y + 13, {
        height: 76,
        minHeight: 40,
        weight: 900,
        maxWidth: radius * 1.35,
        align: "center",
        baseline: "middle",
        glowColor: "rgba(216,180,254,0.75)",
        glowBlur: 12,
        spacingRatio: 0.08,
    })
    drawVectorText(ctx, "UNLOCKED", x, y + 68, {
        height: 11,
        minHeight: 7,
        weight: 800,
        color: "#F0ABFC",
        align: "center",
        baseline: "middle",
        tracking: 0.5,
        spacingRatio: 0.09,
    })
}

function safeMemberName(displayName, user) {
    const preferred = normalizeText(displayName || user?.globalName || "", "")
    if (/[A-Z0-9]/.test(preferred)) return preferred
    return normalizeText(user?.username || "MEMBER", "MEMBER")
}

async function generateLevelUpCard({
    user,
    displayName,
    guildName,
    oldLevel,
    newLevel,
    xp = 0,
    xpGain = 0,
}) {
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

    drawVectorText(ctx, "CURSED // LEVELING", 270, 71, {
        height: 15,
        minHeight: 10,
        weight: 800,
        color: "#C4B5FD",
        tracking: 0.8,
        spacingRatio: 0.11,
    })
    drawVectorText(ctx, `LEVEL ${currentLevel} UNLOCKED`, 270, 128, {
        height: 38,
        minHeight: 24,
        weight: 900,
        maxWidth: 430,
        glowColor: "rgba(168,85,247,0.5)",
        glowBlur: 12,
        spacingRatio: 0.11,
    })
    drawVectorText(ctx, safeMemberName(displayName, user), 270, 171, {
        height: 22,
        minHeight: 13,
        weight: 750,
        color: "#E9D5FF",
        maxWidth: 425,
        spacingRatio: 0.12,
    })

    pill(ctx, 270, 194, 158, `${oldLevel} > ${currentLevel}`, {
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

    drawVectorText(ctx, `PROGRESS TO LEVEL ${currentLevel + 1}`, 270, 263, {
        height: 12,
        minHeight: 8,
        weight: 800,
        color: "#C4B5FD",
        tracking: 0.45,
        spacingRatio: 0.10,
    })
    drawVectorText(ctx, `${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP`, 710, 263, {
        height: 12,
        minHeight: 8,
        weight: 700,
        color: "#E9D5FF",
        align: "right",
        spacingRatio: 0.10,
    })
    progressBar(ctx, 270, 278, 440, progress.ratio)
    drawVectorText(ctx, `${Math.max(0, progress.needed - progress.current).toLocaleString()} XP UNTIL NEXT LEVEL`, 270, 318, {
        height: 11,
        minHeight: 7,
        weight: 650,
        color: "rgba(233,213,255,0.72)",
        spacingRatio: 0.10,
    })

    medallion(ctx, 835, 208, 99, currentLevel)
    return canvas.toBuffer("image/png")
}

module.exports = {
    generateLevelUpCard,
    WIDTH,
    HEIGHT,
    drawVectorText,
    normalizeText,
}
