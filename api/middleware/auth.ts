import type { Response, NextFunction } from 'express'
import type { AuthenticatedRequest, SessionData } from '../types/index.js'
import { sessionStore } from '../services/sessions.js'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const SESSION_REFRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000 // refresh if < 6 hours remaining

/**
 * Validate a session token and return the session data, or null if invalid/expired.
 * Deletes expired sessions immediately and refreshes valid ones.
 */
function validateSession(token: string): SessionData | null {
  const session = sessionStore.get(token)
  if (!session) return null

  const age = Date.now() - session.createdAt
  if (age > SESSION_MAX_AGE_MS) {
    sessionStore.delete(token)
    return null
  }

  // Refresh session if it's past the refresh threshold (extend expiry)
  if (age > SESSION_MAX_AGE_MS - SESSION_REFRESH_THRESHOLD_MS) {
    const refreshed: SessionData = { ...session, createdAt: Date.now() }
    sessionStore.set(token, refreshed)
    return refreshed
  }

  return session
}

/**
 * Middleware: require a valid session token.
 * Attaches req.user if valid. Checks session age on every access.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  const session = validateSession(token)
  if (!session) {
    res.status(401).json({ success: false, error: 'Invalid or expired session' })
    return
  }

  req.user = {
    id: session.userId,
    username: session.username,
    discriminator: session.discriminator,
    avatar: session.avatar,
    token,
  }

  next()
}

/**
 * Middleware: require the user to have admin permissions in the guild.
 * Must be used after requireAuth and after guildId is in req.params.
 */
export async function requireGuildAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const guildId = req.params.guildId || req.params.id
  if (!guildId || !req.user) {
    res.status(400).json({ success: false, error: 'Guild ID required' })
    return
  }

  try {
    const session = sessionStore.get(req.user.token)
    if (!session) {
      res.status(401).json({ success: false, error: 'Invalid or expired session' })
      return
    }

    // Fetch user's guilds from Discord to verify admin permission
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })

    if (!guildsRes.ok) {
      res.status(403).json({ success: false, error: 'Could not verify guild permissions' })
      return
    }

    const guilds = await guildsRes.json() as Array<{ id: string; permissions: string }>
    const guild = guilds.find((g) => g.id === guildId)

    if (!guild) {
      res.status(403).json({ success: false, error: 'You are not a member of this guild' })
      return
    }

    // Check for Administrator (0x8) or Manage Guild (0x20) permission
    const perms = BigInt(guild.permissions)
    const isAdmin = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n

    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Administrator or Manage Server permission required' })
      return
    }

    next()
  } catch (err) {
    console.error('Guild permission check error:', (err as Error).message)
    res.status(500).json({ success: false, error: 'Permission check failed' })
  }
}
