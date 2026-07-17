const { createCanvas, loadImage } = require("@napi-rs/canvas")

const WIDTH = 760
const HEIGHT = 240

// Built-in vector glyphs keep text reliable on Railway without shipping fonts.
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
    ".": ["00000","00000","00000","00000","00000","00100","00100"],
    ",": ["00000","00000","00000","00000","00100","00100","01000"],
    "!": ["00100","00100","00100","00100","00100","00000","00100"],
    "?": ["01110","10001","00001","00010","00100","00000","00100"],
    ":": ["00000","00100","00100","00000","00100","00100","00000"],
    "/": ["00001","00010","00010","00100","01000","01000","10000"],
    "+": ["00000","00100","00100","11111","00100","00100","00000"],
    "&": ["01100","10010","10100","01000","10101","10010","01101"],
    "'": ["00100","00100","00000","00000","00000","00000","00000"],
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
        .toUpperCase()

    let result = ""
    for (const char of source) {
        if (GLYPHS[char]) result += char
        else if (/\s/u.test(char) || char.codePointAt(0) > 127) result += " "
        else result += "?"
    }
    return result.replace(/\s+/g, " ").trim() || fallback
}

function metrics(height, spacingRatio = 0.16) {
    const stepY = height / 6
    const stepX = stepY * 0.82
    const stroke = Math.max(1.2, stepY * 0.82)
    return {
        stepX,
        stepY,
        stroke,
        glyphWidth: stepX * 4 + stroke,
        spacing: height * spacingRatio,
    }
}

function measure(text, height, spacingRatio = 0.16) {
    const value = normalizeText(text, "")
    if (!value) return 0
    const { glyphWidth, spacing } = metrics(height, spacingRatio)
    return value.length * glyphWidth + Math.max(0, value.length - 1) * spacing
}

function fitHeight(text, preferred, maxWidth, minHeight, spacingRatio) {
    const width = measure(text, preferred, spacingRatio)
    if (!maxWidth || width <= maxWidth) return preferred
    return Math.max(minHeight, preferred * (maxWidth / width))
}

function hasCell(glyph, row, column) {
    return glyph[row]?.[column] === "1"
}

