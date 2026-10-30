import type { RequestHandler } from 'express'
import { UserModel } from '../modules/auth/user.model.js'
import { can, type Permission, type Role } from '../modules/auth/permissions.js'
import { readSessionCookie, verifySessionToken } from '../modules/auth/session.js'
import { HttpError, forbidden, unauthorized } from '../lib/http-error.js'
import { asyncHandler } from '../lib/async-handler.js'

/**
 * Authenticates the caller from the signed session cookie.
 *
 * The database is the authority, not the token:
 *  • the account must still exist and be `active`
 *  • the token version must match, so a password change or deactivation
 *    revokes every previously issued session
 *  • `mustChangePassword` is read fresh from the row, never from the token
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = readSessionCookie(req.cookies)
  if (!token) throw unauthorized()

  const claims = verifySessionToken(token)
  const user = await UserModel.findById(claims.sub)

  if (!user) throw unauthorized('Your session is no longer valid.')

  if (user.status !== 'active') {
    throw new HttpError(
      403,
      'ACCOUNT_INACTIVE',
      'This account has been deactivated. Contact your administrator.',
    )
  }

  if (user.tokenVersion !== claims.cv) {
    throw unauthorized('Your session has been revoked. Please sign in again.')
  }

  req.user = {
    id: String(user._id),
    email: user.email,
    role: user.role as Role,
    mustChangePassword: user.mustChangePassword,
  }

  next()
})

/**
 * Blocks every protected route while a temporary password is outstanding.
 * Mounted after the auth endpoints so `me`, `change-password` and `logout`
 * stay reachable.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    return next(
      new HttpError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'You must set a new password before continuing.',
      ),
    )
  }
  next()
}

/** Permission gate. Unknown roles deny by default (see permissions.ts). */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const user = req.user
    if (!user) return next(unauthorized())
    if (!can(user.role, permission)) {
      return next(forbidden(`Your role does not include the "${permission}" permission.`))
    }
    next()
  }
}

/**
 * Passes when the caller holds *any* of the listed permissions.
 * Used where a route serves both self-service and approver audiences, e.g.
 * `/leave/requests` — employees read their own, approvers read the queue.
 */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user
    if (!user) return next(unauthorized())
    if (!permissions.some((permission) => can(user.role, permission))) {
      return next(forbidden(`Your role does not include any of: ${permissions.join(', ')}.`))
    }
    next()
  }
}
