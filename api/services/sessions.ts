import type { SessionData } from '../types/index.js'
import crypto from 'crypto'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_SESSIONS = 1000 // prevent unbounded growth

// In-memory session store (use Redis in production for multi-instance)
const _store = new Map<string, SessionData>()

/**
 * Proxy wrapper around the internal Map that checks session age on every get().
 * Expired sessions are deleted immediately on access.
 */
export const sessionStore = {
  get(token: string): SessionData | undefined {
    const session = _store.get(token)
    if (!session) return undefined
    if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
      _store.delete(token)
      return undefined
    }
    return session
  },
  set(token: string, data: SessionData): void {
    _store.set(token, data)
  },
  delete(token: string): void {
    _store.delete(token)
  },
  entries(): IterableIterator<[string, SessionData]> {
    return _store.entries()
  },
  get size(): number {
    return _store.size
  },
}

/**
 * Create a new session and return the token.
 * Enforces MAX_SESSIONS by evicting the oldest session when the limit is reached.
 */
export function createSession(data: Omit<SessionData, 'createdAt'>): string {
  // Evict oldest session if at capacity
  if (_store.size >= MAX_SESSIONS) {
    let oldestToken: string | null = null
    let oldestTime = Infinity
    for (const [token, session] of _store.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt
        oldestToken = token
      }
    }
    if (oldestToken) {
      _store.delete(oldestToken)
      console.warn(`[Sessions] Max sessions (${MAX_SESSIONS}) reached — evicted oldest session`)
    }
  }

  const token = crypto.randomBytes(32).toString('hex')
  _store.set(token, { ...data, createdAt: Date.now() })
  return token
}

/**
 * Delete a session by token.
 */
export function deleteSession(token: string): void {
  _store.delete(token)
}

/**
 * Clean up expired sessions (call periodically).
 * Returns stats for monitoring.
 */
export function cleanupSessions(): { removed: number; remaining: number } {
  const now = Date.now()
  let removed = 0
  for (const [token, session] of _store.entries()) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      _store.delete(token)
      removed++
    }
  }
  return { removed, remaining: _store.size }
}

// Clean up every hour
setInterval(() => {
  const stats = cleanupSessions()
  if (stats.removed > 0) {
    console.log(`[Sessions] Cleanup: removed ${stats.removed} expired sessions, ${stats.remaining} remaining`)
  }
}, 60 * 60 * 1000)
