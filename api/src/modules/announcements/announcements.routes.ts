import type { Request } from 'express'
import { Router } from 'express'
import mongoose, { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import { recordAudit } from '../../lib/audit.js'
import { notify } from '../../lib/notify.js'
import { can } from '../auth/permissions.js'
import { UserModel } from '../auth/user.model.js'
import { DepartmentModel } from '../organization/department.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  AnnouncementModel,
  toPublicAnnouncement,
  type AnnouncementDoc,
} from './announcement.model.js'

/**
 * Announcements are the one place where "who may see this" is data, not code:
 * the audience is stored on the row and every read path re-derives visibility
 * from the caller. Drafts never leak to employees, and a department-only notice
 * never reaches another department.
 */

const router = Router()

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier.')

const AUTH = [requireAuth, requirePasswordChanged]
const reader = [...AUTH, requirePermission('announcement.read')]
const publisher = [...AUTH, requirePermission('announcement.publish')]
const manager = [...AUTH, requirePermission('announcement.manage')]

const DEPARTMENT_REF = { path: 'departmentId', select: 'name' }

const bodyFields = {
  title: z.string().trim().min(3, 'Give the announcement a title.').max(140),
  body: z.string().trim().min(10, 'Write at least a short message.').max(5000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
  departmentId: objectId.optional(),
  role: z.enum(['hr', 'employee']).optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  pinned: z.boolean().optional(),
  publishAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
}

const createBody = z.object(bodyFields)
const updateBody = z.object(bodyFields).partial()

const listQuery = z.object({
  q: z.string().trim().max(140).optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

type CreateInput = z.infer<typeof createBody>

function isManager(req: Request): boolean {
  return Boolean(req.user && can(req.user.role, 'announcement.manage'))
}

async function loadOr404(id: string): Promise<AnnouncementDoc> {
  if (!mongoose.isValidObjectId(id)) throw notFound('Announcement not found.')
  const doc = await AnnouncementModel.findById(id)
  if (!doc) throw notFound('Announcement not found.')
  return doc
}

/** A department or role audience is meaningless without its target. */
async function assertAudience(input: Partial<CreateInput>): Promise<void> {
  if (input.audience === 'department') {
    if (!input.departmentId) throw unprocessable('Choose the department this announcement is for.')
    if (!(await DepartmentModel.exists({ _id: input.departmentId }))) {
      throw unprocessable('That department does not exist.')
    }
  }
  if (input.audience === 'role' && !input.role) {
    throw unprocessable('Choose the role this announcement is for.')
  }
  if (input.expiresAt && input.publishAt && input.expiresAt <= input.publishAt) {
    throw unprocessable('The expiry date must be after the publish date.')
  }
}

async function departmentOf(userId: string): Promise<string | null> {
  const employee = await EmployeeModel.findOne({ userId }).select('departmentId')
  return employee?.departmentId ? String(employee.departmentId) : null
}

/** Stands in for the delivery list when an announcement is published. */
async function recipientIds(announcement: AnnouncementDoc): Promise<Types.ObjectId[]> {
  if (announcement.audience === 'role') {
    const users = await UserModel.find({ status: 'active', role: announcement.role }).select('_id')
    return users.map((user) => user._id)
  }

  if (announcement.audience === 'department') {
    const employees = await EmployeeModel.find({
      departmentId: announcement.departmentId,
      status: { $in: ['active', 'probation'] },
      userId: { $ne: null },
    }).select('userId')
    return employees
      .map((employee) => employee.userId)
      .filter((id): id is Types.ObjectId => Boolean(id))
  }

  const users = await UserModel.find({ status: 'active' }).select('_id')
  return users.map((user) => user._id)
}

/** Publishing is the moment a notice reaches inboxes — exactly once. */
async function deliver(announcement: AnnouncementDoc): Promise<void> {
  if (announcement.status !== 'published') return
  if (announcement.publishAt.getTime() > Date.now()) return

  await notify({
    userIds: await recipientIds(announcement),
    type: 'announcement',
    title: announcement.title,
    body:
      announcement.body.length > 160
        ? `${announcement.body.slice(0, 157)}...`
        : announcement.body,
    link: `/announcements/${String(announcement._id)}`,
  })
}

/** Published, inside its window, and addressed to this caller. */
async function isVisibleTo(announcement: AnnouncementDoc, req: Request): Promise<boolean> {
  const user = req.user
  if (!user) return false
  if (isManager(req)) return true

  const now = Date.now()
  if (announcement.status !== 'published' || announcement.publishAt.getTime() > now) return false
  if (announcement.expiresAt && announcement.expiresAt.getTime() <= now) return false
  if (announcement.audience === 'all') return true
  if (announcement.audience === 'role') return announcement.role === user.role

  const departmentId = await departmentOf(user.id)
  return Boolean(departmentId) && String(announcement.departmentId) === departmentId
}

/** The published feed filter for one caller. */
async function feedClauses(req: Request): Promise<Record<string, unknown>[]> {
  const now = new Date()
  const audiences: Record<string, unknown>[] = [{ audience: 'all' }]

  if (isManager(req)) {
    audiences.push({ audience: 'department' }, { audience: 'role' })
  } else {
    if (req.user?.role === 'hr') audiences.push({ audience: 'role', role: 'hr' })
    const departmentId = await departmentOf(req.user!.id)
    if (departmentId) audiences.push({ audience: 'department', departmentId })
  }

  return [
    { status: 'published' },
    { publishAt: { $lte: now } },
    {
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    },
    { $or: audiences },
  ]
}
/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

router.get(
  '/',
  reader,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuery>
    const page = parsePage(req.query as Record<string, unknown>, 20)
    const clauses: Record<string, unknown>[] = []

    // Managers can ask for drafts and archived notices explicitly.
    if (query.status && isManager(req)) {
      clauses.push({ status: query.status })
    } else {
      clauses.push(...(await feedClauses(req)))
    }

    if (query.priority) clauses.push({ priority: query.priority })
    if (query.q) {
      const pattern = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      clauses.push({ $or: [{ title: pattern }, { body: pattern }] })
    }

    const filter = { $and: clauses }
    const unreadFilter = {
      ...filter,
      'reads.userId': { $ne: new Types.ObjectId(req.user!.id) },
    }

    const [total, unread, found] = await Promise.all([
      AnnouncementModel.countDocuments(filter),
      AnnouncementModel.countDocuments(unreadFilter),
      AnnouncementModel.find(filter)
        .populate(DEPARTMENT_REF)
        .sort({ pinned: -1, publishAt: -1 })
        .skip(page.skip)
        .limit(page.limit),
    ])

    ok(
      res,
      found.map((announcement) => toPublicAnnouncement(announcement, req.user?.id)),
      200,
      { ...pageMeta(total, page), unread },
    )
  }),
)

router.get(
  '/:id',
  reader,
  asyncHandler(async (req, res) => {
    const announcement = await loadOr404(req.params.id)
    if (!(await isVisibleTo(announcement, req))) throw notFound('Announcement not found.')

    await announcement.populate(DEPARTMENT_REF)
    ok(res, toPublicAnnouncement(announcement, req.user?.id))
  }),
)

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

router.post(
  '/',
  publisher,
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateInput
    await assertAudience(body)

    const author = await UserModel.findById(req.user!.id).select('fullName')
    const announcement = await AnnouncementModel.create({
      ...body,
      departmentId: body.audience === 'department' ? body.departmentId : undefined,
      role: body.audience === 'role' ? body.role : undefined,
      status: body.status ?? 'published',
      publishAt: body.publishAt ?? new Date(),
      authorId: req.user!.id,
      authorName: author?.fullName ?? req.user!.email,
      reads: [],
    })

    await deliver(announcement)
    await recordAudit(req, {
      action: 'create',
      entity: 'announcement',
      entityId: String(announcement._id),
      meta: { audience: announcement.audience, status: announcement.status },
    })

    await announcement.populate(DEPARTMENT_REF)
    ok(res, toPublicAnnouncement(announcement, req.user?.id), 201)
  }),
)

