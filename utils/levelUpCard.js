const { createCanvas, loadImage } = require("@napi-rs/canvas")

const WIDTH = 760
const HEIGHT = 240

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
        ctx.font = "800 62px Arial"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("?", avatarX + avatarSize / 2, avatarY + avatarSize / 2)
    }
    ctx.restore()

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = "#F5D0FE"
    ctx.font = "800 22px Arial"
    ctx.fillText("CURSED LEVELING", 235, 52)

    ctx.fillStyle = "#FFFFFF"
    ctx.font = "900 48px Arial"
    ctx.fillText("LEVEL-UP!", 235, 105)

    ctx.fillStyle = "#E9D5FF"
    ctx.font = "700 27px Arial"
    ctx.fillText(truncateText(ctx, displayName || user?.username || "Member", 285), 235, 142)

    ctx.fillStyle = "rgba(255,255,255,0.10)"
    roundRect(ctx, 535, 53, 174, 128, 22)
    ctx.fill()

    ctx.fillStyle = "#D8B4FE"
    ctx.font = "700 17px Arial"
    ctx.textAlign = "center"
    ctx.fillText("LEVEL", 622, 83)

    ctx.fillStyle = "#FFFFFF"
    ctx.font = "900 39px Arial"
    ctx.fillText(`${oldLevel}  •  ${newLevel}`, 622, 132)

    ctx.fillStyle = "#C4B5FD"
    ctx.font = "500 15px Arial"
    ctx.fillText(truncateText(ctx, guildName || "Discord Server", 145), 622, 160)

    return canvas.toBuffer("image/png")
}

module.exports = { generateLevelUpCard, WIDTH, HEIGHT }
