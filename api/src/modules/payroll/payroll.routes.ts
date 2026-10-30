import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { conflict, notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { recordAudit } from '../../lib/audit.js'
import { notify } from '../../lib/notify.js'
import { buildPdf, type PdfLine } from '../../lib/pdf.js'
import { zonedDateKey } from '../../lib/dates.js'
import { getCompanySettings } from '../organization/company.settings.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { resolveOwnEmployee } from '../employees/employee-link.js'
import {
  PayrollLineModel,
  PayrollRunModel,
  SalaryStructureModel,
  toPublicLine,
  toPublicRun,
  toPublicStructure,
  type PayrollLineDoc,
} from './payroll.model.js'
import {
  buildRunLines,
  createDraftRun,
  periodLabel,
  periodRange,
  currentPeriod,
} from './payroll.service.js'

const router = Router()

const auth = [requireAuth, requirePasswordChanged]
const company = [...auth, requirePermission('payroll.read.company')]
const processor = [...auth, requirePermission('payroll.process')]
const approver = [...auth, requirePermission('payroll.approve')]
const selfService = [...auth, requirePermission('payroll.read.own')]

/* ------------------------------------------------------------------ */
/* Salary structures                                                   */
/* ------------------------------------------------------------------ */

const componentList = z
  .array(
    z.object({
      label: z.string().trim().min(1, 'Give the component a label.').max(60),
      amount: z.coerce.number().min(0).max(100_000_000),
    }),
  )
  .max(20)

const structureBody = z.object({
  currency: z.string().trim().min(1).max(8).optional(),
  baseSalary: z.coerce.number().min(0).max(100_000_000),
  allowances: componentList.optional(),
  deductions: componentList.optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  effectiveFrom: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
})

const EMPLOYEE_REF = { path: 'employeeId', select: 'fullName employeeCode' }

router.get(
  '/structures',
  company,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    // Structures are few, but the search is by employee name, so the filter has
    // to run against the employee collection first.
    let employeeIds: mongoose.Types.ObjectId[] | undefined
    if (q) {
      const matches = await EmployeeModel.find({
        $or: [{ fullName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }],
      }).select('_id')
      employeeIds = matches.map((employee) => employee._id)
    }

    const structures = await SalaryStructureModel.find(
      employeeIds ? { employeeId: { $in: employeeIds } } : {},
    )
      .populate(EMPLOYEE_REF)
      .sort({ createdAt: -1 })
      .limit(500)

    ok(res, structures.map(toPublicStructure))
  }),
)

router.get(
  '/structures/:employeeId',
  company,
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params
    if (!mongoose.isValidObjectId(employeeId)) throw notFound('Salary structure not found.')

    const structure = await SalaryStructureModel.findOne({ employeeId }).populate(EMPLOYEE_REF)
    if (!structure) throw notFound('Salary structure not found.')

    ok(res, toPublicStructure(structure))
  }),
)

/** Upsert: one active structure per employee, so this is an idempotent replace. */
router.put(
  '/structures/:employeeId',
  processor,
  validate({ body: structureBody }),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params
    if (!mongoose.isValidObjectId(employeeId)) throw notFound('Employee not found.')

    const employee = await EmployeeModel.exists({ _id: employeeId })
    if (!employee) throw notFound('Employee not found.')

    const body = req.body as z.infer<typeof structureBody>

    const structure = await SalaryStructureModel.findOneAndUpdate(
      { employeeId },
      {
        $set: {
          ...body,
          effectiveFrom: body.effectiveFrom ?? new Date(),
          allowances: body.allowances ?? [],
          deductions: body.deductions ?? [],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).populate(EMPLOYEE_REF)

    await recordAudit(req, {
      action: 'upsert',
      entity: 'salary_structure',
      entityId: String(structure?._id),
      meta: { employeeId, baseSalary: body.baseSalary },
    })

    ok(res, structure ? toPublicStructure(structure) : null)
  }),
)

router.delete(
  '/structures/:employeeId',
  processor,
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params
    if (!mongoose.isValidObjectId(employeeId)) throw notFound('Salary structure not found.')

    const removed = await SalaryStructureModel.findOneAndDelete({ employeeId })
    if (!removed) throw notFound('Salary structure not found.')

    await recordAudit(req, {
      action: 'delete',
      entity: 'salary_structure',
      entityId: String(removed._id),
      meta: { employeeId },
    })

    ok(res, { deleted: true })
  }),
)

/* ------------------------------------------------------------------ */
/* Payroll runs                                                        */
/* ------------------------------------------------------------------ */

const createRunBody = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

