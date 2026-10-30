import type { RequestHandler } from 'express'
import { FixedWindowLimiter } from '../lib/fixed-window-limiter.js'
import { tooManyRequests } from '../lib/http-error.js'

/**
 * Throttles login attempts per IP + email pair.
 *
 * Keying on the pair (rather than IP alone) means one attacker cannot lock out
 * an entire office behind a shared IP, while repeated guessing against a single
 * account is still blocked.
 */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

const limiter = new FixedWindowLimiter(MAX_ATTEMPTS, WINDOW_MS)

export const loginRateLimit: RequestHandler = (req, res, next) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'anonymous'
  const key = `${req.ip ?? 'unknown'}:${rawEmail}`

  const result = limiter.hit(key)
  res.setHeader('X-RateLimit-Remaining', String(result.remaining))

  if (result.limited) {
    res.setHeader('Retry-After', String(result.retryAfter))
    return next(tooManyRequests('Too many sign-in attempts. Please try again later.'))
  }

  next()
}

/** Called after a successful sign-in so a legitimate user is not penalised. */
export function clearLoginAttempts(req: { ip?: string; body?: { email?: unknown } }): void {
  const rawEmail =
    typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'anonymous'
  limiter.reset(`${req.ip ?? 'unknown'}:${rawEmail}`)
}

/** Test helper. */
export function resetLoginRateLimit(): void {
  limiter.resetAll()
}
