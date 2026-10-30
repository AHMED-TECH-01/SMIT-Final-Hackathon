import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { conflict, notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import { recordAudit } from '../../lib/audit.js'
import { nonWorkingKeys } from '../../lib/working-days.js'
import {
  dateKeyRange,
  dateKeyToUtcMidnight,
  isWeekend,
  isValidDateKey,
  zonedDateKey,
  zonedMinutesOfDay,
} from '../../lib/dates.js'
import { can } from '../auth/permissions.js'
import { getCompanySettings } from '../organization/company.settings.js'
import { HolidayModel } from '../organization/holiday.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { resolveOwnEmployee } from '../employees/employee-link.js'
import {
  ATTENDANCE_STATUSES,
  AttendanceCorrectionModel,
  AttendanceModel,
  CORRECTION_STATUSES,
  toPublicAttendance,
  toPublicCorrection,
} from './attendance.model.js'

const router = Router()

// The working day start and grace period live in company settings (see /settings).

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier.')
const dateKeySchema = z.string().refine(isValidDateKey, 'Use the YYYY-MM-DD format.')
/** Treats "" as "not provided" so blank filters behave like absent ones. */
const blankToUndefined = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema)

const auth = [requireAuth, requirePasswordChanged]
const selfService = [...auth, requirePermission('attendance.read')]
const staffOnly = [...auth, requirePermission('attendance.manage')]

const EMPLOYEE_REF = { path: 'employeeId', select: 'fullName employeeCode' }

function resolveRange(
  input: { from?: string; to?: string },
  timeZone: string,
): { from: string; to: string } {
  const from = input.from ?? zonedDateKey(new Date(Date.now() - 29 * 86_400_000), timeZone)
  const to = input.to ?? zonedDateKey(new Date(), timeZone)
  if (from > to) throw unprocessable('The start of the range must come before its end.')
  return { from, to }
}

interface Summary {
  total: number
  byStatus: Record<string, number>
  minutesLate: number
  minutesWorked: number
}

function summarise(
  records: { status: string; minutesLate: number; minutesWorked: number }[],
): Summary {
  const byStatus: Record<string, number> = {}
  let minutesLate = 0
  let minutesWorked = 0

  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1
    minutesLate += record.minutesLate
    minutesWorked += record.minutesWorked
  }

  return { total: records.length, byStatus, minutesLate, minutesWorked }
}
/* ------------------------------------------------------------------ */
/* Self-service: check-in, check-out, my history                       */
/* ------------------------------------------------------------------ */

router.post(
  '/check-in',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const { timezone, workStartMinutes, graceMinutes } = await getCompanySettings()

    const now = new Date()
    const date = dateKeyToUtcMidnight(zonedDateKey(now, timezone))
    const minutesLate = Math.max(
      0,
      zonedMinutesOfDay(now, timezone) - (workStartMinutes + graceMinutes),
    )

    const existing = await AttendanceModel.findOne({ employeeId: employee._id, date })
    if (existing?.checkInAt) throw conflict('You have already checked in today.')

    const record =
      existing ??
      new AttendanceModel({
        employeeId: employee._id,
        date,
        status: 'present',
        source: 'web',
      })

    record.checkInAt = now
    record.status = minutesLate > 0 ? 'late' : 'present'
    record.minutesLate = minutesLate
    record.source = 'web'
    await record.save()
    await record.populate(EMPLOYEE_REF)

    await recordAudit(req, {
      action: 'check_in',
      entity: 'attendance',
      entityId: String(record._id),
      meta: { status: record.status, minutesLate },
    })

    ok(res, toPublicAttendance(record), existing ? 200 : 201)
  }),
)

router.post(
  '/check-out',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const { timezone } = await getCompanySettings()

    const now = new Date()
    const date = dateKeyToUtcMidnight(zonedDateKey(now, timezone))
    const record = await AttendanceModel.findOne({ employeeId: employee._id, date })

    if (!record?.checkInAt) throw unprocessable('You have not checked in today.')
    if (record.checkOutAt) throw conflict('You have already checked out today.')

    record.checkOutAt = now
    record.minutesWorked = Math.max(
      0,
      Math.round((now.getTime() - record.checkInAt.getTime()) / 60_000),
    )
    await record.save()
    await record.populate(EMPLOYEE_REF)

    await recordAudit(req, {
      action: 'check_out',
      entity: 'attendance',
      entityId: String(record._id),
      meta: { minutesWorked: record.minutesWorked },
    })

    ok(res, toPublicAttendance(record))
  }),
)

