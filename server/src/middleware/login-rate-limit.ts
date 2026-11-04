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

// Password-reset requests are rarer than logins; a tighter window per
// ip:email pair stops the endpoint being used to spam reset tokens.
const FORGOT_MAX_ATTEMPTS = 5
const forgotLimiter = new FixedWindowLimiter(FORGOT_MAX_ATTEMPTS, WINDOW_MS)

// Company registration can only ever succeed once per deployment, so the
// interesting attack is someone hammering it from one address: key on the IP
// alone (there is no account to protect yet) over a longer window.
const REGISTER_MAX_ATTEMPTS = 5
const REGISTER_WINDOW_MS = 60 * 60 * 1000
const registerLimiter = new FixedWindowLimiter(REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS)

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

/** Throttles POST /auth/forgot-password with the same ip:email keying. */
export const forgotPasswordRateLimit: RequestHandler = (req, res, next) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'anonymous'
  const key = `${req.ip ?? 'unknown'}:${rawEmail}`

  const result = forgotLimiter.hit(key)
  res.setHeader('X-RateLimit-Remaining', String(result.remaining))

  if (result.limited) {
    res.setHeader('Retry-After', String(result.retryAfter))
    return next(tooManyRequests('Too many reset requests. Please try again later.'))
  }

  next()
}

/** Throttles POST /auth/register per IP, for as long as registration is possible. */
export const registerRateLimit: RequestHandler = (req, res, next) => {
  const key = req.ip ?? 'unknown'

  const result = registerLimiter.hit(key)
  res.setHeader('X-RateLimit-Remaining', String(result.remaining))

  if (result.limited) {
    res.setHeader('Retry-After', String(result.retryAfter))
    return next(tooManyRequests('Too many sign-up attempts. Please try again later.'))
  }

  next()
}

/** Test helper. */
export function resetLoginRateLimit(): void {
  limiter.resetAll()
  forgotLimiter.resetAll()
  registerLimiter.resetAll()
}
