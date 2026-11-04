import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { clearLoginAttempts, forgotPasswordRateLimit, loginRateLimit, registerRateLimit } from '../../middleware/login-rate-limit.js'
import { recordAudit } from '../../lib/audit.js'
import { registerCompany, registerSchema } from '../setup/setup.service.js'
import {
  changePassword,
  forgotPassword,
  login,
  resetPassword,
} from './auth.service.js'
import { REMEMBER_ME, clearSessionCookie, setSessionCookie } from './session.js'
import { toPublicUser, UserModel } from './user.model.js'
import { permissionsFor, type Role } from './permissions.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  remember: z.boolean().optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(1, 'New password is required.'),
})

const forgotSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
})

const resetSchema = z.object({
  token: z.string().min(16, 'The reset token is missing or malformed.'),
  newPassword: z.string().min(1, 'New password is required.'),
})

router.post(
  '/login',
  loginRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { user, token, remember } = await login(req.body)
    clearLoginAttempts({ ip: req.ip, body: req.body })
    setSessionCookie(res, token, remember ? REMEMBER_ME.maxAgeMs : undefined)
    ok(res, { user: toPublicUser(user) })
  }),
)

/**
 * Public company registration — the sign-up page's only backend door.
 *
 * It creates the deployment's single company and its first administrator through
 * the same code path as the one-time setup wizard, so there is exactly one place
 * that decides the role, the company key and whether creation is still possible.
 * Once a company exists this returns 409, which is what stops it being used to
 * mint additional administrators. No role, status or company id is read from the
 * request body: `registerSchema` strips anything it does not name.
 */
router.post(
  '/register',
  registerRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await registerCompany(req.body)
    setSessionCookie(res, result.token)
    await recordAudit(req, {
      action: 'auth.register',
      entity: 'company',
      entityId: result.company.id,
      // There is no session on the request yet, so the entry is attributed to
      // the account this request just created — otherwise a filter on the
      // author of an action would never find registrations at all.
      actorId: String(result.user._id),
      actorEmail: result.user.email,
      meta: { company: result.company.name, adminEmail: result.user.email },
    })
    ok(
      res,
      {
        company: result.company,
        user: toPublicUser(result.user),
        setupRequired: false,
      },
      201,
    )
  }),
)

/**
 * Starts a self-service password reset. The response is identical whether or
 * not the email exists; only a local run also carries the reset token, because
 * no email provider is wired up and the flow would otherwise be a dead end.
 * Any deployment — preview included — gets the generic notice (see
 * `exposesResetToken` in config/env.ts).
 */
router.post(
  '/forgot-password',
  forgotPasswordRateLimit,
  validate({ body: forgotSchema }),
  asyncHandler(async (req, res) => {
    const { devResetToken } = await forgotPassword(req.body.email)
    await recordAudit(req, {
      action: 'auth.forgot_password',
      entity: 'user',
      meta: { email: req.body.email.toLowerCase() },
    })
    ok(
      res,
      devResetToken
        ? {
            message: 'If that account exists, a reset has been started.',
            devResetToken,
          }
        : { message: 'If that account exists, a reset has been started.' },
    )
  }),
)

/**
 * Completes a reset with a one-time token. No session is involved, and any
 * cookie the browser still holds is cleared — the reset bumped tokenVersion,
 * so that session is already dead server-side.
 */
router.post(
  '/reset-password',
  validate({ body: resetSchema }),
  asyncHandler(async (req, res) => {
    await resetPassword(req.body)
    clearSessionCookie(res)
    await recordAudit(req, {
      action: 'auth.reset_password',
      entity: 'user',
      meta: { via: 'self-service token' },
    })
    ok(res, { message: 'Password updated. Sign in with your new password.' })
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
    // A password change revokes every other session; this one continues with
    // a fresh 15-minute cookie.
    setSessionCookie(res, token)
    ok(res, { user: toPublicUser(user), message: 'Password updated.' })
  }),
)

export default router
