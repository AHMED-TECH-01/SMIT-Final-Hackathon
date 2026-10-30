import { Router } from 'express'
import { databaseState } from '../../config/db.js'
import { ok } from '../../lib/response.js'

const router = Router()

/**
 * Liveness + readiness. Reports only a boolean and a state word — never the
 * connection string or any credential.
 */
router.get('/', (_req, res) => {
  const db = databaseState()
  ok(res, {
    status: db.ready ? 'ok' : 'degraded',
    database: db,
    uptimeSeconds: Math.round(process.uptime()),
  })
})

router.get('/ready', (_req, res) => {
  const db = databaseState()
  if (!db.ready) {
    res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Database is not connected.' },
    })
    return
  }
  ok(res, { ready: true })
})

export default router
