import crypto from 'crypto'
import type { SessionData } from '../types/index.js'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_SESSIONS_PER_USER = 5
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i

// Session tokens are never stored in plaintext. The client receives the random
// bearer token, while the in-memory store is keyed by a one-way SHA-256 digest.
export const sessionStore = new Map<string, SessionData>()

export function tokenDigest(token: string): string | null {
  if (!SESSION_TOKEN_PATTERN.test(String(token || ''))) return null
  return crypto.createHash('sha256').update(token).digest('hex')
}

function limitUserSessions(userId: string): void {
  const sessions = [...sessionStore.entries()]
    .filter(([, session]) => session.userId === userId)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)

  for (const [digest] of sessions.slice(MAX_SESSIONS_PER_USER)) {
    sessionStore.delete(digest)
  }
}

/**
 * Create a new session and return the raw bearer token. Only its digest is
 * retained server-side, reducing exposure if process memory/state is logged.
 */
export function createSession(data: Omit<SessionData, 'createdAt'>): string {
  const token = crypto.randomBytes(32).toString('hex')
  const digest = tokenDigest(token)
  if (!digest) throw new Error('Failed to generate a valid session token')
  sessionStore.set(digest, { ...data, createdAt: Date.now() })
  limitUserSessions(data.userId)
  return token
}

/**
 * Delete a session by raw bearer token.
 */
export function deleteSession(token: string): void {
  const digest = tokenDigest(token)
  if (digest) sessionStore.delete(digest)
}

/**
 * Look up a session by raw bearer token. Returns undefined and immediately
 * deletes the entry if the session has expired.
 */
export function getSession(token: string): SessionData | undefined {
  const digest = tokenDigest(token)
  if (!digest) return undefined
  const session = sessionStore.get(digest)
  if (!session) return undefined
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessionStore.delete(digest)
    return undefined
  }
  return session
}

/**
 * Clean up all expired sessions. Called periodically and can also be invoked
 * manually (e.g. from index.js on startup).
 */
export function cleanupSessions(): void {
  const currentTime = Date.now()
  let pruned = 0
  for (const [digest, session] of sessionStore.entries()) {
    if (currentTime - session.createdAt > SESSION_MAX_AGE_MS) {
      sessionStore.delete(digest)
      pruned++
    }
  }
  if (pruned > 0) {
    console.log(`[Sessions] Cleaned up ${pruned} expired sessions (${sessionStore.size} remaining)`)
  }
}

const cleanupTimer = setInterval(cleanupSessions, 30 * 60 * 1000)
cleanupTimer.unref?.()
