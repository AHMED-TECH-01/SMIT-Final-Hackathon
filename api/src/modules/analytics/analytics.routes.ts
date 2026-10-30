import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { badRequest } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { dateKeyRange, dateKeyToUtcMidnight, isValidDateKey, zonedDateKey } from '../../lib/dates.js'
import { workingDayKeys } from '../../lib/working-days.js'
import { getCompanySettings } from '../organization/company.settings.js'
import { DepartmentModel } from '../organization/department.model.js'
import { LeaveTypeModel } from '../organization/leave-type.model.js'
import {
  AttendanceCorrectionModel,
  AttendanceModel,
  toPublicCorrection,
  type AttendanceStatus,
} from '../attendance/attendance.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { LeaveRequestModel, toPublicLeaveRequest } from '../leave/leave.model.js'
import { PayrollRunModel, toPublicRun } from '../payroll/payroll.model.js'

/**
 * Read-only analytics for the admin and HR dashboards.
 *
 * Every figure is derived on request from the operational collections instead of
 * being kept in a counter table, so a number can never drift away from the
 * records it summarises. Volumes here are demo scale; the response shapes would
 * survive a move to aggregation pipelines unchanged.
 */

const router = Router()

const auth = [requireAuth, requirePasswordChanged, requirePermission('analytics.read')]

/** Statuses that count as part of the current workforce. */
const WORKFORCE = ['active', 'probation']

/** Statuses that mean the person showed up for work. */
const ATTENDED: readonly AttendanceStatus[] = ['present', 'late', 'remote', 'half-day']

const LEAVE_POPULATE = [
  { path: 'employeeId', select: 'fullName employeeCode' },
  { path: 'leaveTypeId', select: 'name code' },
]
const CORRECTION_POPULATE = { path: 'employeeId', select: 'fullName employeeCode' }

const round1 = (value: number) => Math.round(value * 10) / 10
const percentage = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0)

function shiftDays(key: string, days: number): string {
  const date = dateKeyToUtcMidnight(key)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const name = key(item)
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

/** Reads either a raw ObjectId or a populated document. */
function refOf(value: unknown): {
  id: string | null
  name: string | null
  departmentId: string | null
} {
  if (!value) return { id: null, name: null, departmentId: null }
  if (typeof value === 'object' && '_id' in (value as object)) {
    const doc = value as { _id: unknown; fullName?: string; departmentId?: unknown }
    return {
      id: String(doc._id),
      name: doc.fullName ?? null,
      departmentId: doc.departmentId ? String(doc.departmentId) : null,
    }
  }
  return { id: String(value), name: null, departmentId: null }
}

/** Resolves an inclusive window, defaulting to the last `days` calendar days. */
function windowOf(input: { from?: string; to?: string; days?: number }, timeZone: string) {
  const to = input.to ?? zonedDateKey(new Date(), timeZone)
  const from = input.from ?? shiftDays(to, -((input.days ?? 30) - 1))
  if (dateKeyToUtcMidnight(from) > dateKeyToUtcMidnight(to)) {
    throw badRequest('The start of the range must come before the end.')
  }
  return { from, to }
}

function tenureBand(joinDate: Date, asOf: string): string {
  const dayMs = 24 * 60 * 60 * 1000
  const months = (dateKeyToUtcMidnight(asOf).getTime() - joinDate.getTime()) / (dayMs * 30.44)
  if (months < 12) return 'under-1-year'
  if (months < 36) return '1-3-years'
  if (months < 60) return '3-5-years'
  return '5-plus-years'
}

const dateKeySchema = z.string().refine(isValidDateKey, 'Use the YYYY-MM-DD format.')
const windowQuery = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  days: z.coerce.number().int().min(1).max(120).optional(),
})
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
const monthsQuery = z.object({ months: z.coerce.number().int().min(1).max(24).optional() })

