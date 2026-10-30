import { Router } from 'express'
import mongoose, { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { notFound } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged } from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import {
  NOTIFICATION_TYPES,
  NotificationModel,
  toPublicNotification,
} from './notification.model.js'

/**
 * A personal inbox. Every query is scoped by `userId` taken from the session,
 * so one user can never read, mark or delete another user's notifications.
 */

const router = Router()

const auth = [requireAuth, requirePasswordChanged]

const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

router.get(
  '/',
  auth,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuery>
    const page = parsePage(req.query as Record<string, unknown>, 25)

    const scope: Record<string, unknown> = { userId: new Types.ObjectId(req.user!.id) }
    const filter: Record<string, unknown> = { ...scope }
    if (query.unread === 'true') filter.readAt = { $exists: false }
    if (query.unread === 'false') filter.readAt = { $exists: true, $ne: null }
    if (query.type) filter.type = query.type

    const [total, unread, found] = await Promise.all([
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({ ...scope, readAt: { $exists: false } }),
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit),
    ])

    ok(res, found.map(toPublicNotification), 200, { ...pageMeta(total, page), unread })
  }),
)

router.get(
  '/unread-count',
  auth,
  asyncHandler(async (req, res) => {
    const unread = await NotificationModel.countDocuments({
      userId: new Types.ObjectId(req.user!.id),
      readAt: { $exists: false },
    })
    ok(res, { unread })
  }),
)

router.post(
  '/read-all',
  auth,
  asyncHandler(async (req, res) => {
    const result = await NotificationModel.updateMany(
      { userId: new Types.ObjectId(req.user!.id), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    )
    ok(res, { updated: result.modifiedCount, unread: 0 })
  }),
)

router.post(
  '/:id/read',
  auth,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Notification not found.')

    const notification = await NotificationModel.findOne({
      _id: id,
      userId: new Types.ObjectId(req.user!.id),
    })
    if (!notification) throw notFound('Notification not found.')

    // Re-reading keeps the original timestamp rather than moving it forward.
    if (!notification.readAt) {
      notification.readAt = new Date()
      await notification.save()
    }

    ok(res, toPublicNotification(notification))
  }),
)

router.delete(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Notification not found.')

    const deleted = await NotificationModel.findOneAndDelete({
      _id: id,
      userId: new Types.ObjectId(req.user!.id),
    })
    if (!deleted) throw notFound('Notification not found.')

    ok(res, { deleted: true })
  }),
)

export default router