router.get(
  '/today',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const { timezone } = await getCompanySettings()

    const key = zonedDateKey(new Date(), timezone)
    const day = dateKeyToUtcMidnight(key)
    const [record, holiday] = await Promise.all([
      AttendanceModel.findOne({ employeeId: employee._id, date: day }),
      HolidayModel.findOne({ date: day }).select('name'),
    ])

    ok(res, {
      date: key,
      employeeId: String(employee._id),
      checkedIn: Boolean(record?.checkInAt),
      checkedOut: Boolean(record?.checkOutAt),
      isHoliday: Boolean(holiday) || isWeekend(key, timezone),
      holidayName: holiday?.name ?? null,
      attendance: record ? toPublicAttendance(record) : null,
    })
  }),
)

const rangeQuery = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
})

router.get(
  '/me',
  selfService,
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const { timezone } = await getCompanySettings()
    const { from, to } = resolveRange(req.query as z.infer<typeof rangeQuery>, timezone)

    const records = await AttendanceModel.find({
      employeeId: employee._id,
      date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) },
    }).sort({ date: -1 })

    ok(res, {
      from,
      to,
      employeeId: String(employee._id),
      summary: summarise(records),
      records: records.map(toPublicAttendance),
    })
  }),
)
/* ------------------------------------------------------------------ */
/* Staff: daily board, ledger, summary, manual marking                 */
/* ------------------------------------------------------------------ */

const boardQuery = z.object({ date: dateKeySchema.optional() })

router.get(
  '/board',
  staffOnly,
  validate({ query: boardQuery }),
  asyncHandler(async (req, res) => {
    const { timezone } = await getCompanySettings()
    const requested = (req.query as z.infer<typeof boardQuery>).date
    const key = requested ?? zonedDateKey(new Date(), timezone)
    const day = dateKeyToUtcMidnight(key)

    const [employees, records, holiday] = await Promise.all([
      EmployeeModel.find({ status: { $in: ['active', 'probation'] } })
        .select('fullName employeeCode departmentId')
        .populate({ path: 'departmentId', select: 'name' })
        .sort({ fullName: 1 }),
      AttendanceModel.find({ date: day }),
      HolidayModel.findOne({ date: day }).select('name'),
    ])

    const byEmployee = new Map(records.map((record) => [String(record.employeeId), record]))
    const weekend = isWeekend(key, timezone)
    const nonWorking = Boolean(holiday) || weekend

    // Absence is only established once the day has passed. On today (or a future
    // date) an unmarked employee has simply not arrived yet, and calling them
    // absent would contradict the dashboard's "not marked" count.
    const undecided = key >= zonedDateKey(new Date(), timezone)

    const rows = employees.map((employee) => {
      const record = byEmployee.get(String(employee._id))
      const department = employee.departmentId as unknown as { name?: string } | undefined

      return {
        employeeId: String(employee._id),
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        departmentName: department?.name ?? null,
        status: record
          ? record.status
          : nonWorking
            ? 'holiday'
            : undecided
              ? 'not-marked'
              : 'absent',
        checkInAt: record?.checkInAt ?? null,
        checkOutAt: record?.checkOutAt ?? null,
        minutesLate: record?.minutesLate ?? 0,
        minutesWorked: record?.minutesWorked ?? 0,
        recorded: Boolean(record),
      }
    })

    const totals: Record<string, number> = {}
    for (const row of rows) totals[row.status] = (totals[row.status] ?? 0) + 1

    ok(res, {
      date: key,
      weekend,
      holidayName: holiday?.name ?? null,
      totals,
      headcount: rows.length,
      rows,
    })
  }),
)