/* ------------------------------------------------------------------ */
/* Payload builders                                                    */
/* ------------------------------------------------------------------ */

async function overviewPayload() {
  const { timezone } = await getCompanySettings()
  const asOf = zonedDateKey(new Date(), timezone)
  const from = shiftDays(asOf, -29)

  const [
    employees,
    todayRows,
    workingDays,
    pendingLeave,
    pendingCorrections,
    latestFinalized,
    latestDraft,
  ] = await Promise.all([
    EmployeeModel.find({ status: { $in: WORKFORCE } }).select('employmentType'),
    AttendanceModel.find({ date: dateKeyToUtcMidnight(asOf) }).select('status'),
    workingDayKeys(from, asOf, timezone),
    LeaveRequestModel.countDocuments({ status: 'pending' }),
    AttendanceCorrectionModel.countDocuments({ status: 'pending' }),
    PayrollRunModel.findOne({ status: 'finalized' }).sort({ year: -1, month: -1 }),
    PayrollRunModel.findOne({ status: 'draft' }).sort({ year: -1, month: -1 }),
  ])

  const periodRows = await AttendanceModel.find({
    date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(asOf) },
  }).select('status date')

  const working = new Set(workingDays)
  const considered = periodRows.filter((row) => working.has(row.date.toISOString().slice(0, 10)))
  const expected = employees.length * workingDays.length
  const attended = considered.filter((row) => ATTENDED.includes(row.status)).length
  const todayCounts = countBy(todayRows, (row) => row.status)

  return {
    asOf,
    timezone,
    workforce: {
      total: employees.length,
      byEmploymentType: Object.entries(countBy(employees, (row) => row.employmentType))
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    },
    today: {
      date: asOf,
      isWorkingDay: working.has(asOf),
      present: todayCounts.present ?? 0,
      late: todayCounts.late ?? 0,
      remote: todayCounts.remote ?? 0,
      absent: todayCounts.absent ?? 0,
      onLeave: todayCounts.leave ?? 0,
      marked: todayRows.length,
      notMarked: Math.max(0, employees.length - todayRows.length),
    },
    attendance: {
      from,
      to: asOf,
      workingDays: workingDays.length,
      expected,
      recorded: considered.length,
      attended,
      absent: considered.filter((row) => row.status === 'absent').length,
      rate: percentage(attended, expected),
    },
    pending: { leaveRequests: pendingLeave, corrections: pendingCorrections },
    payroll: {
      latestFinalized: latestFinalized ? toPublicRun(latestFinalized) : null,
      latestDraft: latestDraft ? toPublicRun(latestDraft) : null,
    },
  }
}

