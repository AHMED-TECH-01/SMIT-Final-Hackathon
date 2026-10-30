import { Router } from 'express'
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { hashPassword } from '../auth/session.js'
import { normalizeEmail, toPublicUser, UserModel } from '../auth/user.model.js'
import { permissionsFor, ROLES, type Role } from '../auth/permissions.js'

const router = Router()

/**
 * Admin-only account listing.
 *
 * Employee accounts are created through the employee module (a separate
 * permission) — this endpoint covers registered system users.
 */
router.get(
  '/',
  requireAuth,
  requirePasswordChanged,
  requirePermission('user.read'),
  asyncHandler(async (_req, res) => {
    const users = await UserModel.find().sort({ createdAt: 1 }).limit(200)
    ok(res, users.map(toPublicUser), 200, { total: users.length })
  }),
)

const createUserSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(160),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(ROLES),
  temporaryPassword: z.string().min(1).max(200),
})

/**
 * Admin creates HR (or additional admin) accounts. The recipient is always
 * forced to replace the temporary password on first sign-in.
 */
router.post(
  '/',
  requireAuth,
  requirePasswordChanged,
  requirePermission('user.create'),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const { email, fullName, role, temporaryPassword } = req.body as z.infer<
      typeof createUserSchema
    >

    const user = await UserModel.create({
      email: normalizeEmail(email),
      fullName,
      passwordHash: await hashPassword(temporaryPassword),
      role,
      status: 'active',
      mustChangePassword: true,
    })

    ok(res, { user: toPublicUser(user), permissions: permissionsFor(role as Role) }, 201)
  }),
)

const statusBody = z.object({ status: z.enum(['active', 'inactive']) })

/**
 * Deactivation takes effect immediately: the token version is bumped so any
 * cookie already in a browser stops working on its very next request.
 */
router.patch(
  '/:id/status',
  requireAuth,
  requirePasswordChanged,
  requirePermission('user.manage'),
  validate({ body: statusBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('User not found.')
    if (id === req.user?.id) {
      throw unprocessable('You cannot change the status of your own account.')
    }

    const { status } = req.body as z.infer<typeof statusBody>
    const user = await UserModel.findById(id)
    if (!user) throw notFound('User not found.')

    user.status = status
    if (status === 'inactive') user.tokenVersion += 1
    await user.save()

    ok(res, toPublicUser(user))
  }),
)

/** Issues a one-time password. The recipient must replace it on first sign-in. */
router.post(
  '/:id/reset-password',
  requireAuth,
  requirePasswordChanged,
  requirePermission('user.manage'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('User not found.')

    const user = await UserModel.findById(id)
    if (!user) throw notFound('User not found.')

    // Satisfies the strength policy: upper, lower, digit, length >= 10.
    const temporaryPassword = `Tmp${randomBytes(6).toString('base64url')}7a`
    user.passwordHash = await hashPassword(temporaryPassword)
    user.mustChangePassword = true
    user.tokenVersion += 1
    await user.save()

    ok(res, { user: toPublicUser(user), temporaryPassword })
  }),
)

export default router
