import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { Response } from 'express'
import { env, isProd, isTest } from '../../config/env.js'
import { unauthorized } from '../../lib/http-error.js'
import { isRole, type Role } from './permissions.js'

export const SESSION_COOKIE = 'hcm_session'

/**
 * Cost factor. Kept high in production; lowered in tests purely for speed
 * (overridable via BCRYPT_ROUNDS when profiling is needed).
 */
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? (isTest ? 4 : 12))

/** Minimum password policy, enforced server-side. */
export const PASSWORD_MIN_LENGTH = 10

export function assertPasswordStrength(password: string): string | null {
  const problems: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`at least ${PASSWORD_MIN_LENGTH} characters`)
  }
  if (!/[a-z]/.test(password)) problems.push('one lowercase letter')
  if (!/[A-Z]/.test(password)) problems.push('one uppercase letter')
  if (!/[0-9]/.test(password)) problems.push('one number')

  return problems.length > 0 ? `Password must contain ${problems.join(', ')}.` : null
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Claims embedded in the session token. */
export interface SessionClaims {
  sub: string
  role: Role
  /** token version, compared against the user row on every request */
  cv: number
}

export function signSessionToken(
  claims: SessionClaims,
  expiresIn: string = env.JWT_EXPIRES_IN,
): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn } as jwt.SignOptions)
}

/** How long a "remember me" session stays signed in. Matches the cookie maxAge. */
export const REMEMBER_ME = { expiresIn: '7d', maxAgeMs: 7 * 24 * 60 * 60 * 1000 }

/** Throws 401 on any problem — callers never see library-specific errors. */
export function verifySessionToken(token: string): SessionClaims {
  let payload: unknown
  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.')
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('sub' in payload) ||
    !('role' in payload) ||
    !('cv' in payload)
  ) {
    throw unauthorized('Invalid session.')
  }

  const { sub, role, cv } = payload as { sub: unknown; role: unknown; cv: unknown }
  if (typeof sub !== 'string' || typeof cv !== 'number' || !isRole(role)) {
    throw unauthorized('Invalid session.')
  }

  return { sub, role, cv }
}

export function setSessionCookie(
  res: Response,
  token: string,
  maxAgeMs = 15 * 60 * 1000,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  })
}

export function readSessionCookie(
  cookies: Record<string, unknown> | undefined,
): string | undefined {
  const value = cookies?.[SESSION_COOKIE]
  return typeof value === 'string' ? value : undefined
}

/* ------------------------------------------------------------------ */
/* Password-reset tokens                                               */
/* ------------------------------------------------------------------ */

/** Lifetime of a self-service password-reset link. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

/**
 * Generates a one-time reset token. The plaintext is returned to the caller
 * exactly once (delivered out-of-band); only its SHA-256 is ever persisted,
 * so a database leak does not hand out usable resets.
 */
export function createResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  }
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
