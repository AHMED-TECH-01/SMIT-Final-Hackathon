import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from '../lib/logger.js'

/** Connect to MongoDB. Safe to call once per process. */
export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true)

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected')
  })

  await mongoose.connect(uri, {
    // Keep the pool modest; this app is not throughput-bound.
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
  })

  logger.info({ db: mongoose.connection.name }, 'MongoDB connected')
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close()
}

const READY_STATE_LABELS: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
}

/** Health probe that does not throw. */
export function databaseState(): { ready: boolean; state: string } {
  const readyState = mongoose.connection.readyState
  return { ready: readyState === 1, state: READY_STATE_LABELS[readyState] ?? 'unknown' }
}
