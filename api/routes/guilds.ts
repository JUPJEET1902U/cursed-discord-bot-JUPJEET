import { Router } from 'express'
import type { Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { AuthenticatedRequest } from '../types/index.js'
import { requireAuth, requireGuildAdmin } from '../middleware/auth.js'
import { sessionStore } from '../services/sessions.js'
import { getGuildConfig, updateGuildConfig, getGuildStats } from '../services/guild.js'

const router = Router()
const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN = process.env.BOT_TOKEN || ''

// Rate limiter for guild config updates
const guildUpdateLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000)),
  max: parseInt(process.env.API_RATE_LIMIT_MAX || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many config updates, please try again later.' },
})

/**
 * GET /api/guilds
 * List guilds the user is in, with bot presence info.
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const session = sessionStore.get(req.user!.token)
    if (!session) {
      res.status(401).json({ success: false, error: 'Session not found' })
      return
    }

    // Fetch user's guilds
    const userGuildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })

    if (!userGuildsRes.ok) {
      res.status(502).json({ success: false, error: 'Could not fetch guilds from Discord' })
      return
    }

    const userGuilds = await userGuildsRes.json() as Array<{
      id: string
      name: string
      icon: string | null
      owner: boolean
      permissions: string
    }>

    // Filter to guilds where user has admin/manage permissions
    const adminGuilds = userGuilds.filter((g) => {
      const perms = BigInt(g.permissions)
      return g.owner || (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n
    })

    // Check which guilds have the bot
    const guildsWithBotStatus = await Promise.all(
      adminGuilds.map(async (guild) => {
        let botPresent = false
        if (BOT_TOKEN) {
          try {
            const memberRes = await fetch(
              `${DISCORD_API}/guilds/${guild.id}/members/${process.env.BOT_CLIENT_ID}`,
              { headers: { Authorization: `Bot ${BOT_TOKEN}` } },
            )
            botPresent = memberRes.ok
          } catch { /* ignore */ }
        }
        return { ...guild, botPresent }
      }),
    )

    res.json({ success: true, data: guildsWithBotStatus })
  } catch (err) {
    console.error('Guilds fetch error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch guilds' })
  }
})

/**
 * GET /api/guilds/:guildId
 * Get guild configuration. Requires admin permission in the guild.
 */
router.get('/:guildId', requireAuth, requireGuildAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await getGuildConfig(req.params.guildId)
    res.json({ success: true, data: config })
  } catch (err) {
    console.error('Guild config fetch error:', (err as Error).message)
    res.status(500).json({ success: false, error: 'Failed to fetch guild config' })
  }
})

/**
 * PUT /api/guilds/:guildId
 * Update guild configuration. Requires admin permission in the guild.
 */
router.put('/:guildId', requireAuth, requireGuildAdmin, guildUpdateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await updateGuildConfig(req.params.guildId, req.body)
    res.json({ success: true, data: config })
  } catch (err) {
    console.error('Guild config update error:', (err as Error).message)
    res.status(500).json({ success: false, error: 'Failed to update guild config' })
  }
})

/**
 * GET /api/guilds/:guildId/stats
 * Get guild statistics. Requires admin permission in the guild.
 */
router.get('/:guildId/stats', requireAuth, requireGuildAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await getGuildStats(req.params.guildId)
    res.json({ success: true, data: stats })
  } catch (err) {
    console.error('Guild stats fetch error:', (err as Error).message)
    res.status(500).json({ success: false, error: 'Failed to fetch guild stats' })
  }
})

export default router
