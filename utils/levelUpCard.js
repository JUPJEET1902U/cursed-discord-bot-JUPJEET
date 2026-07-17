const { createCanvas, loadImage } = require("@napi-rs/canvas")

const WIDTH = 760
const HEIGHT = 240

// Built-in 5x7 vector glyphs. These are drawn as canvas shapes, so the card
// never depends on Railway/Linux system fonts and can never lose its text.
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
    "!": ["00100","00100","00100","00100","00100","00000","00100"],
    "?": ["01110","10001","00001","00010","00100","00000","00100"],
    ":": ["00000","00110","00110","00000","00110","00110","00000"],
    "•": ["00000","00000","00100","01110","00100","00000","00000"],
    "/": ["00001","00010","00010","00100","01000","01000","10000"],
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

function normalizeBitmapText(value, fallback = "MEMBER") {
    const normalized = String(value || fallback)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
    return [...normalized].map(char => GLYPHS[char] ? char : "?").join("")
}

function bitmapTextWidth(text, scale, spacing = 1) {
    const value = normalizeBitmapText(text, "")
    if (!value.length) return 0
    return value.length * 5 * scale + (value.length - 1) * spacing * scale
}

function truncateBitmapText(text, maxWidth, scale, spacing = 1) {
    let value = normalizeBitmapText(text)
    if (bitmapTextWidth(value, scale, spacing) <= maxWidth) return value

    const suffix = "..."
    while (value.length > 1 && bitmapTextWidth(`${value}${suffix}`, scale, spacing) > maxWidth) {
        value = value.slice(0, -1)
    }
    return `${value}${suffix}`
}

function drawBitmapText(ctx, text, x, y, scale, options = {}) {
    const {
        color = "#FFFFFF",
        align = "left",
        spacing = 1,
        glowColor = null,
        glowBlur = 0,
        maxWidth = null,
    } = options

    const value = maxWidth
        ? truncateBitmapText(text, maxWidth, scale, spacing)
        : normalizeBitmapText(text)
    const width = bitmapTextWidth(value, scale, spacing)
    let startX = x
    if (align === "center") startX -= width / 2
    if (align === "right") startX -= width

    ctx.save()
    ctx.fillStyle = color
    if (glowColor && glowBlur > 0) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
    }

    let cursorX = startX
    for (const char of value) {
        const glyph = GLYPHS[char] || GLYPHS["?"]
        for (let row = 0; row < glyph.length; row++) {
            for (let column = 0; column < glyph[row].length; column++) {
                if (glyph[row][column] !== "1") continue
                const px = cursorX + column * scale
                const py = y + row * scale
                const radius = Math.max(0.8, scale * 0.22)
                roundRect(ctx, px, py, scale, scale, radius)
                ctx.fill()
            }
        }
        cursorX += (5 + spacing) * scale
    }

    ctx.restore()
    return width
}

async function generateLevelUpCard({ user, displayName, guildName, oldLevel, newLevel }) {
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
        drawBitmapText(ctx, "?", avatarX + avatarSize / 2, avatarY + 50, 8, {
            color: "#D8B4FE",
            align: "center",
            glowColor: "rgba(168,85,247,0.65)",
            glowBlur: 8,
        })
    }
    ctx.restore()

    drawBitmapText(ctx, "CURSED LEVELING", 235, 31, 3, {
        color: "#F5D0FE",
        glowColor: "rgba(168,85,247,0.45)",
        glowBlur: 5,
        maxWidth: 285,
    })

    drawBitmapText(ctx, "LEVEL-UP!", 235, 68, 5, {
        color: "#FFFFFF",
        glowColor: "rgba(168,85,247,0.8)",
        glowBlur: 10,
        maxWidth: 285,
    })

    drawBitmapText(ctx, displayName || user?.username || "Member", 235, 126, 4, {
        color: "#E9D5FF",
        maxWidth: 285,
    })

    ctx.fillStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, 535, 53, 174, 128, 22)
    ctx.fill()

    drawBitmapText(ctx, "LEVEL", 622, 65, 3, {
        color: "#D8B4FE",
        align: "center",
    })

    drawBitmapText(ctx, `${oldLevel} • ${newLevel}`, 622, 103, 5, {
        color: "#FFFFFF",
        align: "center",
        glowColor: "rgba(168,85,247,0.55)",
        glowBlur: 6,
        maxWidth: 154,
    })

    drawBitmapText(ctx, guildName || "Discord Server", 622, 151, 2, {
        color: "#C4B5FD",
        align: "center",
        maxWidth: 145,
    })

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
