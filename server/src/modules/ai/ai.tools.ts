import type { Request } from 'express'
import { zonedDateKey, dateKeyToUtcMidnight } from '../../lib/dates.js'
import { can } from '../auth/permissions.js'
import { getCompanySettings } from '../organization/company.settings.js'
import { DepartmentModel } from '../organization/department.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { resolveOwnEmployee } from '../employees/employee-link.js'
import {
  AttendanceCorrectionModel,
  AttendanceModel,
} from '../attendance/attendance.model.js'
import { LeaveRequestModel } from '../leave/leave.model.js'
import { balancesFor } from '../leave/leave.service.js'
import { PayrollRunModel } from '../payroll/payroll.model.js'
import { periodLabel } from '../payroll/payroll.service.js'

/**
 * The assistant's tools.
 *
 * Each tool is an ordinary database query that returns a fact plus a sentence
 * built from it. Nothing is invented: if the data says zero, the answer says
 * zero. Answering therefore never depends on a model being reachable.
 */

export interface ToolResult {
  name: string
  label: string
  /** One-line machine summary used as provider context. */
  summary: string
  /** The deterministic sentence the rules provider returns. */
  answer: string
  data: unknown
}

const WORKFORCE = ['active', 'probation']

function money(amount: number, currency = 'PKR'): string {
  return `${currency} ${amount.toLocaleString('en-US')}`
}

/** Reads either a raw ObjectId or a populated document. */
function refName(value: unknown, field = 'fullName'): string | null {
  if (value && typeof value === 'object' && field in (value as object)) {
    return (value as Record<string, string>)[field] ?? null
  }
  return null
}

