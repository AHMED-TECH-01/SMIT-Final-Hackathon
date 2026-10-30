import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { clearLoginAttempts, loginRateLimit } from '../../middleware/login-rate-limit.js'
import { changePassword, login } from './auth.service.js'
import { clearSessionCookie, setSessionCookie } from './session.js'
import { toPublicUser, UserModel } from './user.model.js'
import { permissionsFor, type Role } from './permissions.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(1, 'New password is required.'),
})

router.post(
  '/login',
  loginRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { user, token } = await login(req.body)
    clearLoginAttempts({ ip: req.ip, body: req.body })
    setSessionCookie(res, token)
    ok(res, { user: toPublicUser(user) })
  }),
)

router.post('/logout', (_req, res) => {
  clearSessionCookie(res)
  ok(res, { message: 'Signed out.' })
})

/** Identity + effective permissions for the current session. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user!.id)
    if (!user) {
      clearSessionCookie(res)
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Your session is no longer valid.' },
      })
      return
    }

    ok(res, {
      user: toPublicUser(user),
      permissions: permissionsFor(user.role as Role),
    })
  }),
)

/**
 * Reachable while `mustChangePassword` is true — this is the route that clears
 * that flag. A fresh cookie is issued so the caller stays signed in while every
 * other session for that account is revoked.
 */
router.post(
  '/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { token, user } = await changePassword(req.user!.id, req.body)
    setSessionCookie(res, token)
    ok(res, { user: toPublicUser(user), message: 'Password updated.' })
  }),
)

export default router
