import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/db.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { bootstrapAdminFromEnv } from './modules/setup/setup.service.js'

async function main(): Promise<void> {
  await connectDatabase()

  // Only acts on an uninitialised database; never resets an existing admin.
  try {
    const bootstrapped = await bootstrapAdminFromEnv()
    if (bootstrapped) {
      logger.info('Initial administrator created from environment variables')
    }
  } catch (err) {
    logger.warn({ err }, 'Environment bootstrap skipped')
  }

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'HCM Lite API listening')
  })

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0))
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API')
  process.exit(1)
})
