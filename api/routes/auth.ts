import { Router } from 'express'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { createSession, deleteSession } from '../services/sessions.js'

const router = Router()

const DISCORD_API = 'https://discord.com/api/v10'
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || ''
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/callback'

/**
 * POST /api/auth/discord
 * Exchange OAuth code for session token.
 */
router.post('/discord', async (req: Request, res: Response) => {
  const { code } = req.body as { code?: string }

  if (!code) {
    res.status(400).json({ success: false, error: 'Authorization code required' })
    return
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ success: false, error: 'Discord OAuth not configured' })
    return
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Discord token exchange failed:', err)
      res.status(401).json({ success: false, error: 'Invalid authorization code' })
      return
    }

    const tokenData = await tokenRes.json() as { access_token: string; token_type: string }

    // Fetch user info
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    if (!userRes.ok) {
      res.status(401).json({ success: false, error: 'Could not fetch user info' })
      return
    }

    const user = await userRes.json() as {
      id: string
      username: string
      discriminator: string
      avatar: string | null
    }

    // Create session
    const sessionToken = createSession({
      userId: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      accessToken: tokenData.access_token,
    })

    res.json({
      success: true,
      data: {
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          discriminator: user.discriminator,
          avatar: user.avatar,
        },
      },
    })
  } catch (err) {
    console.error('Auth error:', err)
    res.status(500).json({ success: false, error: 'Authentication failed' })
  }
})

/**
 * GET /api/auth/me
 * Get current authenticated user.
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: req.user })
})

/**
 * POST /api/auth/logout
 * Invalidate the current session.
 */
router.post('/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.token) {
    deleteSession(req.user.token)
  }
  res.json({ success: true, message: 'Logged out successfully' })
})

export default router
