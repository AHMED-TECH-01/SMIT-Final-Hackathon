import type { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * One-command demo server.
 *
 * Starts a throwaway MongoDB in memory, seeds the demo company and then boots
 * the real API against it. No database installation, no `.env` file, no
 * credentials to invent — the data lives exactly as long as this process.
 *
 *   npm run dev:mem      (from `api/`)
 *   npm run demo         (from the repository root; also starts Vite)
 *
 * A restart re-seeds from scratch, so edits never leave the demo half-migrated.
 */

/** Development-only fallback: satisfies the >= 32 character rule in `config/env.ts`. */
const DEMO_JWT_SECRET = 'hcm-lite-demo-only-secret-change-me-0123456789'
const DEMO_PASSWORD = 'Password123'

async function main(): Promise<void> {
  // These must be set before anything imports config/env.ts, which validates
  // the environment once at import time. Real values always win, and Node's
  // .env loader never overrides variables that are already set.
  process.env.NODE_ENV ??= 'development'
  process.env.PORT ??= '4000'
  process.env.JWT_SECRET ??= DEMO_JWT_SECRET
  process.env.CORS_ORIGINS ??= 'http://localhost:5173'

  const { MongoMemoryServer: MemoryServer } = await import('mongodb-memory-server')

  // `config/env.ts` validates once at import time, so the URI must exist before
  // anything else (the logger included) is imported.
  console.log('Starting an in-memory MongoDB (data is discarded when this process exits)')
  const memory: MongoMemoryServer = await MemoryServer.create({ instance: { dbName: 'hcm_lite' } })
  process.env.MONGODB_URI = memory.getUri('hcm_lite')

  const { logger } = await import('../lib/logger.js')
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js')
  await connectDatabase()

  const { runSeed } = await import('./seed.js')
  const summary = await runSeed({ reset: true })
  logger.info(summary, 'Demo data seeded')

  // `server.ts` owns listen + graceful shutdown; its own connect is now a no-op.
  await import('../server.js')

  logger.info(
    `Sign in as admin@hcm.test, hr@hcm.test or ayesha.khan@hcm.test — password: ${DEMO_PASSWORD}`,
  )
  logger.info('Open http://localhost:5173 (or run `npm run demo` from the repository root)')

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Stopping demo server')
    // Give mongod a moment to exit, but never hang the terminal.
    const force = setTimeout(() => process.exit(0), 3_000)
    force.unref()
    void memory.stop().finally(() => {
      void disconnectDatabase().finally(() => process.exit(0))
    })
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
