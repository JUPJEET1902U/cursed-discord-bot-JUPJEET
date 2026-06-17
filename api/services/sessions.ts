import type { SessionData } from '../types/index.js'
import crypto from 'crypto'

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
 * Clean up expired sessions (call periodically).
 */
export function cleanupSessions(): void {
  const now = Date.now()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  for (const [token, session] of sessionStore.entries()) {
    if (now - session.createdAt > maxAge) {
      sessionStore.delete(token)
    }
  }
}

// Clean up every hour
setInterval(cleanupSessions, 60 * 60 * 1000)
