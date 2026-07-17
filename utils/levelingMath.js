const DEFAULT_XP_MIN = 15
const DEFAULT_XP_MAX = 25
const DEFAULT_COOLDOWN_SECONDS = 60

function xpNeededForNextLevel(level) {
    const safeLevel = Math.max(0, Math.floor(Number(level) || 0))
    return 5 * safeLevel * safeLevel + 50 * safeLevel + 100
}

function totalXpForLevel(level) {
    const target = Math.max(0, Math.floor(Number(level) || 0))
    let total = 0
    for (let current = 0; current < target; current++) {
        total += xpNeededForNextLevel(current)
    }
    return total
}

function levelFromXp(xp) {
    const safeXp = Math.max(0, Math.floor(Number(xp) || 0))
    let level = 0
    let threshold = xpNeededForNextLevel(0)
    let spent = 0

    while (safeXp >= spent + threshold && level < 10000) {
        spent += threshold
        level += 1
        threshold = xpNeededForNextLevel(level)
    }

    return level
}

function getLevelProgress(xp) {
    const safeXp = Math.max(0, Math.floor(Number(xp) || 0))
    const level = levelFromXp(safeXp)
    const levelStartXp = totalXpForLevel(level)
    const needed = xpNeededForNextLevel(level)
    const current = Math.max(0, safeXp - levelStartXp)
    const ratio = needed > 0 ? Math.min(1, current / needed) : 0
    return { level, current, needed, total: safeXp, ratio }
}

function buildProgressBar(ratio, size = 12) {
    const safeSize = Math.max(4, Math.min(30, Math.floor(Number(size) || 12)))
    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0))
    const filled = Math.min(safeSize, Math.floor(safeRatio * safeSize))
    return `${"█".repeat(filled)}${"░".repeat(safeSize - filled)}`
}

function normalizeMessageContent(content) {
    return String(content || "")
        .toLowerCase()
        .replace(/<@!?\d+>/g, "@user")
        .replace(/<@&\d+>/g, "@role")
        .replace(/<#\d+>/g, "#channel")
        .replace(/\s+/g, " ")
        .trim()
}

function isMeaningfulMessage(content) {
    const normalized = normalizeMessageContent(content)
    if (normalized.length < 3) return false
    if (normalized.startsWith("!")) return false
    if (/^(.)\1{2,}$/u.test(normalized)) return false
    if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(normalized)) return false
    return true
}

module.exports = {
    DEFAULT_XP_MIN,
    DEFAULT_XP_MAX,
    DEFAULT_COOLDOWN_SECONDS,
    xpNeededForNextLevel,
    totalXpForLevel,
    levelFromXp,
    getLevelProgress,
    buildProgressBar,
    normalizeMessageContent,
    isMeaningfulMessage,
}
