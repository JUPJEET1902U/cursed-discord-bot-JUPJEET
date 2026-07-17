const { createCanvas, loadImage } = require("@napi-rs/canvas")

const WIDTH = 760
const HEIGHT = 240

// Compact built-in glyph map. The renderer connects these points with rounded,
// anti-aliased strokes, producing smooth neon-style lettering without relying
// on Railway/Linux fonts or shipping a font file.
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
    "•": ["00000","00000","00100","01110","00100","00000","00000"],
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

function normalizeSmoothText(value, fallback = "MEMBER") {
    const source = String(value || fallback)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()

    let normalized = ""
    for (const char of source) {
        if (GLYPHS[char]) {
            normalized += char
        } else if (/\s/u.test(char) || char.codePointAt(0) > 127) {
            // Decorative emoji are omitted rather than becoming ugly question marks.
            normalized += " "
        } else {
            normalized += "?"
        }
    }

    return normalized.replace(/\s+/g, " ").trim() || String(fallback || "")
}

function smoothMetrics(height, letterSpacingRatio = 0.22) {
    const stepY = height / 6
    const stepX = stepY * 0.82
    const stroke = Math.max(1.15, stepY * 0.66)
    const glyphWidth = stepX * 4 + stroke
    const spacing = height * letterSpacingRatio
    return { stepX, stepY, stroke, glyphWidth, spacing }
}

function measureSmoothText(text, height, letterSpacingRatio = 0.22) {
    const value = normalizeSmoothText(text, "")
    if (!value) return 0
    const { glyphWidth, spacing } = smoothMetrics(height, letterSpacingRatio)
    return value.length * glyphWidth + Math.max(0, value.length - 1) * spacing
}

function fitSmoothHeight(text, preferredHeight, maxWidth, minHeight = 3, letterSpacingRatio = 0.22) {
    if (!maxWidth) return preferredHeight
    const width = measureSmoothText(text, preferredHeight, letterSpacingRatio)
    if (width <= maxWidth) return preferredHeight
    return Math.max(minHeight, preferredHeight * (maxWidth / width))
}

function hasCell(glyph, row, column) {
    return Boolean(glyph[row]?.[column] === "1")
}

