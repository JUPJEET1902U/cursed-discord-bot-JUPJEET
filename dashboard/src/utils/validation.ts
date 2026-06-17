/**
 * Validate a Discord channel ID (17-20 digit snowflake).
 */
export function isValidChannelId(id: string): boolean {
  return /^\d{17,20}$/.test(id.trim())
}

/**
 * Validate a Discord role ID.
 */
export function isValidRoleId(id: string): boolean {
  return /^\d{17,20}$/.test(id.trim())
}

/**
 * Validate a URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Validate a bot prefix (1-5 chars, no spaces).
 */
export function isValidPrefix(prefix: string): boolean {
  return prefix.length >= 1 && prefix.length <= 5 && !/\s/.test(prefix)
}

/**
 * Validate a welcome/goodbye message (max 2000 chars).
 */
export function isValidMessage(msg: string): boolean {
  return msg.length > 0 && msg.length <= 2000
}

/**
 * Sanitize a string for safe display (no HTML injection).
 */
export function sanitizeDisplay(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Validate form fields and return errors.
 */
export function validateBotConfig(config: {
  prefix: string
  aiMaxTokens: number
}): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!isValidPrefix(config.prefix)) {
    errors.prefix = 'Prefix must be 1-5 characters with no spaces'
  }

  if (config.aiMaxTokens < 50 || config.aiMaxTokens > 2000) {
    errors.aiMaxTokens = 'Token limit must be between 50 and 2000'
  }

  return errors
}
