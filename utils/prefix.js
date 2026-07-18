const { getServerConfig } = require("./serverConfig")

const DEFAULT_PREFIX = "c!"
const LEGACY_PREFIX = "!"
const MAX_PREFIX_LENGTH = 5
const PREFIX_PATTERN = /^[^\s/\\`<>@#]{1,5}$/

function isValidPrefix(value) {
    if (typeof value !== "string") return false
    const prefix = value.trim()
    return prefix.length >= 1 && prefix.length <= MAX_PREFIX_LENGTH && PREFIX_PATTERN.test(prefix)
}

function normalizePrefix(value) {
    return isValidPrefix(value) ? value.trim() : DEFAULT_PREFIX
}

function getConfiguredPrefix(config = {}) {
    return normalizePrefix(config.commandPrefix)
}

function getGuildPrefix(guildId) {
    if (!guildId) return DEFAULT_PREFIX
    return getConfiguredPrefix(getServerConfig(guildId).config)
}

function acceptedPrefixes(config = {}) {
    return [...new Set([
        getConfiguredPrefix(config),
        DEFAULT_PREFIX,
        LEGACY_PREFIX,
    ])].sort((left, right) => right.length - left.length)
}

function resolveCommandPrefix(content, config = {}) {
    const raw = String(content || "")
    const body = raw.trimStart()
    const matchedPrefix = acceptedPrefixes(config).find(prefix => body.startsWith(prefix))
    if (!matchedPrefix) return null

    const remainder = body.slice(matchedPrefix.length)
    if (!remainder || /^\s/.test(remainder)) return null

    return {
        matchedPrefix,
        configuredPrefix: getConfiguredPrefix(config),
        canonicalContent: `!${remainder}`,
    }
}

function createCommandMessage(message, canonicalContent) {
    return new Proxy(message, {
        get(target, property) {
            if (property === "content") return canonicalContent
            const value = Reflect.get(target, property, target)
            return typeof value === "function" ? value.bind(target) : value
        },
    })
}

module.exports = {
    DEFAULT_PREFIX,
    LEGACY_PREFIX,
    MAX_PREFIX_LENGTH,
    PREFIX_PATTERN,
    isValidPrefix,
    normalizePrefix,
    getConfiguredPrefix,
    getGuildPrefix,
    acceptedPrefixes,
    resolveCommandPrefix,
    createCommandMessage,
}
