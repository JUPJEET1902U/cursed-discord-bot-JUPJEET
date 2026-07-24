const { createCanvas, loadImage } = require("@napi-rs/canvas")
const { getLevelProgress } = require("./levelingMath")

const WIDTH = 1000
const HEIGHT = 360
const FONT_STACK = '"DejaVu Sans", "Noto Sans", sans-serif'

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
        const response = await fetch(parsed, { signal: AbortSignal.timeout?.(5000) })
        if (!response.ok) return null
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > 8 * 1024 * 1024) return null
        return await loadImage(bytes)
    } catch {
        return null
    }
}

function setFont(ctx, weight, size) {
    ctx.font = `${weight} ${Math.max(1, Math.floor(size))}px ${FONT_STACK}`
}

function fitText(ctx, value, maxWidth, preferredSize, minSize = 12, weight = 700) {
    const text = String(value || "")
    let size = preferredSize
    setFont(ctx, weight, size)
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
        size -= 1
        setFont(ctx, weight, size)
    }
    return size
}

function ellipsize(ctx, value, maxWidth) {
    const text = String(value || "")
    if (ctx.measureText(text).width <= maxWidth) return text
    let output = text
    while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) {
        output = output.slice(0, -1)
    }
    return `${output.trim()}…`
}

function drawText(ctx, value, x, y, options = {}) {
    const {
        size = 24,
        minSize = 12,
        weight = 700,
        color = "#FFFFFF",
        maxWidth,
        align = "left",
        baseline = "alphabetic",
        glowColor,
        glowBlur = 0,
        letterSpacing = 0,
    } = options
    const text = String(value || "")
    const actualSize = maxWidth ? fitText(ctx, text, maxWidth, size, minSize, weight) : size
    setFont(ctx, weight, actualSize)
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.fillStyle = color
    ctx.save()
    if (glowColor && glowBlur > 0) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
    }

    if (!letterSpacing) {
        ctx.fillText(maxWidth ? ellipsize(ctx, text, maxWidth) : text, x, y)
        ctx.restore()
        return actualSize
    }

    const chars = [...text]
    const widths = chars.map(char => ctx.measureText(char).width)
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + letterSpacing * Math.max(0, chars.length - 1)
    let cursor = x
    if (align === "center") cursor -= totalWidth / 2
    if (align === "right") cursor -= totalWidth
    ctx.textAlign = "left"
    chars.forEach((char, index) => {
        ctx.fillText(char, cursor, y)
        cursor += widths[index] + letterSpacing
    })
    ctx.restore()
    return actualSize
}

function drawPill(ctx, x, y, width, height, label, options = {}) {
    const {
        background = "rgba(255,255,255,0.07)",
        border = "rgba(255,255,255,0.10)",
        color = "#E9D5FF",
        accent = null,
    } = options
    ctx.fillStyle = background
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.fill()
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.stroke()
    if (accent) {
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(x + 17, y + height / 2, 4, 0, Math.PI * 2)
        ctx.fill()
    }
    drawText(ctx, label, x + (accent ? 30 : width / 2), y + height / 2 + 1, {
        size: 14,
        minSize: 10,
        weight: 700,
        color,
        maxWidth: width - (accent ? 42 : 20),
        align: accent ? "left" : "center",
        baseline: "middle",
    })
}

function drawProgressBar(ctx, x, y, width, height, ratio) {
    const safeRatio = clamp(ratio, 0, 1)
    ctx.fillStyle = "rgba(255,255,255,0.08)"
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.fill()

    if (safeRatio > 0) {
        const fillWidth = Math.max(height, width * safeRatio)
        const gradient = ctx.createLinearGradient(x, y, x + width, y)
        gradient.addColorStop(0, "#7C3AED")
        gradient.addColorStop(0.5, "#A855F7")
        gradient.addColorStop(1, "#EC4899")
        ctx.save()
        ctx.shadowColor = "rgba(168,85,247,0.85)"
        ctx.shadowBlur = 14
        ctx.fillStyle = gradient
        roundRect(ctx, x, y, Math.min(width, fillWidth), height, height / 2)
        ctx.fill()
        ctx.restore()
    }

    ctx.strokeStyle = "rgba(255,255,255,0.10)"
    ctx.lineWidth = 1
    roundRect(ctx, x, y, width, height, height / 2)
    ctx.stroke()
}