async function headcountPayload() {
  const { timezone } = await getCompanySettings()
  const asOf = zonedDateKey(new Date(), timezone)
  const monthStart = `${asOf.slice(0, 7)}-01`

  const [employees, roster, departments] = await Promise.all([
    EmployeeModel.find({ status: { $in: WORKFORCE } }).select(
      'departmentId employmentType joinDate',
    ),
    EmployeeModel.find().select('status'),
    DepartmentModel.find().select('name').sort({ name: 1 }),
  ])

  const departmentCounts = countBy(employees, (row) =>
    row.departmentId ? String(row.departmentId) : 'unassigned',
  )

  const byDepartment = departments
    .map((department) => ({
      departmentId: String(department._id),
      departmentName: department.name,
      count: departmentCounts[String(department._id)] ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.departmentName.localeCompare(b.departmentName))

  const unassigned = departmentCounts.unassigned ?? 0
  if (unassigned > 0) {
    byDepartment.push({ departmentId: '', departmentName: 'Unassigned', count: unassigned })
  }

  return {
    asOf,
    total: employees.length,
    byStatus: Object.entries(countBy(roster, (row) => row.status))
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    byEmploymentType: Object.entries(countBy(employees, (row) => row.employmentType))
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    byDepartment,
    tenure: ['under-1-year', '1-3-years', '3-5-years', '5-plus-years'].map((band) => ({
      band,
      count: employees.filter((row) => tenureBand(row.joinDate, asOf) === band).length,
    })),
    joiners: {
      thisMonth: employees.filter((row) => row.joinDate.toISOString().slice(0, 10) >= monthStart)
        .length,
      last30Days: employees.filter(
        (row) => row.joinDate.toISOString().slice(0, 10) > shiftDays(asOf, -30),
      ).length,
    },
  }
}
async function trendPayload(input: { from?: string; to?: string; days?: number }) {
  const { timezone } = await getCompanySettings()
  const { from, to } = windowOf(input, timezone)

  const [workingDays, rows, headcount] = await Promise.all([
    workingDayKeys(from, to, timezone),
    AttendanceModel.find({
      date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) },
    }).select('status date'),
    EmployeeModel.countDocuments({ status: { $in: WORKFORCE } }),
  ])

  const working = new Set(workingDays)
  const buckets = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10)
    const bucket = buckets.get(key) ?? {}
    bucket[row.status] = (bucket[row.status] ?? 0) + 1
    buckets.set(key, bucket)
  }

  const points = dateKeyRange(from, to).map((key) => {
    const bucket = buckets.get(key) ?? {}
    const attended = ATTENDED.reduce((total, status) => total + (bucket[status] ?? 0), 0)
    return {
      date: key,
      isWorkingDay: working.has(key),
      present: bucket.present ?? 0,
      late: bucket.late ?? 0,
      remote: bucket.remote ?? 0,
      absent: bucket.absent ?? 0,
      onLeave: bucket.leave ?? 0,
      marked: Object.values(bucket).reduce((total, value) => total + value, 0),
      rate: percentage(attended, headcount),
    }
  })

  return { from, to, headcount, points }
}

async function leaveUsagePayload(year: number) {
  const from = dateKeyToUtcMidnight(`${year}-01-01`)
  const to = dateKeyToUtcMidnight(`${year}-12-31`)

  const [types, requests, departments] = await Promise.all([
    LeaveTypeModel.find().sort({ name: 1 }).select('name code'),
    LeaveRequestModel.find({ startDate: { $gte: from, $lte: to } })
      .populate({ path: 'employeeId', select: 'fullName departmentId' })
      .populate({ path: 'leaveTypeId', select: 'name' }),
    DepartmentModel.find().select('name'),
  ])

  const departmentNames = new Map(departments.map((row) => [String(row._id), row.name]))
  const byStatus: Record<string, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
  const perType = new Map<string, { approvedDays: number; pendingDays: number; requests: number }>()
  const perEmployee = new Map<
    string,
    { name: string; departmentId: string | null; days: number }
  >()
  const perDepartment = new Map<string, number>()

  for (const request of requests) {
    byStatus[request.status] = (byStatus[request.status] ?? 0) + 1

    const typeId = refOf(request.leaveTypeId).id ?? 'unknown'
    const type = perType.get(typeId) ?? { approvedDays: 0, pendingDays: 0, requests: 0 }
    type.requests += 1
    if (request.status === 'approved') type.approvedDays += request.days
    if (request.status === 'pending') type.pendingDays += request.days
    perType.set(typeId, type)

    if (request.status !== 'approved') continue

    const employee = refOf(request.employeeId)
    const employeeKey = employee.id ?? 'unknown'
    const entry = perEmployee.get(employeeKey) ?? {
      name: employee.name ?? 'Unknown',
      departmentId: employee.departmentId,
      days: 0,
    }
    entry.days += request.days
    perEmployee.set(employeeKey, entry)

    const departmentKey = employee.departmentId ?? 'unassigned'
    perDepartment.set(departmentKey, (perDepartment.get(departmentKey) ?? 0) + request.days)
  }

  const approvedDays = [...perType.values()].reduce((total, entry) => total + entry.approvedDays, 0)
  const pendingDays = [...perType.values()].reduce((total, entry) => total + entry.pendingDays, 0)

  return {
    year,
    totals: { requests: requests.length, approvedDays, pendingDays },
    byStatus: ['pending', 'approved', 'rejected', 'cancelled'].map((status) => ({
      status,
      count: byStatus[status] ?? 0,
    })),
    byType: types.map((type) => {
      const entry = perType.get(String(type._id)) ?? {
        approvedDays: 0,
        pendingDays: 0,
        requests: 0,
      }
      return { leaveTypeId: String(type._id), name: type.name, ...entry }
    }),
    byDepartment: [...perDepartment.entries()]
      .map(([id, days]) => ({
        departmentId: id === 'unassigned' ? '' : id,
        departmentName: departmentNames.get(id) ?? 'Unassigned',
        days: round1(days),
      }))
      .sort((a, b) => b.days - a.days || a.departmentName.localeCompare(b.departmentName)),
    topAbsentees: [...perEmployee.entries()]
      .map(([id, entry]) => ({
        employeeId: id,
        employeeName: entry.name,
        departmentName: entry.departmentId
          ? (departmentNames.get(entry.departmentId) ?? null)
          : null,
        days: round1(entry.days),
      }))
      .sort((a, b) => b.days - a.days || a.employeeName.localeCompare(b.employeeName))
      .slice(0, 5),
  }
}