function drawSmoothGlyph(ctx, glyph, x, y, height, color, options = {}) {
    const { stepX, stepY, stroke } = smoothMetrics(height, options.letterSpacingRatio)
    const point = (row, column) => [x + column * stepX + stroke / 2, y + row * stepY + stroke / 2]

    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = stroke
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    if (options.glowColor && options.glowBlur > 0) {
        ctx.shadowColor = options.glowColor
        ctx.shadowBlur = options.glowBlur
    }

    const drawnNodes = new Set()
    const connect = (rowA, colA, rowB, colB) => {
        const [ax, ay] = point(rowA, colA)
        const [bx, by] = point(rowB, colB)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        drawnNodes.add(`${rowA}:${colA}`)
        drawnNodes.add(`${rowB}:${colB}`)
    }

    for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 5; column++) {
            if (!hasCell(glyph, row, column)) continue

            if (hasCell(glyph, row, column + 1)) connect(row, column, row, column + 1)
            if (hasCell(glyph, row + 1, column)) connect(row, column, row + 1, column)

            // Join diagonal stair-steps only when no orthogonal route exists.
            if (
                hasCell(glyph, row + 1, column + 1) &&
                !hasCell(glyph, row, column + 1) &&
                !hasCell(glyph, row + 1, column)
            ) {
                connect(row, column, row + 1, column + 1)
            }
            if (
                hasCell(glyph, row + 1, column - 1) &&
                !hasCell(glyph, row, column - 1) &&
                !hasCell(glyph, row + 1, column)
            ) {
                connect(row, column, row + 1, column - 1)
            }
        }
    }

    // Preserve isolated punctuation dots and any intentionally isolated nodes.
    for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 5; column++) {
            if (!hasCell(glyph, row, column) || drawnNodes.has(`${row}:${column}`)) continue
            const [px, py] = point(row, column)
            ctx.beginPath()
            ctx.arc(px, py, stroke / 2, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    ctx.restore()
}

function drawSmoothText(ctx, text, x, y, preferredHeight, options = {}) {
    const {
        color = "#FFFFFF",
        align = "left",
        maxWidth = null,
        minHeight = 3,
        letterSpacingRatio = 0.22,
        glowColor = null,
        glowBlur = 0,
    } = options

    const value = normalizeSmoothText(text)
    const height = fitSmoothHeight(value, preferredHeight, maxWidth, minHeight, letterSpacingRatio)
    const { glyphWidth, spacing } = smoothMetrics(height, letterSpacingRatio)
    const width = measureSmoothText(value, height, letterSpacingRatio)
    let cursorX = x
    if (align === "center") cursorX -= width / 2
    if (align === "right") cursorX -= width

    for (const char of value) {
        drawSmoothGlyph(ctx, GLYPHS[char] || GLYPHS["?"], cursorX, y, height, color, {
            letterSpacingRatio,
            glowColor,
            glowBlur,
        })
        cursorX += glyphWidth + spacing
    }

    return { width, height, text: value }
}

function splitBalanced(text, lineCount) {
    const value = normalizeSmoothText(text)
    if (lineCount <= 1 || value.length <= 1) return [value]

    const words = value.split(" ").filter(Boolean)
    if (words.length > 1) {
        const lines = Array.from({ length: lineCount }, () => "")
        const targetLength = value.length / lineCount
        let lineIndex = 0

        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
            const word = words[wordIndex]
            const candidate = lines[lineIndex] ? `${lines[lineIndex]} ${word}` : word
            const wordsRemaining = words.length - wordIndex - 1
            const linesRemaining = lineCount - lineIndex - 1

            if (lines[lineIndex] && candidate.length > targetLength && wordsRemaining >= linesRemaining) {
                lineIndex = Math.min(lineIndex + 1, lineCount - 1)
            }
            lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]} ${word}` : word
        }
        return lines.filter(Boolean)
    }

    const lines = []
    let start = 0
    for (let index = 0; index < lineCount; index++) {
        const remaining = value.length - start
        const slots = lineCount - index
        const take = Math.ceil(remaining / slots)
        lines.push(value.slice(start, start + take))
        start += take
    }
    return lines.filter(Boolean)
}

function fitWrappedSmoothText(text, maxWidth, maxHeight, options = {}) {
    const {
        preferredHeight = 11,
        maxLines = 3,
        minHeight = 3,
        lineGapRatio = 0.28,
        letterSpacingRatio = 0.16,
    } = options

    let best = null
    for (let lineCount = 1; lineCount <= maxLines; lineCount++) {
        const lines = splitBalanced(text, lineCount)
        const maxHeightPerLine = maxHeight / (lines.length + lineGapRatio * Math.max(0, lines.length - 1))
        let height = Math.min(preferredHeight, maxHeightPerLine)

        for (const line of lines) {
            height = Math.min(height, fitSmoothHeight(line, height, maxWidth, minHeight, letterSpacingRatio))
        }

        const gap = height * lineGapRatio
        const totalHeight = lines.length * height + Math.max(0, lines.length - 1) * gap
        const fits = totalHeight <= maxHeight + 0.5 &&
            lines.every(line => measureSmoothText(line, height, letterSpacingRatio) <= maxWidth + 0.5)

        if (!fits) continue
        const score = height - (lines.length - 1) * 0.06
        if (!best || score > best.score) {
            best = { lines, height, gap, totalHeight, score, letterSpacingRatio }
        }
    }

    if (best) return best

    // Discord guild names are bounded, but this final fallback still preserves
    // every character by shrinking rather than adding an ellipsis.
    const lines = splitBalanced(text, maxLines)
    let height = minHeight
    while (height > 2.2 && lines.some(line => measureSmoothText(line, height, letterSpacingRatio) > maxWidth)) {
        height -= 0.2
    }
    const gap = height * lineGapRatio
    return {
        lines,
        height,
        gap,
        totalHeight: lines.length * height + Math.max(0, lines.length - 1) * gap,
        score: height,
        letterSpacingRatio,
    }
}

function drawWrappedSmoothText(ctx, text, centerX, topY, maxWidth, maxHeight, options = {}) {
    const layout = fitWrappedSmoothText(text, maxWidth, maxHeight, options)
    const startY = topY + Math.max(0, (maxHeight - layout.totalHeight) / 2)

    layout.lines.forEach((line, index) => {
        drawSmoothText(ctx, line, centerX, startY + index * (layout.height + layout.gap), layout.height, {
            color: options.color || "#FFFFFF",
            align: "center",
            maxWidth,
            minHeight: 2.2,
            letterSpacingRatio: layout.letterSpacingRatio,
            glowColor: options.glowColor || null,
            glowBlur: options.glowBlur || 0,
        })
    })

    return layout
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
        drawSmoothText(ctx, "?", avatarX + avatarSize / 2, avatarY + 48, 58, {
            color: "#D8B4FE",
            align: "center",
            glowColor: "rgba(168,85,247,0.65)",
            glowBlur: 8,
        })
    }
    ctx.restore()

    drawSmoothText(ctx, "CURSED LEVELING", 235, 29, 17, {
        color: "#F5D0FE",
        maxWidth: 285,
        minHeight: 10,
        letterSpacingRatio: 0.18,
        glowColor: "rgba(168,85,247,0.42)",
        glowBlur: 5,
    })

    drawSmoothText(ctx, "LEVEL-UP!", 235, 64, 36, {
        color: "#FFFFFF",
        maxWidth: 285,
        minHeight: 23,
        letterSpacingRatio: 0.18,
        glowColor: "rgba(168,85,247,0.80)",
        glowBlur: 10,
    })

    drawSmoothText(ctx, displayName || user?.username || "Member", 235, 124, 23, {
        color: "#E9D5FF",
        maxWidth: 285,
        minHeight: 10,
        letterSpacingRatio: 0.16,
    })

    ctx.fillStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, 535, 53, 174, 128, 22)
    ctx.fill()

    drawSmoothText(ctx, "LEVEL", 622, 65, 14, {
        color: "#D8B4FE",
        align: "center",
        maxWidth: 142,
        minHeight: 9,
        letterSpacingRatio: 0.16,
    })

    drawSmoothText(ctx, `${oldLevel} • ${newLevel}`, 622, 98, 31, {
        color: "#FFFFFF",
        align: "center",
        maxWidth: 150,
        minHeight: 15,
        letterSpacingRatio: 0.18,
        glowColor: "rgba(168,85,247,0.55)",
        glowBlur: 6,
    })

    drawWrappedSmoothText(ctx, guildName || "Discord Server", 622, 142, 150, 33, {
        color: "#C4B5FD",
        preferredHeight: 11,
        maxLines: 3,
        minHeight: 3,
        lineGapRatio: 0.26,
        letterSpacingRatio: 0.13,
    })

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
