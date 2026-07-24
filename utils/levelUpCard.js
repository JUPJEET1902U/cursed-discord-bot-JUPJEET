const { createCanvas, loadImage } = require("@napi-rs/canvas")
const { getLevelProgress, totalXpForLevel } = require("./levelingMath")

const WIDTH = 1000
const HEIGHT = 360
const FONT = '"DejaVu Sans", "Noto Sans", sans-serif'

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

function setFont(ctx, size, weight = 700) {
    ctx.font = `${weight} ${Math.max(1, Math.floor(size))}px ${FONT}`
}

function fittedFont(ctx, value, maxWidth, preferred, minimum = 12, weight = 700) {
    const text = String(value || "")
    let size = preferred
    setFont(ctx, size, weight)
    while (size > minimum && ctx.measureText(text).width > maxWidth) {
        size -= 1
        setFont(ctx, size, weight)
    }
    return size
}

function shorten(ctx, value, maxWidth) {
    const text = String(value || "")
    if (ctx.measureText(text).width <= maxWidth) return text
    let result = text
    while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
    return `${result.trim()}…`
}

function text(ctx, value, x, y, options = {}) {
    const {
        size = 20,
        minSize = 11,
        weight = 700,
        color = "#FFFFFF",
        maxWidth,
        align = "left",
        baseline = "alphabetic",
        glowColor,
        glowBlur = 0,
        tracking = 0,
    } = options
    const raw = String(value || "")
    const actualSize = maxWidth ? fittedFont(ctx, raw, maxWidth, size, minSize, weight) : size
    setFont(ctx, actualSize, weight)
    const output = maxWidth ? shorten(ctx, raw, maxWidth) : raw

    ctx.save()
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = baseline
    if (glowColor && glowBlur) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
    }

    if (!tracking) {
        ctx.fillText(output, x, y)
        ctx.restore()
        return
    }

    const characters = [...output]
    const widths = characters.map(character => ctx.measureText(character).width)
    const total = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, characters.length - 1)
    let cursor = x
    if (align === "center") cursor -= total / 2
    if (align === "right") cursor -= total
    ctx.textAlign = "left"
    characters.forEach((character, index) => {
        ctx.fillText(character, cursor, y)
        cursor += widths[index] + tracking
    })
    ctx.restore()
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

    text(ctx, label, options.dot ? x + 30 : x + width / 2, y + height / 2 + 1, {
        size: 14,
        minSize: 10,
        weight: 800,
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
        text(ctx, "?", x + size / 2, y + size / 2, {
            size: 78,
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
    text(ctx, "↑", x + size - 5, y + size - 5, {
        size: 27,
        weight: 900,
        align: "center",
        baseline: "middle",
        glowColor: "rgba(255,255,255,0.8)",
        glowBlur: 5,
    })
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
    text(ctx, guildName || "Discord Server", 752, 70, {
        size: 14,
        minSize: 10,
        weight: 700,
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

    text(ctx, "LEVEL", x, y - 42, {
        size: 15,
        weight: 800,
        color: "#D8B4FE",
        align: "center",
        tracking: 2,
    })
    text(ctx, String(level), x, y + 20, {
        size: 80,
        minSize: 42,
        weight: 900,
        maxWidth: radius * 1.45,
        align: "center",
        baseline: "middle",
        glowColor: "rgba(216,180,254,0.65)",
        glowBlur: 12,
    })
    text(ctx, "UNLOCKED", x, y + 67, {
        size: 12,
        weight: 800,
        color: "#F0ABFC",
        align: "center",
        tracking: 1.5,
    })
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

    text(ctx, "CURSED  //  LEVELING", 270, 71, {
        size: 16,
        weight: 800,
        color: "#C4B5FD",
        tracking: 1.4,
    })
    text(ctx, `LEVEL ${currentLevel} UNLOCKED`, 270, 127, {
        size: 40,
        minSize: 28,
        weight: 900,
        maxWidth: 430,
        glowColor: "rgba(168,85,247,0.5)",
        glowBlur: 12,
    })
    text(ctx, displayName || user?.globalName || user?.username || "Member", 270, 169, {
        size: 25,
        minSize: 16,
        weight: 700,
        color: "#E9D5FF",
        maxWidth: 425,
    })

    pill(ctx, 270, 194, 158, `${oldLevel}  →  ${currentLevel}`, {
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

    text(ctx, `PROGRESS TO LEVEL ${currentLevel + 1}`, 270, 263, {
        size: 13,
        weight: 800,
        color: "#C4B5FD",
        tracking: 1,
    })
    text(ctx, `${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP`, 710, 263, {
        size: 13,
        weight: 700,
        color: "#E9D5FF",
        align: "right",
    })
    progressBar(ctx, 270, 278, 440, progress.ratio)
    text(ctx, `${Math.max(0, progress.needed - progress.current).toLocaleString()} XP until the next level`, 270, 318, {
        size: 13,
        weight: 600,
        color: "rgba(233,213,255,0.72)",
    })

    medallion(ctx, 835, 208, 99, currentLevel)
    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
