import { Router } from 'express'
import type { Response } from 'express'
import type { AuthenticatedRequest } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { sessionStore } from '../services/sessions.js'
import { getGuildConfig, updateGuildConfig, getGuildStats } from '../services/guild.js'

const router = Router()
const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN = process.env.BOT_TOKEN || ''

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
 * GET /api/guilds/:id
 * Get guild configuration.
 */
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await getGuildConfig(req.params.id)
    res.json({ success: true, data: config })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch guild config' })
  }
})

/**
 * PUT /api/guilds/:id
 * Update guild configuration.
 */
router.put('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await updateGuildConfig(req.params.id, req.body)
    res.json({ success: true, data: config })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update guild config' })
  }
})

/**
 * GET /api/guilds/:id/stats
 * Get guild statistics.
 */
router.get('/:id/stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await getGuildStats(req.params.id)
    res.json({ success: true, data: stats })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch guild stats' })
  }
})

export default router