const ledgerQuery = z.object({
  employeeId: blankToUndefined(objectId.optional()),
  status: blankToUndefined(z.enum(ATTENDANCE_STATUSES).optional()),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

router.get(
  '/',
  staffOnly,
  validate({ query: ledgerQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof ledgerQuery>
    const page = parsePage(req.query as Record<string, unknown>, 50)

    const filter: Record<string, unknown> = {}
    if (query.employeeId) filter.employeeId = query.employeeId
    if (query.status) filter.status = query.status

    const { timezone } = await getCompanySettings()
    const { from, to } = resolveRange(query, timezone)
    filter.date = { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) }

    const [total, records] = await Promise.all([
      AttendanceModel.countDocuments(filter),
      AttendanceModel.find(filter)
        .populate(EMPLOYEE_REF)
        .sort({ date: -1 })
        .skip(page.skip)
        .limit(page.limit),
    ])

    ok(res, records.map(toPublicAttendance), 200, { ...pageMeta(total, page), from, to })
  }),
)

const summaryQuery = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  departmentId: blankToUndefined(objectId.optional()),
})

router.get(
  '/summary',
  staffOnly,
  validate({ query: summaryQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof summaryQuery>
    const { timezone } = await getCompanySettings()
    const { from, to } = resolveRange(query, timezone)

    const employeeFilter: Record<string, unknown> = { status: { $in: ['active', 'probation'] } }
    if (query.departmentId) employeeFilter.departmentId = query.departmentId

    const [employees, records, nonWorking] = await Promise.all([
      EmployeeModel.find(employeeFilter)
        .select('fullName employeeCode departmentId')
        .populate({ path: 'departmentId', select: 'name' })
        .sort({ fullName: 1 }),
      AttendanceModel.find({
        date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) },
      }).select('employeeId status minutesLate minutesWorked'),
      nonWorkingKeys(from, to, timezone),
    ])

    const workingDays = dateKeyRange(from, to).filter((key) => !nonWorking.has(key)).length

    const grouped = new Map<string, { status: string; minutesLate: number; minutesWorked: number }[]>()
    for (const record of records) {
      const key = String(record.employeeId)
      const bucket = grouped.get(key)
      if (bucket) bucket.push(record)
      else grouped.set(key, [record])
    }

    const rows = employees.map((employee) => {
      const stats = summarise(grouped.get(String(employee._id)) ?? [])
      const department = employee.departmentId as unknown as { name?: string } | undefined
      const credited =
        (stats.byStatus.present ?? 0) +
        (stats.byStatus.late ?? 0) +
        (stats.byStatus.remote ?? 0) +
        (stats.byStatus['half-day'] ?? 0) * 0.5

      return {
        employeeId: String(employee._id),
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        departmentName: department?.name ?? null,
        ...stats,
        attendanceRate: workingDays ? Math.round((credited / workingDays) * 100) / 100 : 0,
      }
    })

    ok(res, { from, to, workingDays, rows })
  }),
)

const markBody = z.object({
  employeeId: objectId,
  date: dateKeySchema,
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().trim().max(300).optional(),
})