router.patch(
  '/:id',
  manager,
  validate({ body: updateBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const body = req.body as z.infer<typeof updateBody>

    const existing = await loadOr404(id)
    const wasPublished = existing.status === 'published'

    await assertAudience({
      audience: body.audience ?? existing.audience,
      departmentId:
        body.departmentId ?? (existing.departmentId ? String(existing.departmentId) : undefined),
      role: body.role ?? existing.role,
      publishAt: body.publishAt ?? existing.publishAt,
      expiresAt: body.expiresAt ?? existing.expiresAt,
    })

    const announcement = await AnnouncementModel.findByIdAndUpdate(
      id,
      { $set: body },
      { new: true, runValidators: true },
    )
    if (!announcement) throw notFound('Announcement not found.')

    // Only a transition into "published" delivers notifications.
    if (!wasPublished) await deliver(announcement)

    await recordAudit(req, { action: 'update', entity: 'announcement', entityId: id })
    await announcement.populate(DEPARTMENT_REF)
    ok(res, toPublicAnnouncement(announcement, req.user?.id))
  }),
)

router.delete(
  '/:id',
  manager,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Announcement not found.')

    const announcement = await AnnouncementModel.findByIdAndDelete(id)
    if (!announcement) throw notFound('Announcement not found.')

    await recordAudit(req, { action: 'delete', entity: 'announcement', entityId: id })
    ok(res, { deleted: true })
  }),
)

/* ------------------------------------------------------------------ */
/* Read receipts                                                       */
/* ------------------------------------------------------------------ */

router.post(
  '/:id/read',
  reader,
  asyncHandler(async (req, res) => {
    const announcement = await loadOr404(req.params.id)
    if (!(await isVisibleTo(announcement, req))) throw notFound('Announcement not found.')

    const userId = new Types.ObjectId(req.user!.id)
    if (!announcement.reads.some((receipt) => String(receipt.userId) === String(userId))) {
      announcement.reads.push({ userId, readAt: new Date() })
      await announcement.save()
    }

    await announcement.populate(DEPARTMENT_REF)
    ok(res, toPublicAnnouncement(announcement, req.user!.id))
  }),
)

router.get(
  '/:id/readers',
  manager,
  asyncHandler(async (req, res) => {
    const announcement = await loadOr404(req.params.id)

    const users = await UserModel.find({
      _id: { $in: announcement.reads.map((receipt) => receipt.userId) },
    }).select('fullName email role')
    const byId = new Map(users.map((user) => [String(user._id), user]))

    ok(
      res,
      announcement.reads.map((receipt) => {
        const user = byId.get(String(receipt.userId))
        return {
          userId: String(receipt.userId),
          name: user?.fullName ?? null,
          email: user?.email ?? null,
          role: user?.role ?? null,
          readAt: receipt.readAt,
        }
      }),
    )
  }),
)

export default router