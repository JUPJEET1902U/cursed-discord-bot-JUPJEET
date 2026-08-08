/**
 * Risk evaluation for the existing Anti-Raid feature.
 *
 * This does not add a new user-facing feature. It finally gives the existing
 * requireAvatar, suspiciousNameCheck and riskScoreThreshold settings concrete,
 * deterministic behavior while preserving the existing join-threshold fast path.
 */

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g

function normalizeUsername(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(ZERO_WIDTH, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
}

function suspiciousUsername(value) {
    const name = normalizeUsername(value)
    if (!name) return false

    const compact = name.replace(/[^a-z0-9]/g, "")
    const digits = (compact.match(/\d/g) || []).length
    const repeated = /(.)\1{5,}/.test(compact)
    const scamLike = /(free.?nitro|discord.?gift|steam.?gift|airdrop|claim.?reward|support.?staff)/i.test(name)
    const numericHeavy = compact.length >= 8 && digits / compact.length >= 0.65
    return repeated || scamLike || numericHeavy
}

function hasCustomAvatar(user) {
    return Boolean(user?.avatar)
}

function evaluateJoinRisk(member, raid, {
    joinCount = 0,
    thresholdReached = false,
    raidAlreadyActive = false,
    nowMs = Date.now(),
} = {}) {
    const createdAt = Number(member?.user?.createdTimestamp || nowMs)
    const accountAgeHours = Math.max(0, Math.floor((nowMs - createdAt) / 3_600_000))
    const reasons = []
    let score = 0

    if (accountAgeHours < Math.max(0, Number(raid?.minAccountAgeHours) || 0)) {
        score += 2
        reasons.push("new account")
    }

    if (raid?.requireAvatar === true && !hasCustomAvatar(member?.user)) {
        score += 1
        reasons.push("no custom avatar")
    }

    if (raid?.suspiciousNameCheck === true && suspiciousUsername(member?.user?.username || member?.displayName)) {
        score += 1
        reasons.push("suspicious username")
    }

    if (thresholdReached) {
        score += 2
        reasons.push("join threshold reached")
    } else if (raidAlreadyActive) {
        score += 1
        reasons.push("active raid window")
    }

    const threshold = Math.max(1, Number(raid?.riskScoreThreshold) || 2)
    return {
        score,
        threshold,
        reasons,
        accountAgeHours,
        joinCount,
        thresholdReached,
        raidAlreadyActive,
        // Preserve current behavior: crossing the configured join threshold is
        // always actionable. During an already-active raid, risk score decides.
        shouldAction: thresholdReached || (raidAlreadyActive && score >= threshold),
    }
}

module.exports = {
    normalizeUsername,
    suspiciousUsername,
    hasCustomAvatar,
    evaluateJoinRisk,
}
