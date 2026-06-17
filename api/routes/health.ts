import { Router } from 'express'
import type { Request, Response } from 'express'

const router = Router()
const START_TIME = Date.now()

/**
 * GET /api/health
 * Health check endpoint for Railway and monitoring.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    },
  })
})

export default router
