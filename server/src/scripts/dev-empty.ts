import type { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Demo server on an intentionally empty database.
 *
 * `dev:mem` seeds a company, which closes registration: the sign-up page can
 * then only ever answer 409. This variant boots the same real API against an
 * in-memory MongoDB with no seed, so the public flow can be walked end to end
 * exactly as a first-time visitor meets it:
 *
 *   npm run demo -- --empty     (from the repository root; also starts Vite)
 *
 * Nothing is written until someone registers, and the database is discarded
 * when the process exits, so no credentials and no `.env` file are involved.
 */

const DEMO_JWT_SECRET = 'hcm-lite-demo-only-secret-change-me-0123456789'

async function main(): Promise<void> {
  process.env.NODE_ENV ??= 'development'
  process.env.PORT ??= '4000'
  process.env.JWT_SECRET ??= DEMO_JWT_SECRET
  process.env.CORS_ORIGINS ??= 'http://localhost:5173'

  const { MongoMemoryServer: MemoryServer } = await import('mongodb-memory-server')

  console.log('Starting an empty in-memory MongoDB (no seed, data discarded on exit)')
  const memory: MongoMemoryServer = await MemoryServer.create({ instance: { dbName: 'hcm_lite' } })
  process.env.MONGODB_URI = memory.getUri('hcm_lite')

  const { logger } = await import('../lib/logger.js')
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js')
  await connectDatabase()

  await import('../server.js')

  logger.info('No company exists yet: /signup is open, and the first registration wins')
  logger.info('Open http://localhost:5173 (or run `npm run demo -- --empty` from the root)')

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Stopping empty-database server')
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