function drawBackground(ctx) {
    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    background.addColorStop(0, "#05030B")
    background.addColorStop(0.48, "#10051C")
    background.addColorStop(1, "#26063D")
    ctx.fillStyle = background
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    const leftGlow = ctx.createRadialGradient(85, 55, 10, 85, 55, 310)
    leftGlow.addColorStop(0, "rgba(124,58,237,0.46)")
    leftGlow.addColorStop(1, "rgba(124,58,237,0)")
    ctx.fillStyle = leftGlow
    ctx.fillRect(0, 0, 430, HEIGHT)

    const rightGlow = ctx.createRadialGradient(900, 250, 10, 900, 250, 320)
    rightGlow.addColorStop(0, "rgba(236,72,153,0.28)")
    rightGlow.addColorStop(1, "rgba(236,72,153,0)")
    ctx.fillStyle = rightGlow
    ctx.fillRect(590, 0, 410, HEIGHT)

    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.strokeStyle = "#C084FC"
    ctx.lineWidth = 1
    for (let x = -60; x < WIDTH + 100; x += 72) {
        ctx.beginPath()
        ctx.moveTo(x, HEIGHT)
        ctx.lineTo(x + 180, 0)
        ctx.stroke()
    }
    ctx.restore()
}

async function drawAvatar(ctx, user, x, y, size) {
    const avatarUrl = user?.displayAvatarURL?.({ extension: "png", forceStatic: true, size: 512 })
    const avatar = await loadRemoteImage(avatarUrl)

    ctx.save()
    ctx.shadowColor = "rgba(168,85,247,0.85)"
    ctx.shadowBlur = 28
    const ring = ctx.createLinearGradient(x, y, x + size, y + size)
    ring.addColorStop(0, "#8B5CF6")
    ring.addColorStop(0.55, "#D946EF")
    ring.addColorStop(1, "#F472B6")
    ctx.fillStyle = ring
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    if (avatar) {
        drawCoverImage(ctx, avatar, x, y, size, size)
    } else {
        const fallback = ctx.createLinearGradient(x, y, x + size, y + size)
        fallback.addColorStop(0, "#1F1630")
        fallback.addColorStop(1, "#3B1558")
        ctx.fillStyle = fallback
        ctx.fillRect(x, y, size, size)
        drawText(ctx, "?", x + size / 2, y + size / 2 + 2, {
            size: 78,
            weight: 800,
            color: "#E9D5FF",
            align: "center",
            baseline: "middle",
        })
    }
    ctx.restore()

    ctx.fillStyle = "#0B0612"
    ctx.beginPath()
    ctx.arc(x + size - 4, y + size - 4, 27, 0, Math.PI * 2)
    ctx.fill()
    const badge = ctx.createLinearGradient(x + size - 24, y + size - 24, x + size + 20, y + size + 20)
    badge.addColorStop(0, "#A855F7")
    badge.addColorStop(1, "#EC4899")
    ctx.fillStyle = badge
    ctx.beginPath()
    ctx.arc(x + size - 4, y + size - 4, 22, 0, Math.PI * 2)
    ctx.fill()
    drawText(ctx, "↑", x + size - 4, y + size - 3, {
        size: 26,
        weight: 900,
        color: "#FFFFFF",
        align: "center",
        baseline: "middle",
        glowColor: "rgba(255,255,255,0.8)",
        glowBlur: 5,
    })
}

async function drawGuildBadge(ctx, guildName, guildIconUrl) {
    const icon = await loadRemoteImage(guildIconUrl)
    const x = 716
    const y = 48
    const width = 225
    const height = 42

    ctx.fillStyle = "rgba(7,3,16,0.48)"
    roundRect(ctx, x, y, width, height, 16)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.09)"
    ctx.stroke()

    if (icon) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x + 22, y + 21, 14, 0, Math.PI * 2)
        ctx.clip()
        drawCoverImage(ctx, icon, x + 8, y + 7, 28, 28)
        ctx.restore()
    } else {
        ctx.fillStyle = "rgba(168,85,247,0.28)"
        ctx.beginPath()
        ctx.arc(x + 22, y + 21, 14, 0, Math.PI * 2)
        ctx.fill()
    }

    drawText(ctx, guildName || "Discord Server", x + 45, y + 22, {
        size: 14,
        minSize: 10,
        weight: 700,
        color: "#DDD6FE",
        maxWidth: width - 58,
        baseline: "middle",
    })
}