/** Manual marking for HR: covers back-dated entries without a correction request. */
router.post(
  '/mark',
  staffOnly,
  validate({ body: markBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof markBody>

    const employee = await EmployeeModel.exists({ _id: body.employeeId })
    if (!employee) throw notFound('Employee not found.')

    const record = await AttendanceModel.findOneAndUpdate(
      { employeeId: body.employeeId, date: dateKeyToUtcMidnight(body.date) },
      { $set: { status: body.status, note: body.note, source: 'manual' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).populate(EMPLOYEE_REF)

    await recordAudit(req, {
      action: 'mark',
      entity: 'attendance',
      entityId: record ? String(record._id) : undefined,
      meta: { employeeId: body.employeeId, date: body.date, status: body.status },
    })

    ok(res, record ? toPublicAttendance(record) : null)
  }),
)
/* ------------------------------------------------------------------ */
/* Attendance correction requests                                      */
/* ------------------------------------------------------------------ */

const correctionBody = z.object({
  date: dateKeySchema,
  requestedStatus: z.enum(ATTENDANCE_STATUSES),
  requestedCheckInAt: blankToUndefined(z.coerce.date().optional()),
  requestedCheckOutAt: blankToUndefined(z.coerce.date().optional()),
  reason: z.string().trim().min(5, 'Explain why this correction is needed.').max(500),
})

router.post(
  '/corrections',
  selfService,
  validate({ body: correctionBody }),
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const body = req.body as z.infer<typeof correctionBody>
    const date = dateKeyToUtcMidnight(body.date)

    if (
      body.requestedCheckInAt &&
      body.requestedCheckOutAt &&
      body.requestedCheckOutAt <= body.requestedCheckInAt
    ) {
      throw unprocessable('The check-out time must come after the check-in time.')
    }

    const alreadyPending = await AttendanceCorrectionModel.exists({
      employeeId: employee._id,
      date,
      status: 'pending',
    })
    if (alreadyPending) {
      throw conflict('A correction for that date is already awaiting review.')
    }

    const correction = await AttendanceCorrectionModel.create({
      employeeId: employee._id,
      date,
      requestedStatus: body.requestedStatus,
      requestedCheckInAt: body.requestedCheckInAt,
      requestedCheckOutAt: body.requestedCheckOutAt,
      reason: body.reason,
    })
    await correction.populate(EMPLOYEE_REF)

    await recordAudit(req, {
      action: 'request',
      entity: 'attendance_correction',
      entityId: String(correction._id),
      meta: { date: body.date, requestedStatus: body.requestedStatus },
    })

    ok(res, toPublicCorrection(correction), 201)
  }),
)

const correctionListQuery = z.object({
  status: blankToUndefined(z.enum(CORRECTION_STATUSES).optional()),
})

router.get(
  '/corrections',
  selfService,
  validate({ query: correctionListQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof correctionListQuery>
    const filter: Record<string, unknown> = {}
    if (query.status) filter.status = query.status

    // Employees only ever see their own requests; HR and admin see the whole queue.
    if (!req.user || !can(req.user.role, 'attendance.manage')) {
      const employee = await resolveOwnEmployee(req)
      filter.employeeId = employee._id
    }

    const corrections = await AttendanceCorrectionModel.find(filter)
      .populate(EMPLOYEE_REF)
      .sort({ createdAt: -1 })
      .limit(200)

    ok(res, corrections.map(toPublicCorrection))
  }),
)

const decisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  decisionNote: z.string().trim().max(500).optional(),
})

router.patch(
  '/corrections/:id',
  staffOnly,
  validate({ body: decisionBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Correction request not found.')

    const correction = await AttendanceCorrectionModel.findById(id)
    if (!correction) throw notFound('Correction request not found.')
    if (correction.status !== 'pending') {
      throw conflict('This request has already been reviewed.')
    }

    const { decision, decisionNote } = req.body as z.infer<typeof decisionBody>

    correction.status = decision
    correction.decidedBy = new mongoose.Types.ObjectId(req.user!.id)
    correction.decisionNote = decisionNote
    correction.decidedAt = new Date()
    await correction.save()

    // Approving writes the claimed hours back onto the attendance ledger.
    if (decision === 'approved') {
      const update: Record<string, unknown> = {
        status: correction.requestedStatus,
        source: 'correction',
      }
      if (correction.requestedCheckInAt) update.checkInAt = correction.requestedCheckInAt
      if (correction.requestedCheckOutAt) update.checkOutAt = correction.requestedCheckOutAt
      if (correction.requestedCheckInAt && correction.requestedCheckOutAt) {
        update.minutesWorked = Math.max(
          0,
          Math.round(
            (correction.requestedCheckOutAt.getTime() -
              correction.requestedCheckInAt.getTime()) /
              60_000,
          ),
        )
      }

      await AttendanceModel.findOneAndUpdate(
        { employeeId: correction.employeeId, date: correction.date },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
    }

    await correction.populate(EMPLOYEE_REF)
    await recordAudit(req, {
      action: decision === 'approved' ? 'approve' : 'reject',
      entity: 'attendance_correction',
      entityId: id,
      meta: { decision, decisionNote },
    })

    ok(res, toPublicCorrection(correction))
  }),
)

export default router