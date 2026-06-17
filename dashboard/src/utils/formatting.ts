import { DISCORD_CDN } from './constants'

/**
 * Format a number with commas.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString()
}

/**
 * Format a large number with K/M suffix.
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Format a date to a readable string.
 */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format a date to relative time (e.g. "2 hours ago").
 */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * Get Discord avatar URL.
 */
export function getAvatarUrl(userId: string, avatarHash: string | null, size = 128): string {
  if (!avatarHash) {
    const defaultIndex = (BigInt(userId) >> 22n) % 6n
    return `${DISCORD_CDN}/embed/avatars/${defaultIndex}.png`
  }
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png'
  return `${DISCORD_CDN}/avatars/${userId}/${avatarHash}.${ext}?size=${size}`
}

/**
 * Get Discord guild icon URL.
 */
export function getGuildIconUrl(guildId: string, iconHash: string | null, size = 128): string {
  if (!iconHash) return `https://cdn.discordapp.com/embed/avatars/0.png`
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png'
  return `${DISCORD_CDN}/icons/${guildId}/${iconHash}.${ext}?size=${size}`
}

/**
 * Truncate a string to a max length.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 3) + '...'
}

/**
 * Format bytes to human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Capitalize first letter.
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
