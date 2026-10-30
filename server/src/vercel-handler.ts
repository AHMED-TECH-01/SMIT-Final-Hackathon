import type { Express, Request, Response } from 'express'
import { createApp } from './app.js'
import { connectDatabase } from './config/db.js'

/**
 * Serverless entry point for deployments that cannot hold a process open
 * (Vercel functions and similar). Long-running hosts keep using `server.ts`,
 * which owns `listen` and graceful shutdown.
 *
 * A function container is reused across invocations and torn down without any
 * signal, so the expensive work — the MongoDB connection pool and the Express
 * handler tree — is built once per container instead of once per request.
 */
let app: Express | null = null
let connecting: Promise<void> | null = null

export default async function handler(req: Request, res: Response): Promise<void> {
  if (!connecting) {
    // Clear the memo on failure so the next invocation retries rather than
    // replaying a rejected promise for the life of the container.
    connecting = connectDatabase().catch((err: unknown) => {
      connecting = null
      throw err
    })
  }
  await connecting

  app ??= createApp()
  app(req, res)
}