function drawGlyph(ctx, glyph, x, y, height, color, options = {}) {
    const { stepX, stepY, stroke } = metrics(height, options.spacingRatio)
    const point = (row, column) => [
        x + column * stepX + stroke / 2,
        y + row * stepY + stroke / 2,
    ]

    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = stroke
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (options.glowColor && options.glowBlur) {
        ctx.shadowColor = options.glowColor
        ctx.shadowBlur = options.glowBlur
    }

    const connected = new Set()
    const connect = (rowA, colA, rowB, colB) => {
        const [ax, ay] = point(rowA, colA)
        const [bx, by] = point(rowB, colB)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        connected.add(`${rowA}:${colA}`)
        connected.add(`${rowB}:${colB}`)
    }

    for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 5; column++) {
            if (!hasCell(glyph, row, column)) continue
            if (hasCell(glyph, row, column + 1)) connect(row, column, row, column + 1)
            if (hasCell(glyph, row + 1, column)) connect(row, column, row + 1, column)
            if (hasCell(glyph, row + 1, column + 1) && !hasCell(glyph, row, column + 1) && !hasCell(glyph, row + 1, column)) {
                connect(row, column, row + 1, column + 1)
            }
            if (hasCell(glyph, row + 1, column - 1) && !hasCell(glyph, row, column - 1) && !hasCell(glyph, row + 1, column)) {
                connect(row, column, row + 1, column - 1)
            }
        }
    }

    for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 5; column++) {
            if (!hasCell(glyph, row, column) || connected.has(`${row}:${column}`)) continue
            const [px, py] = point(row, column)
            ctx.beginPath()
            ctx.arc(px, py, stroke / 2, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    ctx.restore()
}

function drawText(ctx, text, x, y, preferredHeight, options = {}) {
    const spacingRatio = options.spacingRatio ?? 0.16
    const value = normalizeText(text, options.fallback || "MEMBER")
    const height = fitHeight(value, preferredHeight, options.maxWidth, options.minHeight || 7, spacingRatio)
    const { glyphWidth, spacing } = metrics(height, spacingRatio)
    const width = measure(value, height, spacingRatio)

    let cursorX = x
    if (options.align === "center") cursorX -= width / 2
    if (options.align === "right") cursorX -= width

    for (const char of value) {
        drawGlyph(ctx, GLYPHS[char] || GLYPHS["?"], cursorX, y, height, options.color || "#FFFFFF", {
            spacingRatio,
            glowColor: options.glowColor,
            glowBlur: options.glowBlur,
        })
        cursorX += glyphWidth + spacing
    }
    return { value, width, height }
}

function drawLevelTransition(ctx, oldLevel, newLevel) {
    const centerX = 622
    const y = 101
    const preferredHeight = 31
    const maxSideWidth = 55
    const oldText = String(oldLevel)
    const newText = String(newLevel)
    const sideHeight = Math.min(
        fitHeight(oldText, preferredHeight, maxSideWidth, 17, 0.12),
        fitHeight(newText, preferredHeight, maxSideWidth, 17, 0.12),
    )

    drawText(ctx, oldText, 576, y, sideHeight, {
        color: "#FFFFFF",
        align: "center",
        maxWidth: maxSideWidth,
        minHeight: 17,
        spacingRatio: 0.12,
        glowColor: "rgba(168,85,247,0.55)",
        glowBlur: 6,
    })

    ctx.save()
    ctx.fillStyle = "#D8B4FE"
    ctx.shadowColor = "rgba(168,85,247,0.75)"
    ctx.shadowBlur = 7
    ctx.beginPath()
    ctx.arc(centerX, y + sideHeight * 0.56, Math.max(3.5, sideHeight * 0.12), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    drawText(ctx, newText, 668, y, sideHeight, {
        color: "#FFFFFF",
        align: "center",
        maxWidth: maxSideWidth,
        minHeight: 17,
        spacingRatio: 0.12,
        glowColor: "rgba(168,85,247,0.55)",
        glowBlur: 6,
    })
}

function splitServerName(value) {
    const text = normalizeText(value, "DISCORD SERVER")
    if (text.length <= 44) return [text]

    const words = text.split(" ").filter(Boolean)
    if (words.length === 1) {
        const midpoint = Math.ceil(text.length / 2)
        return [text.slice(0, midpoint), text.slice(midpoint)]
    }

    let first = ""
    let second = ""
    for (const word of words) {
        if (!first || (first.length <= second.length && `${first} ${word}`.length <= 52)) {
            first = first ? `${first} ${word}` : word
        } else {
            second = second ? `${second} ${word}` : word
        }
    }
    return second ? [first, second] : [first]
}

function drawServerFooter(ctx, guildName) {
    const footerX = 225
    const footerY = 174
    const footerWidth = 484
    const footerHeight = 38

    ctx.fillStyle = "rgba(7, 3, 16, 0.46)"
    roundRect(ctx, footerX, footerY, footerWidth, footerHeight, 13)
    ctx.fill()

    ctx.fillStyle = "rgba(168, 85, 247, 0.55)"
    roundRect(ctx, footerX, footerY, 5, footerHeight, 3)
    ctx.fill()

    const lines = splitServerName(guildName)
    const preferredHeight = lines.length === 1 ? 14 : 10
    const minHeight = lines.length === 1 ? 9 : 7
    const gap = lines.length === 1 ? 0 : 3
    const heights = lines.map(line => fitHeight(line, preferredHeight, 452, minHeight, 0.12))
    const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, lines.length - 1)
    let y = footerY + (footerHeight - totalHeight) / 2

    lines.forEach((line, index) => {
        drawText(ctx, line, footerX + footerWidth / 2 + 2, y, heights[index], {
            color: "#DDD6FE",
            align: "center",
            maxWidth: 452,
            minHeight,
            spacingRatio: 0.12,
            glowColor: "rgba(168,85,247,0.32)",
            glowBlur: 3,
        })
        y += heights[index] + gap
    })
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
        return await loadImage(Buffer.from(await response.arrayBuffer()))
    } catch {
        return null
    }
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
    ctx.fillRect(350, 0, 410, HEIGHT)
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
        drawText(ctx, "?", avatarX + avatarSize / 2, avatarY + 50, 58, {
            color: "#D8B4FE",
            align: "center",
            glowColor: "rgba(168,85,247,0.65)",
            glowBlur: 8,
        })
    }
    ctx.restore()

    drawText(ctx, "CURSED LEVELING", 235, 29, 17, {
        color: "#F5D0FE",
        maxWidth: 285,
        minHeight: 11,
        spacingRatio: 0.14,
        glowColor: "rgba(168,85,247,0.42)",
        glowBlur: 5,
    })

    drawText(ctx, "LEVEL-UP!", 235, 63, 36, {
        color: "#FFFFFF",
        maxWidth: 285,
        minHeight: 24,
        spacingRatio: 0.14,
        glowColor: "rgba(168,85,247,0.80)",
        glowBlur: 10,
    })

    // Use the account username here. The server name appears only in the footer.
    drawText(ctx, user?.username || displayName || "Member", 235, 121, 23, {
        color: "#E9D5FF",
        maxWidth: 285,
        minHeight: 11,
        spacingRatio: 0.13,
    })

    ctx.fillStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, 535, 52, 174, 112, 22)
    ctx.fill()

    drawText(ctx, "LEVEL", 622, 65, 14, {
        color: "#D8B4FE",
        align: "center",
        maxWidth: 142,
        minHeight: 10,
        spacingRatio: 0.13,
    })

    drawLevelTransition(ctx, oldLevel, newLevel)
    drawServerFooter(ctx, guildName || "Discord Server")

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
