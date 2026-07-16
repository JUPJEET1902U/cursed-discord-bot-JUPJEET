/**
 * utils/welcomeCard.js
 * PNG welcome card generation backed by @napi-rs/canvas.
 */

const { createCanvas, loadImage } = require("@napi-rs/canvas")

const WIDTH = 1000
const HEIGHT = 420
const DEFAULT_ACCENT = "#5865F2"
const THEMES = {
    classic: {
        background: ["#111827", "#1f2937"],
        panel: "rgba(17, 24, 39, 0.78)",
        text: "#FFFFFF",
        muted: "#D1D5DB",
    },
    midnight: {
        background: ["#020617", "#172554"],
        panel: "rgba(2, 6, 23, 0.82)",
        text: "#F8FAFC",
        muted: "#CBD5E1",
    },
    neon: {
        background: ["#12001F", "#111827"],
        panel: "rgba(17, 24, 39, 0.76)",
        text: "#FFFFFF",
        muted: "#E9D5FF",
    },
}

function normalizeTheme(theme) {
    return THEMES[theme] ? theme : "classic"
}

function normalizeHex(value, fallback = DEFAULT_ACCENT) {
    if (typeof value !== "string") return fallback
    const raw = value.trim().replace(/^#/, "")
    return /^[0-9A-Fa-f]{6}$/.test(raw) ? `#${raw}` : fallback
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

function truncateText(ctx, text, maxWidth) {
    if (!text) return ""
    let out = String(text)
    if (ctx.measureText(out).width <= maxWidth) return out

    while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) {
        out = out.slice(0, -1)
    }
    return `${out}...`
}

async function loadRemoteImage(url) {
    if (!url || typeof fetch !== "function") return null
    try {
        const parsed = new URL(url)
        if (!["http:", "https:"].includes(parsed.protocol)) return null
        const response = await fetch(parsed)
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        return await loadImage(buffer)
    } catch {
        return null
    }
}

function drawGradientBackground(ctx, theme) {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    gradient.addColorStop(0, theme.background[0])
    gradient.addColorStop(1, theme.background[1])
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

function drawAvatar(ctx, avatarImage, accent) {
    const x = 70
    const y = 90
    const size = 210

    ctx.save()
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)"
    ctx.shadowBlur = 18
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()
    if (avatarImage) {
        drawCoverImage(ctx, avatarImage, x, y, size, size)
    } else {
        ctx.fillStyle = "#374151"
        ctx.fillRect(x, y, size, size)
        ctx.fillStyle = "#9CA3AF"
        ctx.font = "700 84px Arial"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("?", x + size / 2, y + size / 2)
    }
    ctx.restore()
}

/**
 * Generate a PNG buffer for a new member welcome card.
 * @param {import("discord.js").GuildMember} member
 * @param {object} config
 * @param {{ assignedRoleId?: string|null }} options
 * @returns {Promise<Buffer>}
 */
async function generateWelcomeCard(member, config = {}, options = {}) {
    const canvas = createCanvas(WIDTH, HEIGHT)
    const ctx = canvas.getContext("2d")
    const theme = THEMES[normalizeTheme(config.welcomeCardTheme)]
    const accent = normalizeHex(config.welcomeAccentColor || config.welcomeColor)

    const background = await loadRemoteImage(config.welcomeCardBackground || config.welcomeMediaUrl)
    if (background) {
        drawCoverImage(ctx, background, 0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
    } else {
        drawGradientBackground(ctx, theme)
    }

    ctx.save()
    ctx.fillStyle = theme.panel
    roundRect(ctx, 36, 36, WIDTH - 72, HEIGHT - 72, 34)
    ctx.fill()
    ctx.restore()

    ctx.fillStyle = accent
    roundRect(ctx, 36, 36, 10, HEIGHT - 72, 6)
    ctx.fill()

    const avatarUrl = member.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 })
    const avatar = await loadRemoteImage(avatarUrl)
    drawAvatar(ctx, avatar, accent)

    const guildName = member.guild?.name || "the server"
    const displayName = member.displayName || member.user?.username || "new member"
    const roleText = options.assignedRoleId ? `Role assigned: ${options.assignedRoleId}` : null

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = accent
    ctx.font = "700 34px Arial"
    ctx.fillText("WELCOME", 330, 112)

    ctx.fillStyle = theme.text
    ctx.font = "800 58px Arial"
    ctx.fillText(truncateText(ctx, displayName, 585), 330, 185)

    ctx.fillStyle = theme.muted
    ctx.font = "500 30px Arial"
    ctx.fillText(truncateText(ctx, `to ${guildName}`, 585), 330, 235)

    ctx.fillStyle = "rgba(255, 255, 255, 0.16)"
    roundRect(ctx, 330, 274, 585, 70, 18)
    ctx.fill()

    ctx.fillStyle = theme.text
    ctx.font = "700 24px Arial"
    const memberCount = member.guild?.memberCount ? `Member #${member.guild.memberCount}` : "New member"
    ctx.fillText(memberCount, 354, 318)

    if (roleText) {
        ctx.fillStyle = theme.muted
        ctx.font = "500 18px Arial"
        ctx.fillText(truncateText(ctx, roleText, 350), 545, 318)
    }

    return canvas.toBuffer("image/png")
}

module.exports = {
    generateWelcomeCard,
    WIDTH,
    HEIGHT,
}