function drawLevelMedallion(ctx, x, y, radius, level) {
    ctx.save()
    ctx.shadowColor = "rgba(168,85,247,0.65)"
    ctx.shadowBlur = 32
    const outer = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
    outer.addColorStop(0, "#7C3AED")
    outer.addColorStop(0.48, "#D946EF")
    outer.addColorStop(1, "#FB7185")
    ctx.fillStyle = outer
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    const inner = ctx.createRadialGradient(x - 24, y - 28, 10, x, y, radius - 8)
    inner.addColorStop(0, "#3B185B")
    inner.addColorStop(1, "#0B0612")
    ctx.fillStyle = inner
    ctx.beginPath()
    ctx.arc(x, y, radius - 8, 0, Math.PI * 2)
    ctx.fill()

    drawText(ctx, "LEVEL", x, y - 39, {
        size: 15,
        weight: 800,
        color: "#D8B4FE",
        align: "center",
        letterSpacing: 2,
    })
    drawText(ctx, String(level), x, y + 25, {
        size: 80,
        minSize: 42,
        weight: 900,
        color: "#FFFFFF",
        maxWidth: radius * 1.45,
        align: "center",
        baseline: "middle",
        glowColor: "rgba(216,180,254,0.65)",
        glowBlur: 12,
    })
    drawText(ctx, "UNLOCKED", x, y + 66, {
        size: 12,
        weight: 800,
        color: "#F0ABFC",
        align: "center",
        letterSpacing: 1.5,
    })
}

async function generateLevelUpCard({
    user,
    displayName,
    guildName,
    guildIconUrl,
    oldLevel,
    newLevel,
    xp = 0,
    xpGain = 0,
}) {
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext("2d")
    const progress = getLevelProgress(xp)
    const currentLevel = Math.max(Number(newLevel) || progress.level, progress.level)

    drawBackground(ctx)

    ctx.save()
    ctx.shadowColor = "rgba(0,0,0,0.65)"
    ctx.shadowBlur = 36
    ctx.fillStyle = "rgba(10,6,18,0.82)"
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

    await drawAvatar(ctx, user, 66, 96, 160)
    await drawGuildBadge(ctx, guildName, guildIconUrl)

    drawText(ctx, "CURSED  //  LEVELING", 270, 71, {
        size: 16,
        weight: 800,
        color: "#C4B5FD",
        letterSpacing: 1.4,
    })

    drawText(ctx, `LEVEL ${currentLevel} UNLOCKED`, 270, 127, {
        size: 40,
        minSize: 28,
        weight: 900,
        color: "#FFFFFF",
        maxWidth: 430,
        glowColor: "rgba(168,85,247,0.48)",
        glowBlur: 12,
    })

    drawText(ctx, displayName || user?.globalName || user?.username || "Member", 270, 169, {
        size: 25,
        minSize: 16,
        weight: 700,
        color: "#E9D5FF",
        maxWidth: 425,
    })

    drawPill(ctx, 270, 194, 158, 38, `${oldLevel}  →  ${currentLevel}`, {
        background: "rgba(168,85,247,0.12)",
        border: "rgba(192,132,252,0.24)",
        color: "#F5D0FE",
    })
    drawPill(ctx, 440, 194, 130, 38, `+${Math.max(0, Math.floor(xpGain)).toLocaleString()} XP`, {
        background: "rgba(236,72,153,0.09)",
        border: "rgba(244,114,182,0.20)",
        color: "#FBCFE8",
        accent: "#EC4899",
    })
    drawPill(ctx, 582, 194, 128, 38, `${Math.max(0, Math.floor(xp)).toLocaleString()} TOTAL`, {
        background: "rgba(124,58,237,0.10)",
        border: "rgba(167,139,250,0.20)",
        color: "#DDD6FE",
        accent: "#8B5CF6",
    })

    drawText(ctx, `PROGRESS TO LEVEL ${currentLevel + 1}`, 270, 263, {
        size: 13,
        weight: 800,
        color: "#C4B5FD",
        letterSpacing: 1,
    })
    drawText(ctx, `${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP`, 710, 263, {
        size: 13,
        weight: 700,
        color: "#E9D5FF",
        align: "right",
    })
    drawProgressBar(ctx, 270, 278, 440, 16, progress.ratio)

    drawText(ctx, `${Math.max(0, progress.needed - progress.current).toLocaleString()} XP until the next level`, 270, 318, {
        size: 13,
        weight: 600,
        color: "rgba(233,213,255,0.72)",
    })

    drawLevelMedallion(ctx, 835, 208, 99, currentLevel)

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
