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
// API_PORT takes precedence. In production (Railway) set API_PORT=$PORT so the
// API is reachable on the single externally-exposed port. Falls back to PORT+1
// for local development where the webhook server occupies PORT.
const PORT = parseInt(
  process.env.API_PORT ||
  String(parseInt(process.env.PORT || '3000') + 1),
)

// ── CORS origin list ───────────────────────────────────────────────────────────
// In production set DASHBOARD_URL (comma-separated list or single URL).
// Localhost origins are only included when NODE_ENV is not 'production'.
function buildCorsOrigins(): string | string[] {
  if (process.env.DASHBOARD_URL) {
    // Support comma-separated list of allowed origins
    const origins = process.env.DASHBOARD_URL.split(',').map((o) => o.trim()).filter(Boolean)
    return origins.length === 1 ? origins[0] : origins
  }
  if (process.env.NODE_ENV === 'production') {
    // No DASHBOARD_URL set in production — deny all cross-origin requests
    return []
  }
  // Development fallback
  return ['http://localhost:5173', 'http://localhost:3000']
}

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Handled by frontend
}))

app.use(cors({
  origin: buildCorsOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Request logging middleware ─────────────────────────────────────────────────
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  // Redact Authorization header value to prevent token leakage in logs
  const authHeader = req.headers.authorization
  const authLog = authHeader ? (authHeader.startsWith('Bearer ') ? 'Bearer [REDACTED]' : '[REDACTED]') : 'none'
  console.log(`[API] ${new Date().toISOString()} ${req.method} ${req.path} auth=${authLog} ip=${req.ip}`)
  next()
})

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