async function payrollCostPayload(months: number) {
  const runs = await PayrollRunModel.find({ status: 'finalized' })
    .sort({ year: -1, month: -1 })
    .limit(months)

  const ordered = [...runs].reverse()
  const totalNet = ordered.reduce((total, run) => total + run.totals.net, 0)

  return {
    months,
    points: ordered.map((run) => ({
      periodKey: run.periodKey,
      year: run.year,
      month: run.month,
      headcount: run.totals.headcount,
      gross: run.totals.gross,
      deductions: run.totals.deductions,
      tax: run.totals.tax,
      net: run.totals.net,
    })),
    latest: ordered.length > 0 ? toPublicRun(ordered[ordered.length - 1]) : null,
    averageNet: ordered.length > 0 ? Math.round(totalNet / ordered.length) : 0,
  }
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

router.use(...auth)

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    ok(res, await overviewPayload())
  }),
)

router.get(
  '/headcount',
  asyncHandler(async (_req, res) => {
    ok(res, await headcountPayload())
  }),
)

router.get(
  '/attendance-trend',
  validate({ query: windowQuery }),
  asyncHandler(async (req, res) => {
    ok(res, await trendPayload(req.query as unknown as z.infer<typeof windowQuery>))
  }),
)

router.get(
  '/leave-usage',
  validate({ query: yearQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof yearQuery>
    const { timezone } = await getCompanySettings()
    const year = query.year ?? Number(zonedDateKey(new Date(), timezone).slice(0, 4))
    ok(res, await leaveUsagePayload(year))
  }),
)

router.get(
  '/payroll-cost',
  validate({ query: monthsQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof monthsQuery>
    ok(res, await payrollCostPayload(query.months ?? 6))
  }),
)

/** One call that feeds the landing dashboard. */
router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [overview, breakdown, trend, leaveQueue, correctionQueue] = await Promise.all([
      overviewPayload(),
      headcountPayload(),
      trendPayload({ days: 14 }),
      LeaveRequestModel.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(5)
        .populate(LEAVE_POPULATE),
      AttendanceCorrectionModel.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(5)
        .populate(CORRECTION_POPULATE),
    ])

    ok(res, {
      generatedAt: new Date().toISOString(),
      overview,
      breakdown,
      trend: trend.points,
      queues: {
        leaveRequests: leaveQueue.map(toPublicLeaveRequest),
        corrections: correctionQueue.map(toPublicCorrection),
      },
    })
  }),
)

export default router