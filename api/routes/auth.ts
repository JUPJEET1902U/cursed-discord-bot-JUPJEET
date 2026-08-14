import { Router } from 'express'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { createSession, deleteSession } from '../services/sessions.js'

const router = Router()

const DISCORD_API = 'https://discord.com/api/v10'
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || ''
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || ''
const OAUTH_TIMEOUT_MS = 8_000

// Validate DISCORD_REDIRECT_URI is set — required for OAuth to work in any environment
if (!REDIRECT_URI) {
  console.error('❌ DISCORD_REDIRECT_URI is not set. OAuth login will not work.')
  console.error('   Set it to your frontend callback URL, e.g. https://yourdomain.com/auth/callback')
}

async function discordFetch(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * POST /api/auth/discord
 * Exchange OAuth code for session token.
 */
router.post('/discord', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  const rawCode = (req.body as { code?: unknown })?.code
  const code = typeof rawCode === 'string' ? rawCode : ''

  if (!code || code.length > 2048) {
    res.status(400).json({ success: false, error: 'Authorization code required' })
    return
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    res.status(500).json({ success: false, error: 'Discord OAuth not configured' })
    return
  }

  try {
    // Exchange code for access token. Never log Discord's raw response body;
    // upstream error payloads do not belong in application logs.
    const tokenRes = await discordFetch(`${DISCORD_API}/oauth2/token`, {
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
      console.error(`Discord token exchange failed with status ${tokenRes.status}`)
      res.status(401).json({ success: false, error: 'Invalid authorization code' })
      return
    }

    const tokenData = await tokenRes.json() as { access_token: string; token_type: string }
    if (!tokenData.access_token) {
      res.status(401).json({ success: false, error: 'Discord returned no access token' })
      return
    }

    // Fetch user info
    const userRes = await discordFetch(`${DISCORD_API}/users/@me`, {
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
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`Auth error: ${message}`)
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
