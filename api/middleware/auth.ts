import type { Response, NextFunction } from 'express'
import type { AuthenticatedRequest, SessionData } from '../types/index.js'
import { sessionStore } from '../services/sessions.js'

/**
 * Middleware: require a valid session token.
 * Attaches req.user if valid.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  const session = sessionStore.get(token)
  if (!session) {
    res.status(401).json({ success: false, error: 'Invalid or expired session' })
    return
  }

  // Check session age (24 hours)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    sessionStore.delete(token)
    res.status(401).json({ success: false, error: 'Session expired' })
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
  const { guildId } = req.params
  if (!guildId || !req.user) {
    res.status(400).json({ success: false, error: 'Guild ID required' })
    return
  }

  try {
    // Fetch user's guilds from Discord to verify admin permission
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${sessionStore.get(req.user.token)?.accessToken}` },
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
