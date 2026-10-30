import type { Request } from 'express'
import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { conflict, forbidden, notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import {
  requireAnyPermission,
  requireAuth,
  requirePasswordChanged,
  requirePermission,
} from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import { recordAudit } from '../../lib/audit.js'
import { notify } from '../../lib/notify.js'
import { dateKeyToUtcMidnight, isValidDateKey, zonedDateKey } from '../../lib/dates.js'
import { workingDayKeys } from '../../lib/working-days.js'
import { can } from '../auth/permissions.js'
import { getCompanySettings } from '../organization/company.settings.js'
import { LeaveTypeModel } from '../organization/leave-type.model.js'
import { AttendanceModel } from '../attendance/attendance.model.js'
import { UserModel } from '../auth/user.model.js'
import { resolveOwnEmployee } from '../employees/employee-link.js'
import {
  BLOCKING_STATUSES,
  LEAVE_STATUSES,
  LeaveRequestModel,
  toPublicLeaveRequest,
  type LeaveRequestDoc,
} from './leave.model.js'
import { balancesFor, leaveYear } from './leave.service.js'

const router = Router()

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier.')
const dateKeySchema = z.string().refine(isValidDateKey, 'Use the YYYY-MM-DD format.')
const blankToUndefined = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema)

const auth = [requireAuth, requirePasswordChanged]
/** Employees read their own requests; HR and admin read the whole queue. */
const reader = [...auth, requireAnyPermission('leave.read.own', 'leave.approve')]
const applicant = [...auth, requirePermission('leave.apply')]
const approver = [...auth, requirePermission('leave.approve')]

const POPULATE = [
  { path: 'employeeId', select: 'fullName employeeCode userId' },
  { path: 'leaveTypeId', select: 'name code' },
]

function isApprover(req: Request): boolean {
  return Boolean(req.user && can(req.user.role, 'leave.approve'))
}

/** Everyone who can act on a request hears about a new one. */
async function notifyApprovers(employeeName: string, days: number): Promise<void> {
  const approvers = await UserModel.find({
    status: 'active',
    role: { $in: ['admin', 'hr'] },
  }).select('_id')

  await notify({
    userIds: approvers.map((user) => user._id),
    type: 'leave',
    title: 'New leave request',
    body: `${employeeName} requested ${days} day(s) of leave.`,
    link: '/leave/approvals',
  })
}

/* ------------------------------------------------------------------ */
/* Attendance side effects                                             */
/* ------------------------------------------------------------------ */

