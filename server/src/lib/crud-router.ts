import { Router, type RequestHandler } from 'express'
import mongoose, { type Model } from 'mongoose'
import type { ZodTypeAny } from 'zod'
import { asyncHandler } from './async-handler.js'
import { ok } from './response.js'
import { notFound } from './http-error.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth.js'
import { parsePage, pageMeta } from './pagination.js'
import type { Permission } from '../modules/auth/permissions.js'
import { recordAudit } from './audit.js'

export interface CrudOptions {
  /** Audit entity name, e.g. 'department'. */
  entity: string
  model: Model<any>
  readPermission: Permission
  writePermission: Permission
  createSchema: ZodTypeAny
  updateSchema: ZodTypeAny
  /** Fields matched case-insensitively against ?q=. */
  searchFields?: string[]
  sort?: Record<string, 1 | -1>
  defaultLimit?: number
  toPublic: (doc: any) => unknown
  /** Reference paths to populate on read, e.g. [{ path: 'departmentId', select: 'name' }]. */
  populate?: { path: string; select?: string }[]
  /** Throw to block a delete (e.g. a department that still has employees). */
  beforeDelete?: (id: string) => Promise<void>
}

/**
 * Builds a standard authenticated, permission-checked, audited CRUD router.
 *
 * Every master-data list (departments, designations, leave types, holidays,
 * announcements) has identical surrounding behaviour, so the behaviour lives
 * here once rather than being re-implemented per module.
 */
export function createCrudRouter(options: CrudOptions): Router {
  const router = Router()
  const auth: RequestHandler[] = [requireAuth, requirePasswordChanged]

  const assertId = (id: string) => {
    if (!mongoose.isValidObjectId(id)) throw notFound(`${options.entity} not found.`)
  }

  router.get(
    '/',
    ...auth,
    requirePermission(options.readPermission),
    asyncHandler(async (req, res) => {
      const page = parsePage(req.query as Record<string, unknown>, options.defaultLimit ?? 20)
      const filter: Record<string, unknown> = {}
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

      if (q && options.searchFields?.length) {
        filter.$or = options.searchFields.map((field) => ({
          [field]: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
        }))
      }

      const [total, found] = await Promise.all([
        options.model.countDocuments(filter),
        options.model
          .find(filter)
          .sort(options.sort ?? { createdAt: -1 })
          .skip(page.skip)
          .limit(page.limit),
      ])

      const docs = options.populate
        ? await options.model.populate(found, options.populate)
        : found

      ok(res, docs.map(options.toPublic), 200, pageMeta(total, page))
    }),
  )

  router.get(
    '/:id',
    ...auth,
    requirePermission(options.readPermission),
    asyncHandler(async (req, res) => {
      const { id } = req.params
      assertId(id)
      const doc = await options.model.findById(id)
      if (!doc) throw notFound(`${options.entity} not found.`)
      ok(res, options.toPublic(doc))
    }),
  )

  router.post(
    '/',
    ...auth,
    requirePermission(options.writePermission),
    validate({ body: options.createSchema }),
    asyncHandler(async (req, res) => {
      const doc = await options.model.create(req.body)
      await recordAudit(req, { action: 'create', entity: options.entity, entityId: String(doc._id) })
      ok(res, options.toPublic(doc), 201)
    }),
  )

  router.patch(
    '/:id',
    ...auth,
    requirePermission(options.writePermission),
    validate({ body: options.updateSchema }),
    asyncHandler(async (req, res) => {
      const { id } = req.params
      assertId(id)

      const doc = await options.model.findByIdAndUpdate(id, { $set: req.body }, { new: true, runValidators: true })
      if (!doc) throw notFound(`${options.entity} not found.`)

      await recordAudit(req, { action: 'update', entity: options.entity, entityId: id })
      ok(res, options.toPublic(doc))
    }),
  )

  router.delete(
    '/:id',
    ...auth,
    requirePermission(options.writePermission),
    asyncHandler(async (req, res) => {
      const { id } = req.params
      assertId(id)

      if (options.beforeDelete) await options.beforeDelete(id)

      const doc = await options.model.findByIdAndDelete(id)
      if (!doc) throw notFound(`${options.entity} not found.`)

      await recordAudit(req, { action: 'delete', entity: options.entity, entityId: id })
      ok(res, { deleted: true })
    }),
  )

  return router
}