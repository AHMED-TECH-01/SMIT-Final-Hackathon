import bcrypt from 'bcryptjs'
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

export function setSessionCookie(res: Response, token: string, maxAgeMs = 15 * 60 * 1000): void {
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
