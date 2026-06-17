/**
 * api/server.ts
 * Dashboard API server for CURSED bot.
 * Runs on PORT+1 (default: 3001) alongside the bot.
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import authRouter from './routes/auth.js'
import guildsRouter from './routes/guilds.js'
import healthRouter from './routes/health.js'

const app = express()
const PORT = parseInt(process.env.API_PORT || String((parseInt(process.env.PORT || '3000') + 1)))

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Handled by frontend
}))

app.use(cors({
  origin: process.env.DASHBOARD_URL || ['http://localhost:5173', 'http://localhost:3002'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Rate limiting ──────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many auth attempts, please try again later.' },
})

app.use(globalLimiter)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter)
app.use('/api/auth', authLimiter, authRouter)
app.use('/api/guilds', guildsRouter)

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' })
})

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API error:', err.message)
  res.status(500).json({ success: false, error: 'Internal server error' })
})

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 Dashboard API running on port ${PORT}`)
  console.log(`   Health: GET  /api/health`)
  console.log(`   Auth:   POST /api/auth/discord`)
  console.log(`   Guilds: GET  /api/guilds\n`)
})

export default app