/** Approved leave is mirrored onto the attendance ledger as a `leave` day. */
async function markLeaveAttendance(request: LeaveRequestDoc, timeZone: string): Promise<void> {
  const fromKey = request.startDate.toISOString().slice(0, 10)
  const toKey = request.endDate.toISOString().slice(0, 10)
  const keys = await workingDayKeys(fromKey, toKey, timeZone)

  await Promise.all(
    keys.map((key) =>
      AttendanceModel.findOneAndUpdate(
        { employeeId: request.employeeId, date: dateKeyToUtcMidnight(key) },
        { $set: { status: 'leave', source: 'system', note: 'Approved leave' } },
        { upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  )
}

/** Cancelling approved leave removes only the rows this feature created. */
async function clearLeaveAttendance(request: LeaveRequestDoc, timeZone: string): Promise<void> {
  const fromKey = request.startDate.toISOString().slice(0, 10)
  const toKey = request.endDate.toISOString().slice(0, 10)
  const keys = await workingDayKeys(fromKey, toKey, timeZone)

  await AttendanceModel.deleteMany({
    employeeId: request.employeeId,
    date: { $in: keys.map((key) => dateKeyToUtcMidnight(key)) },
    status: 'leave',
    source: 'system',
  })
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

const applyBody = z.object({
  leaveTypeId: objectId,
  startDate: dateKeySchema,
  endDate: dateKeySchema,
  halfDay: z.boolean().optional(),
  reason: z.string().trim().min(5, 'Explain the reason for this leave.').max(500),
})

router.post(
  '/requests',
  applicant,
  validate({ body: applyBody }),
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const body = req.body as z.infer<typeof applyBody>

    if (body.endDate < body.startDate) {
      throw unprocessable('The end date cannot come before the start date.')
    }

    const leaveType = await LeaveTypeModel.findById(body.leaveTypeId)
    if (!leaveType || leaveType.isActive === false) {
      throw unprocessable('The selected leave type is not available.')
    }

    const { timezone } = await getCompanySettings()
    const workDays = await workingDayKeys(body.startDate, body.endDate, timezone)
    if (!workDays.length) {
      throw unprocessable('The selected range does not contain any working days.')
    }

    let days = workDays.length
    if (body.halfDay) {
      if (body.startDate !== body.endDate) {
        throw unprocessable('A half day must start and end on the same date.')
      }
      if (days !== 1) throw unprocessable('A half day must fall on a working day.')
      days = 0.5
    }

    const start = dateKeyToUtcMidnight(body.startDate)
    const end = dateKeyToUtcMidnight(body.endDate)

    const overlapping = await LeaveRequestModel.exists({
      employeeId: employee._id,
      status: { $in: BLOCKING_STATUSES },
      startDate: { $lte: end },
      endDate: { $gte: start },
    })
    if (overlapping) {
      throw conflict('You already have a pending or approved request covering these dates.')
    }

    const balances = await balancesFor(String(employee._id), leaveYear(start))
    const balance = balances.find((entry) => entry.leaveTypeId === body.leaveTypeId)
    if (!balance) throw unprocessable('The selected leave type is not available.')
    if (balance.available < days) {
      throw unprocessable(
        `Only ${balance.available} of ${balance.entitled} ${balance.name} day(s) remain available.`,
      )
    }

    const request = await LeaveRequestModel.create({
      employeeId: employee._id,
      leaveTypeId: body.leaveTypeId,
      startDate: start,
      endDate: end,
      days,
      halfDay: Boolean(body.halfDay),
      reason: body.reason,
    })
    await request.populate(POPULATE)

    await recordAudit(req, {
      action: 'apply',
      entity: 'leave_request',
      entityId: String(request._id),
      meta: { leaveType: leaveType.code, days, from: body.startDate, to: body.endDate },
    })

    await notifyApprovers(employee.fullName, days)

    ok(res, toPublicLeaveRequest(request), 201)
  }),
)
/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

const listQuery = z.object({
  status: blankToUndefined(z.enum(LEAVE_STATUSES).optional()),
  employeeId: blankToUndefined(objectId.optional()),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

router.get(
  '/requests',
  reader,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuery>
    const page = parsePage(req.query as Record<string, unknown>, 25)
    const filter: Record<string, unknown> = {}

    if (query.status) filter.status = query.status
    if (query.from) {
      filter.endDate = { $gte: dateKeyToUtcMidnight(query.from) }
    }
    if (query.to) {
      filter.startDate = { $lte: dateKeyToUtcMidnight(query.to) }
    }

    // An employee can only ever narrow the list to their own record.
    if (isApprover(req)) {
      if (query.employeeId) filter.employeeId = query.employeeId
    } else {
      const employee = await resolveOwnEmployee(req)
      filter.employeeId = employee._id
    }

    const [total, requests] = await Promise.all([
      LeaveRequestModel.countDocuments(filter),
      LeaveRequestModel.find(filter)
        .populate(POPULATE)
        .sort({ startDate: -1, createdAt: -1 })
        .skip(page.skip)
        .limit(page.limit),
    ])

    ok(res, requests.map(toPublicLeaveRequest), 200, pageMeta(total, page))
  }),
)

router.get(
  '/requests/:id',
  reader,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Leave request not found.')

    const request = await LeaveRequestModel.findById(id).populate(POPULATE)
    if (!request) throw notFound('Leave request not found.')

    if (!isApprover(req)) {
      const employee = await resolveOwnEmployee(req)
      if (String(request.employeeId._id ?? request.employeeId) !== String(employee._id)) {
        throw forbidden('You can only view your own leave requests.')
      }
    }

    ok(res, toPublicLeaveRequest(request))
  }),
)

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

