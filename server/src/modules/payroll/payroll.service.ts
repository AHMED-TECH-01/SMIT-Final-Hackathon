import { dateKeyToUtcMidnight, zonedDateKey } from '../../lib/dates.js'
import { workingDayKeys } from '../../lib/working-days.js'
import { AttendanceModel } from '../attendance/attendance.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import {
  PayrollLineModel,
  PayrollRunModel,
  SalaryStructureModel,
  type PayrollRunDoc,
  type PayrollTotals,
  type SalaryComponent,
} from './payroll.model.js'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? 'Unknown'} ${year}`
}

/** First and last calendar day of a payroll period, as 'YYYY-MM-DD' keys. */
export function periodRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const key = periodKeyOf(year, month)
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, '0')}` }
}

export function currentPeriod(timeZone: string): { year: number; month: number } {
  const key = zonedDateKey(new Date(), timeZone)
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

function sum(components: SalaryComponent[]): number {
  return components.reduce((total, entry) => total + entry.amount, 0)
}

export interface ComputedPay {
  gross: number
  tax: number
  unpaidDeduction: number
  totalDeductions: number
  net: number
}

/**
 * Pure money calculation, separated from I/O so the arithmetic is trivially
 * testable and the rules live in exactly one place.
 *
 *  gross      = base + allowances
 *  tax        = taxPercent of gross
 *  unpaid     = gross / working days * absent days
 *  net        = gross - (tax + unpaid + fixed deductions)
 */
export function computeAmounts(
  structure: {
    baseSalary: number
    allowances: SalaryComponent[]
    deductions: SalaryComponent[]
    taxPercent: number
  },
  absentDays: number,
  workingDays: number,
): ComputedPay {
  const gross = structure.baseSalary + sum(structure.allowances)
  const tax = Math.round((gross * structure.taxPercent) / 100)
  const perDay = workingDays > 0 ? gross / workingDays : 0
  const unpaidDeduction = Math.max(0, Math.round(perDay * absentDays))
  const totalDeductions = sum(structure.deductions) + tax + unpaidDeduction

  return { gross, tax, unpaidDeduction, totalDeductions, net: gross - totalDeductions }
}

interface AttendanceTally {
  presentDays: number
  lateDays: number
  absentDays: number
  leaveDays: number
}

function emptyTally(): AttendanceTally {
  return { presentDays: 0, lateDays: 0, absentDays: 0, leaveDays: 0 }
}

/**
 * (Re)builds every payslip line for a draft run.
 *
 * Attendance is the input: only employees with a salary structure are paid, and
 * absences reduce pay pro-rata. Existing lines are replaced, so recomputing a
 * draft is always safe and repeatable.
 */
export async function buildRunLines(run: PayrollRunDoc, timeZone: string): Promise<PayrollTotals> {
  const { from, to } = periodRange(run.year, run.month)
  const workingDays = (await workingDayKeys(from, to, timeZone)).length

  const employees = await EmployeeModel.find({ status: { $in: ['active', 'probation'] } })
    .populate({ path: 'departmentId', select: 'name' })
    .sort({ fullName: 1 })
  const employeeIds = employees.map((employee) => employee._id)

  const [structures, records] = await Promise.all([
    SalaryStructureModel.find({ employeeId: { $in: employeeIds }, isActive: { $ne: false } }),
    AttendanceModel.find({
      employeeId: { $in: employeeIds },
      date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) },
    }).select('employeeId status'),
  ])

  const structureByEmployee = new Map(structures.map((entry) => [String(entry.employeeId), entry]))
  const tallyByEmployee = new Map<string, AttendanceTally>()

  for (const record of records) {
    const key = String(record.employeeId)
    const tally = tallyByEmployee.get(key) ?? emptyTally()

    if (record.status === 'present' || record.status === 'remote') tally.presentDays += 1
    else if (record.status === 'late') tally.lateDays += 1
    else if (record.status === 'absent') tally.absentDays += 1
    else if (record.status === 'leave') tally.leaveDays += 1
    // half-day is not counted as an absence: it is already a partial working day.

    tallyByEmployee.set(key, tally)
  }

  await PayrollLineModel.deleteMany({ runId: run._id })

  const totals: PayrollTotals = { headcount: 0, gross: 0, deductions: 0, tax: 0, net: 0 }

  for (const employee of employees) {
    const structure = structureByEmployee.get(String(employee._id))
    if (!structure) continue

    const tally = tallyByEmployee.get(String(employee._id)) ?? emptyTally()
    const amounts = computeAmounts(structure, tally.absentDays, workingDays)
    const department = employee.departmentId as unknown as { name?: string } | undefined

    await PayrollLineModel.create({
      runId: run._id,
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      departmentName: department?.name ?? null,
      currency: structure.currency,
      baseSalary: structure.baseSalary,
      allowances: structure.allowances,
      deductions: structure.deductions,
      gross: amounts.gross,
      tax: amounts.tax,
      unpaidDeduction: amounts.unpaidDeduction,
      totalDeductions: amounts.totalDeductions,
      net: amounts.net,
      workingDays,
      presentDays: tally.presentDays,
      lateDays: tally.lateDays,
      absentDays: tally.absentDays,
      leaveDays: tally.leaveDays,
    })

    totals.headcount += 1
    totals.gross += amounts.gross
    totals.deductions += amounts.totalDeductions
    totals.tax += amounts.tax
    totals.net += amounts.net
  }

  run.workingDays = workingDays
  run.totals = totals
  await run.save()

  return totals
}

/** Creates (or replaces the lines of) the draft run for one period. */
export async function createDraftRun(input: { year: number; month: number }): Promise<PayrollRunDoc> {
  const periodKey = periodKeyOf(input.year, input.month)
  const existing = await PayrollRunModel.findOne({ periodKey })
  if (existing) return existing

  return PayrollRunModel.create({
    periodKey,
    year: input.year,
    month: input.month,
    status: 'draft',
    workingDays: 0,
    totals: { headcount: 0, gross: 0, deductions: 0, tax: 0, net: 0 },
  })
}