router.post(
  '/runs',
  processor,
  validate({ body: createRunBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createRunBody>
    const { timezone } = await getCompanySettings()
    const fallback = currentPeriod(timezone)

    const year = body.year ?? fallback.year
    const month = body.month ?? fallback.month

    const existing = await PayrollRunModel.findOne({ periodKey: `${year}-${String(month).padStart(2, '0')}` })
    if (existing?.status === 'finalized') {
      throw conflict(`Payroll for ${periodLabel(year, month)} has already been finalized.`)
    }

    await createDraftRun({ year, month })
    const run = await PayrollRunModel.findOne({ year, month })
    if (!run) throw unprocessable('Could not create the payroll run.')

    await buildRunLines(run, timezone)

    await recordAudit(req, {
      action: 'create',
      entity: 'payroll_run',
      entityId: String(run._id),
      meta: { period: run.periodKey, headcount: run.totals.headcount },
    })

    ok(res, toPublicRun(run), existing ? 200 : 201)
  }),
)

router.get(
  '/runs',
  company,
  asyncHandler(async (req, res) => {
    const year = Number.parseInt(String(req.query.year ?? ''), 10)
    const filter = Number.isFinite(year) ? { year } : {}

    const runs = await PayrollRunModel.find(filter).sort({ year: -1, month: -1 }).limit(120)
    ok(res, runs.map(toPublicRun))
  }),
)

router.get(
  '/runs/:id',
  company,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Payroll run not found.')

    const run = await PayrollRunModel.findById(id)
    if (!run) throw notFound('Payroll run not found.')

    const lines = await PayrollLineModel.find({ runId: run._id }).sort({ fullName: 1 })

    ok(res, { run: toPublicRun(run), lines: lines.map(toPublicLine) })
  }),
)

router.post(
  '/runs/:id/recompute',
  processor,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Payroll run not found.')

    const run = await PayrollRunModel.findById(id)
    if (!run) throw notFound('Payroll run not found.')
    if (run.status === 'finalized') {
      throw conflict('This run is finalized; its figures are immutable.')
    }

    const { timezone } = await getCompanySettings()
    await buildRunLines(run, timezone)

    await recordAudit(req, {
      action: 'recompute',
      entity: 'payroll_run',
      entityId: id,
      meta: { period: run.periodKey, headcount: run.totals.headcount },
    })

    ok(res, toPublicRun(run))
  }),
)

/**
 * Finalizing is the only irreversible payroll action, so it requires the
 * admin-only `payroll.approve` permission — HR can prepare but not approve.
 */
router.post(
  '/runs/:id/finalize',
  approver,
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Payroll run not found.')

    const run = await PayrollRunModel.findById(id)
    if (!run) throw notFound('Payroll run not found.')
    if (run.status === 'finalized') throw conflict('This run has already been finalized.')
    if (run.totals.headcount === 0) {
      throw unprocessable('There is nothing to finalize: no employee has a salary structure.')
    }

    run.status = 'finalized'
    run.finalizedBy = new mongoose.Types.ObjectId(req.user!.id)
    run.finalizedAt = new Date()
    await run.save()

    await recordAudit(req, {
      action: 'finalize',
      entity: 'payroll_run',
      entityId: id,
      meta: { period: run.periodKey, net: run.totals.net },
    })

    // A payslip only becomes visible once the run is final, so this is the
    // first moment an employee can be told it exists.
    const lines = await PayrollLineModel.find({ runId: run._id }).select('employeeId')
    if (lines.length > 0) {
      const employees = await EmployeeModel.find({
        _id: { $in: lines.map((line) => line.employeeId) },
        userId: { $ne: null },
      }).select('userId')

      await notify({
        userIds: employees
          .map((employee) => employee.userId)
          .filter((userId): userId is mongoose.Types.ObjectId => Boolean(userId)),
        type: 'payroll',
        title: `Payslip ready — ${periodLabel(run.year, run.month)}`,
        body: `Your payslip for ${periodLabel(run.year, run.month)} is available to download.`,
        link: '/payroll/payslips',
      })
    }

    ok(res, toPublicRun(run))
  }),
)
/* ------------------------------------------------------------------ */
/* Payslips                                                            */
/* ------------------------------------------------------------------ */

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US')}`
}

