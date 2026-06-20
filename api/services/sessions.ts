import type { SessionData } from '../types/index.js'
import crypto from 'crypto'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

// In-memory session store (use Redis in production for multi-instance)
export const sessionStore = new Map<string, SessionData>()

/**
 * Create a new session and return the token.
 */
export function createSession(data: Omit<SessionData, 'createdAt'>): string {
  const token = crypto.randomBytes(32).toString('hex')
  sessionStore.set(token, { ...data, createdAt: Date.now() })
  return token
}

/**
 * Delete a session by token.
 */
export function deleteSession(token: string): void {
  sessionStore.delete(token)
}

/**
 * Look up a session by token. Returns undefined and immediately deletes the
 * entry if the session has expired, preventing stale tokens from lingering
 * in the Map between cleanup intervals.
 */
export function getSession(token: string): SessionData | undefined {
  const session = sessionStore.get(token)
  if (!session) return undefined
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessionStore.delete(token)
    return undefined
  }
  return session
}

/**
 * Clean up all expired sessions. Called periodically and can also be invoked
 * manually (e.g. from index.js on startup).
 */
export function cleanupSessions(): void {
  const now = Date.now()
  let pruned = 0
  for (const [token, session] of sessionStore.entries()) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      sessionStore.delete(token)
      pruned++
    }
  }
  if (pruned > 0) {
    console.log(`[Sessions] Cleaned up ${pruned} expired sessions (${sessionStore.size} remaining)`)
  }
}

// Reduce cleanup interval to 30 minutes (was 60) so expired sessions are
// evicted more promptly, limiting the unbounded growth window.
setInterval(cleanupSessions, 30 * 60 * 1000)