router.patch(
  '/requests/:id/cancel',
  applicant,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Leave request not found.')

    const employee = await resolveOwnEmployee(req)
    const request = await LeaveRequestModel.findById(id)
    if (!request) throw notFound('Leave request not found.')

    if (String(request.employeeId) !== String(employee._id)) {
      throw forbidden('You can only cancel your own leave requests.')
    }

    if (request.status !== 'pending' && request.status !== 'approved') {
      throw conflict(`A ${request.status} request cannot be cancelled.`)
    }

    const { timezone } = await getCompanySettings()
    const today = dateKeyToUtcMidnight(zonedDateKey(new Date(), timezone))

    if (request.status === 'approved') {
      if (request.startDate <= today) {
        throw unprocessable('Leave that has already started cannot be cancelled.')
      }
      await clearLeaveAttendance(request, timezone)
    }

    request.status = 'cancelled'
    request.decidedAt = new Date()
    await request.save()
    await request.populate(POPULATE)

    await recordAudit(req, {
      action: 'cancel',
      entity: 'leave_request',
      entityId: id,
      meta: { days: request.days },
    })

    ok(res, toPublicLeaveRequest(request))
  }),
)

/* ------------------------------------------------------------------ */
/* Approve / reject                                                    */
/* ------------------------------------------------------------------ */

const decisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  decisionNote: z.string().trim().max(500).optional(),
})

router.patch(
  '/requests/:id/decision',
  approver,
  validate({ body: decisionBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Leave request not found.')

    const request = await LeaveRequestModel.findById(id)
    if (!request) throw notFound('Leave request not found.')
    if (request.status !== 'pending') {
      throw conflict(`This request has already been ${request.status}.`)
    }

    const { decision, decisionNote } = req.body as z.infer<typeof decisionBody>

    request.status = decision
    request.decidedBy = new mongoose.Types.ObjectId(req.user!.id)
    request.decisionNote = decisionNote
    request.decidedAt = new Date()
    await request.save()

    if (decision === 'approved') {
      const { timezone } = await getCompanySettings()
      await markLeaveAttendance(request, timezone)
    }

    await request.populate(POPULATE)
    await recordAudit(req, {
      action: decision,
      entity: 'leave_request',
      entityId: id,
      meta: { days: request.days, decisionNote },
    })

    // Tell the applicant, and only them — no one else needs the outcome.
    const applicant = request.employeeId as unknown as { userId?: mongoose.Types.ObjectId }
    if (applicant?.userId) {
      await notify({
        userIds: [applicant.userId],
        type: 'leave',
        title: `Leave request ${decision}`,
        body: decision === 'approved'
          ? `Your ${request.days}-day leave request has been approved.`
          : `Your leave request was rejected.${decisionNote ? ` ${decisionNote}` : ''}`,
        link: '/leave',
      })
    }

    ok(res, toPublicLeaveRequest(request))
  }),
)

/* ------------------------------------------------------------------ */
/* Balances and calendar                                               */
/* ------------------------------------------------------------------ */

const balanceQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  employeeId: blankToUndefined(objectId.optional()),
})

router.get(
  '/balances',
  reader,
  validate({ query: balanceQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof balanceQuery>
    const { timezone } = await getCompanySettings()
    const year = query.year ?? Number(zonedDateKey(new Date(), timezone).slice(0, 4))

    let employeeId: string
    if (isApprover(req) && query.employeeId) {
      employeeId = query.employeeId
    } else {
      employeeId = String((await resolveOwnEmployee(req))._id)
    }

    ok(res, { year, employeeId, balances: await balancesFor(employeeId, year) })
  }),
)

const calendarQuery = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
})

router.get(
  '/calendar',
  reader,
  validate({ query: calendarQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof calendarQuery>
    const { timezone } = await getCompanySettings()

    const today = zonedDateKey(new Date(), timezone)
    const from = query.from ?? today
    const to = query.to ?? `${from.slice(0, 4)}-12-31`
    if (from > to) throw unprocessable('The start of the range must come before its end.')

    const filter: Record<string, unknown> = {
      status: 'approved',
      startDate: { $lte: dateKeyToUtcMidnight(to) },
      endDate: { $gte: dateKeyToUtcMidnight(from) },
    }

    if (!isApprover(req)) {
      filter.employeeId = (await resolveOwnEmployee(req))._id
    }

    const requests = await LeaveRequestModel.find(filter)
      .populate(POPULATE)
      .sort({ startDate: 1 })
      .limit(500)

    ok(res, { from, to, entries: requests.map(toPublicLeaveRequest) })
  }),
)

export default router