export async function headcountTool(): Promise<ToolResult> {
  const [employees, departments] = await Promise.all([
    EmployeeModel.find({ status: { $in: WORKFORCE } }).select('departmentId'),
    DepartmentModel.find().select('name'),
  ])

  const names = new Map(departments.map((department) => [String(department._id), department.name]))
  const counts = new Map<string, number>()
  for (const employee of employees) {
    const key = employee.departmentId
      ? (names.get(String(employee.departmentId)) ?? 'Unassigned')
      : 'Unassigned'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const byDepartment = [...counts.entries()]
    .map(([departmentName, count]) => ({ departmentName, count }))
    .sort((a, b) => b.count - a.count || a.departmentName.localeCompare(b.departmentName))

  const total = employees.length
  const breakdown = byDepartment.map((entry) => `${entry.departmentName} (${entry.count})`)

  return {
    name: 'headcount',
    label: 'Headcount',
    summary: `${total} active employee(s)${breakdown.length ? `; by department: ${breakdown.join(', ')}` : ''}.`,
    answer:
      total === 0
        ? 'There are no employees on the roster yet.'
        : `You currently have ${total} active employee(s).${
            breakdown.length ? ` By department: ${breakdown.join(', ')}.` : ''
          }`,
    data: { total, byDepartment },
  }
}

export async function attendanceTodayTool(): Promise<ToolResult> {
  const { timezone } = await getCompanySettings()
  const day = zonedDateKey(new Date(), timezone)

  const [rows, headcount] = await Promise.all([
    AttendanceModel.find({ date: dateKeyToUtcMidnight(day) }).populate({
      path: 'employeeId',
      select: 'fullName',
    }),
    EmployeeModel.countDocuments({ status: { $in: WORKFORCE } }),
  ])

  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1

  const absent = rows
    .filter((row) => row.status === 'absent')
    .map((row) => refName(row.employeeId))
    .filter((name): name is string => Boolean(name))

  const present = (counts.present ?? 0) + (counts.remote ?? 0)
  const notMarked = Math.max(0, headcount - rows.length)

  return {
    name: 'attendance_today',
    label: `Attendance on ${day}`,
    summary: `present ${present}, late ${counts.late ?? 0}, absent ${counts.absent ?? 0}, on leave ${counts.leave ?? 0}, not marked ${notMarked}.`,
    answer: `Today (${day}): ${present} present, ${counts.late ?? 0} late, ${counts.absent ?? 0} absent and ${counts.leave ?? 0} on leave. ${notMarked} employee(s) have not checked in yet.${
      absent.length ? ` Marked absent: ${absent.join(', ')}.` : ''
    }`,
    data: {
      date: day,
      present,
      late: counts.late ?? 0,
      absent: counts.absent ?? 0,
      onLeave: counts.leave ?? 0,
      notMarked,
      absentEmployees: absent,
    },
  }
}

export async function leaveBalanceTool(req: Request): Promise<ToolResult> {
  const employee = await resolveOwnEmployee(req)
  const { timezone } = await getCompanySettings()
  const year = Number(zonedDateKey(new Date(), timezone).slice(0, 4))
  const balances = await balancesFor(String(employee._id), year)

  const used = balances.filter((entry) => entry.entitled > 0 || entry.used > 0)
  const parts = used.map(
    (entry) => `${entry.name}: ${entry.available} of ${entry.entitled} day(s) available`,
  )

  return {
    name: 'leave_balance',
    label: `Leave balance ${year}`,
    summary: parts.length ? parts.join('; ') : 'No leave types have been configured.',
    answer: parts.length
      ? `As of ${year} you have ${parts.join(', ')}.`
      : 'No leave types have been configured yet, so there is no balance to report.',
    data: { year, balances },
  }
}

export async function pendingApprovalsTool(): Promise<ToolResult> {
  const [leaveRequests, corrections] = await Promise.all([
    LeaveRequestModel.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(5)
      .populate({ path: 'employeeId', select: 'fullName' }),
    AttendanceCorrectionModel.countDocuments({ status: 'pending' }),
  ])

  const total = await LeaveRequestModel.countDocuments({ status: 'pending' })
  const names = leaveRequests
    .map((request) => refName(request.employeeId))
    .filter((name): name is string => Boolean(name))

  return {
    name: 'pending_approvals',
    label: 'Pending approvals',
    summary: `${total} leave request(s) and ${corrections} attendance correction(s) waiting.`,
    answer:
      total + corrections === 0
        ? 'Nothing is waiting for approval right now.'
        : `${total} leave request(s) and ${corrections} attendance correction(s) are waiting for approval.${
            names.length ? ` Oldest in the queue: ${names.join(', ')}.` : ''
          }`,
    data: { leaveRequests: total, corrections, oldest: names },
  }
}

export async function payrollSummaryTool(): Promise<ToolResult> {
  const [latestFinalized, latestDraft] = await Promise.all([
    PayrollRunModel.findOne({ status: 'finalized' }).sort({ year: -1, month: -1 }),
    PayrollRunModel.findOne({ status: 'draft' }).sort({ year: -1, month: -1 }),
  ])

  const parts: string[] = []
  if (latestFinalized) {
    parts.push(
      `${periodLabel(latestFinalized.year, latestFinalized.month)} was finalized at ${money(latestFinalized.totals.net)} net for ${latestFinalized.totals.headcount} employee(s)`,
    )
  }
  if (latestDraft) {
    parts.push(
      `${periodLabel(latestDraft.year, latestDraft.month)} is still a draft with ${money(latestDraft.totals.net)} net`,
    )
  }

  return {
    name: 'payroll_summary',
    label: 'Payroll',
    summary: parts.length ? `${parts.join('; ')}.` : 'No payroll runs have been created yet.',
    answer: parts.length
      ? `${parts.join('. ')}.`
      : 'No payroll runs have been created yet.',
    data: {
      latestFinalized: latestFinalized
        ? {
            periodKey: latestFinalized.periodKey,
            net: latestFinalized.totals.net,
            headcount: latestFinalized.totals.headcount,
          }
        : null,
      latestDraft: latestDraft
        ? {
            periodKey: latestDraft.periodKey,
            net: latestDraft.totals.net,
            headcount: latestDraft.totals.headcount,
          }
        : null,
    },
  }
}

export async function employeeLookupTool(term: string): Promise<ToolResult> {
  const needle = term.trim()
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const matches = await EmployeeModel.find({
    $or: [{ fullName: pattern }, { employeeCode: pattern }],
  })
    .populate({ path: 'departmentId', select: 'name' })
    .populate({ path: 'designationId', select: 'title' })
    .limit(5)

  const people = matches.map((employee) => ({
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    departmentName: refName(employee.departmentId, 'name'),
    designationTitle: refName(employee.designationId, 'title'),
    status: employee.status,
    employmentType: employee.employmentType,
  }))

  return {
    name: 'employee_lookup',
    label: 'Employee lookup',
    summary: people.length
      ? people
          .map(
            (person) =>
              `${person.fullName} (${person.employeeCode}) — ${person.departmentName ?? 'no department'}, ${person.status}`,
          )
          .join('; ')
      : `No employee matched "${needle}".`,
    answer:
      people.length === 0
        ? `I could not find anyone matching "${needle}".`
        : `I found ${people.length} match(es): ${people
            .map(
              (person) =>
                `${person.fullName} (${person.employeeCode}), ${person.departmentName ?? 'no department'}, ${person.status}`,
            )
            .join('; ')}.`,
    data: { query: needle, matches: people },
  }
}

/** Tools a role is allowed to run against other people's records. */
export function canSeeCompanyWide(req: Request): boolean {
  return Boolean(req.user && can(req.user.role, 'analytics.read'))
}

export const SUGGESTIONS_BY_AUDIENCE: Record<'admin' | 'hr' | 'employee', string[]> = {
  admin: [
    'How many employees do we have?',
    "Who is absent today?",
    'What is pending for approval?',
    'What did payroll cost last month?',
  ],
  hr: [
    'How many employees do we have?',
    "Who is absent today?",
    'What is pending for approval?',
    'Find Ayesha in the directory',
  ],
  employee: [
    'How many leave days do I have left?',
    'What is my leave balance?',
    'How do I apply for leave?',
  ],
}