/** Builds the single-page payslip document from a stored payroll line. */
function payslipPdf(input: {
  companyName: string
  period: string
  range: string
  line: PayrollLineDoc
  status: string
  generatedOn: string
}): Buffer {
  const { line } = input
  const rows: PdfLine[] = [
    { text: input.companyName, size: 18, bold: true, gap: 12 },
    { text: 'PAYSLIP', size: 13, bold: true, gap: 14 },
    { text: `Period:       ${input.period} (${input.range})` },
    { text: `Employee:     ${line.fullName} (${line.employeeCode})` },
    { text: `Department:   ${line.departmentName ?? 'Not assigned'}` },
    { text: `Status:       ${input.status.toUpperCase()}`, gap: 16 },
    { text: 'EARNINGS', bold: true, gap: 8 },
    { text: `Base salary          ${money(line.baseSalary, line.currency)}` },
    ...line.allowances.map((entry) => ({
      text: `${entry.label.padEnd(20).slice(0, 20)} ${money(entry.amount, line.currency)}`,
    })),
    { text: `Gross pay            ${money(line.gross, line.currency)}`, bold: true, gap: 16 },
    { text: 'DEDUCTIONS', bold: true, gap: 8 },
    ...line.deductions.map((entry) => ({
      text: `${entry.label.padEnd(20).slice(0, 20)} ${money(entry.amount, line.currency)}`,
    })),
    { text: `Income tax           ${money(line.tax, line.currency)}` },
    { text: `Unpaid absence       ${money(line.unpaidDeduction, line.currency)}` },
    { text: `Total deductions     ${money(line.totalDeductions, line.currency)}`, bold: true, gap: 16 },
    { text: `NET PAY              ${money(line.net, line.currency)}`, size: 13, bold: true, gap: 18 },
    { text: 'ATTENDANCE', bold: true, gap: 8 },
    { text: `Working days ${line.workingDays} | Present ${line.presentDays} | Late ${line.lateDays} | Leave ${line.leaveDays} | Absent ${line.absentDays}` },
    { text: `Generated on ${input.generatedOn}`, size: 9, gap: 0 },
  ]

  return buildPdf(rows)
}

async function loadRunOr404(id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Payroll run not found.')
  const run = await PayrollRunModel.findById(id)
  if (!run) throw notFound('Payroll run not found.')
  return run
}

router.get(
  '/payslips',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)

    // Only finalized runs are published to the employee.
    const runs = await PayrollRunModel.find({ status: 'finalized' }).select('_id year month periodKey')
    if (!runs.length) {
      ok(res, [])
      return
    }

    const lines = await PayrollLineModel.find({
      employeeId: employee._id,
      runId: { $in: runs.map((run) => run._id) },
    }).sort({ createdAt: -1 })

    const runById = new Map(runs.map((run) => [String(run._id), run]))

    ok(
      res,
      lines.map((line) => {
        const run = runById.get(String(line.runId))
        return {
          ...toPublicLine(line),
          periodKey: run?.periodKey ?? null,
          periodLabel: run ? periodLabel(run.year, run.month) : null,
        }
      }),
    )
  }),
)

router.get(
  '/payslips/:runId',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const run = await loadRunOr404(req.params.runId)

    if (run.status !== 'finalized') throw notFound('Payslip not found.')
    const line = await PayrollLineModel.findOne({ runId: run._id, employeeId: employee._id })
    if (!line) throw notFound('Payslip not found.')

    ok(res, {
      run: toPublicRun(run),
      periodLabel: periodLabel(run.year, run.month),
      line: toPublicLine(line),
    })
  }),
)

router.get(
  '/payslips/:runId/pdf',
  selfService,
  asyncHandler(async (req, res) => {
    const employee = await resolveOwnEmployee(req)
    const run = await loadRunOr404(req.params.runId)

    if (run.status !== 'finalized') throw notFound('Payslip not found.')
    const line = await PayrollLineModel.findOne({ runId: run._id, employeeId: employee._id })
    if (!line) throw notFound('Payslip not found.')

    const { name, timezone } = await getCompanySettings()
    const pdf = payslipPdf({
      companyName: name,
      period: periodLabel(run.year, run.month),
      range: `${periodRange(run.year, run.month).from} to ${periodRange(run.year, run.month).to}`,
      line,
      status: run.status,
      generatedOn: zonedDateKey(new Date(), timezone),
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${run.periodKey}.pdf"`)
    res.send(pdf)
  }),
)

/** HR and admin can download any employee's payslip, including a draft preview. */
router.get(
  '/runs/:id/payslips/:employeeId/pdf',
  company,
  asyncHandler(async (req, res) => {
    const run = await loadRunOr404(req.params.id)
    const { employeeId } = req.params
    if (!mongoose.isValidObjectId(employeeId)) throw notFound('Payslip not found.')

    const line = await PayrollLineModel.findOne({ runId: run._id, employeeId })
    if (!line) throw notFound('Payslip not found.')

    const { name, timezone } = await getCompanySettings()
    const range = periodRange(run.year, run.month)
    const pdf = payslipPdf({
      companyName: name,
      period: periodLabel(run.year, run.month),
      range: `${range.from} to ${range.to}`,
      line,
      status: run.status,
      generatedOn: zonedDateKey(new Date(), timezone),
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payslip-${run.periodKey}-${line.employeeCode}.pdf"`,
    )
    res.send(pdf)
  }),
)

export default router