import type { Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from '../types/index.js'
import { getSession } from '../services/sessions.js'

/**
 * Middleware: require a valid session token.
 * Attaches req.user if valid. Also performs immediate expiry check and
 * deletes the session on access if it has expired (defence-in-depth on top
 * of the periodic cleanup in sessions.ts).
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  // getSession performs an immediate expiry check and deletes on access if expired
  const session = getSession(token)
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
 * Must be used after requireAuth. Accepts the guild ID from either the
 * `guildId` or `id` route parameter so it works with both /:guildId and
 * /:id route shapes.
 */
export async function requireGuildAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  // Support both /:guildId and /:id route param names
  const guildId = req.params.guildId ?? req.params.id
  if (!guildId || !req.user) {
    res.status(400).json({ success: false, error: 'Guild ID required' })
    return
  }

  try {
    // Fetch user's guilds from Discord to verify admin permission
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${getSession(req.user.token)?.accessToken}` },
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

    // Check for Administrator permission (bit 3 = 0x8)
    const perms = BigInt(guild.permissions)
    const isAdmin = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n // Administrator or Manage Guild

    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Administrator or Manage Server permission required' })
      return
    }

    next()
  } catch (err) {
    res.status(500).json({ success: false, error: 'Permission check failed' })
  }
}
