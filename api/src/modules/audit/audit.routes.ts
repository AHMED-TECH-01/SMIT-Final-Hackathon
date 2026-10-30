import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { badRequest } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import { dateKeyToUtcMidnight, isValidDateKey } from '../../lib/dates.js'
import { AuditLogModel, toPublicAudit } from './audit.model.js'

/**
 * The audit trail is append-only by design — the only route here is a read.
 * It is admin-only: HR can act, but cannot edit or review their own paper trail.
 */

const router = Router()

const gate = [requireAuth, requirePasswordChanged, requirePermission('audit.read')]

const dateKeySchema = z.string().refine(isValidDateKey, 'Use the YYYY-MM-DD format.')

const listQuery = z.object({
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(60).optional(),
  actorEmail: z.string().trim().max(160).optional(),
  entityId: z.string().trim().max(80).optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

router.get(
  '/',
  gate,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuery>
    const page = parsePage(req.query as Record<string, unknown>, 50)

    const filter: Record<string, unknown> = {}
    if (query.action) filter.action = query.action
    if (query.entity) filter.entity = query.entity
    if (query.entityId) filter.entityId = query.entityId
    if (query.actorEmail) filter.actorEmail = query.actorEmail.toLowerCase()

    if (query.from || query.to) {
      if (query.from && query.to && query.from > query.to) {
        throw badRequest('The start of the range must come before the end.')
      }
      const range: Record<string, Date> = {}
      if (query.from) range.$gte = dateKeyToUtcMidnight(query.from)
      // `to` is inclusive of the whole day.
      if (query.to) {
        range.$lte = new Date(dateKeyToUtcMidnight(query.to).getTime() + 86_400_000 - 1)
      }
      filter.createdAt = range
    }

    const [total, entries] = await Promise.all([
      AuditLogModel.countDocuments(filter),
      AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit),
    ])

    ok(res, entries.map(toPublicAudit), 200, pageMeta(total, page))
  }),
)

/** Distinct actions and entities, so the UI can build its filters. */
router.get(
  '/facets',
  gate,
  asyncHandler(async (_req, res) => {
    const [actions, entities] = await Promise.all([
      AuditLogModel.distinct('action'),
      AuditLogModel.distinct('entity'),
    ])
    ok(res, {
      actions: (actions as string[]).sort(),
      entities: (entities as string[]).sort(),
    })
  }),
)

export default router