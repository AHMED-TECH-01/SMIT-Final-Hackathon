import express from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express } from 'express'
import { env, isTest } from '../config/env.js'
import { logger } from '../lib/logger.js'

/** `server/src/` when running from source, `server/dist/` when compiled. */
const MODULE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Locations the Vite build can plausibly live in, ordered by how the process
 * was started. Nothing is hard-coded to one deployment layout, so the same
 * build works locally, in a workspace run, and inside a serverless bundle.
 */
function searchPaths(): string[] {
  return [
    // Working directory is the repository root (Vercel, or `npm run start` there).
    resolve(process.cwd(), 'web/dist'),
    // Working directory is the backend workspace (`server/`).
    resolve(process.cwd(), '../web/dist'),
    // Resolved from this file instead: server/dist or server/src.
    resolve(MODULE_ROOT, '../../web/dist'),
    resolve(MODULE_ROOT, '../../../web/dist'),
  ]
}

/** Finds the built frontend, or null when only the JSON API should be served. */
export function resolveWebRoot(): string | null {
  if (env.WEB_ROOT) {
    return existsSync(join(env.WEB_ROOT, 'index.html')) ? resolve(env.WEB_ROOT) : null
  }

  for (const candidate of searchPaths()) {
    if (existsSync(join(candidate, 'index.html'))) return candidate
  }
  return null
}

/**
 * Serves the compiled frontend from the API so the browser sees one origin.
 *
 * This is what makes production deployable: `web/src/lib/api.ts` calls the
 * relative path `/api/v1`, which only works when the UI and the API share a
 * host — in development Vite's proxy provides that, here the API does. It also
 * keeps the HttpOnly session cookie first-party, so no CORS or cross-site
 * cookie flags are involved.
 */
export function serveWebApp(
  app: Express,
  apiPrefix: string,
  root?: string | null,
): void {
  // `root` is injectable so the behaviour below is testable; when the caller
  // leaves it out, tests get no HTML at all and a real process searches for
  // the build.
  const webRoot = root === undefined ? (isTest ? null : resolveWebRoot()) : root

  if (!webRoot) {
    logger.info('No frontend build found — serving the JSON API only')
    return
  }

  app.use(
    express.static(webRoot, {
      // index.html is served by the fallback below so caching stays explicit.
      index: false,
      setHeaders: (res, path) => {
        // Vite fingerprints everything under /assets, so it can be cached hard.
        if (!path.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  // Client-side routes: any non-API GET that survives the static handler
  // renders the shell, and the router inside it decides what to show.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith(apiPrefix)) return next()
    // Never cache the shell, or a deploy gets stuck behind a stale bundle list.
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(webRoot, 'index.html'))
  })

  logger.info({ root: webRoot }, 'Serving the frontend build from the API')
}
