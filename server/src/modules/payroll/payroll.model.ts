import { Schema, model, type Document, type Types } from 'mongoose'

export const PAYROLL_STATUSES = ['draft', 'finalized'] as const
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number]

/* ------------------------------------------------------------------ */
/* Salary structure                                                    */
/* ------------------------------------------------------------------ */

export interface SalaryComponent {
  label: string
  amount: number
}

export interface SalaryStructureDoc extends Document<Types.ObjectId> {
  employeeId: Types.ObjectId
  currency: string
  baseSalary: number
  allowances: SalaryComponent[]
  deductions: SalaryComponent[]
  /** Applied to gross pay as a percentage. */
  taxPercent: number
  effectiveFrom: Date
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const componentSchema = new Schema<SalaryComponent>(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const salaryStructureSchema = new Schema<SalaryStructureDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 8 },
    baseSalary: { type: Number, required: true, min: 0 },
    allowances: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    effectiveFrom: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const SalaryStructureModel = model<SalaryStructureDoc>(
  'SalaryStructure',
  salaryStructureSchema,
)

export function toPublicStructure(doc: SalaryStructureDoc) {
  const employee = doc.employeeId as unknown
  const populated = employee && typeof employee === 'object' && 'fullName' in (employee as object)

  return {
    id: String(doc._id),
    employeeId: populated ? String((employee as { _id: unknown })._id) : String(doc.employeeId),
    employeeName: populated ? (employee as { fullName: string }).fullName : null,
    employeeCode: populated ? ((employee as { employeeCode?: string }).employeeCode ?? null) : null,
    currency: doc.currency,
    baseSalary: doc.baseSalary,
    allowances: doc.allowances.map((entry) => ({ label: entry.label, amount: entry.amount })),
    deductions: doc.deductions.map((entry) => ({ label: entry.label, amount: entry.amount })),
    taxPercent: doc.taxPercent,
    grossSalary:
      doc.baseSalary + doc.allowances.reduce((total, entry) => total + entry.amount, 0),
    effectiveFrom: doc.effectiveFrom,
    isActive: doc.isActive,
  }
}

/* ------------------------------------------------------------------ */
/* Payroll run                                                         */
/* ------------------------------------------------------------------ */

export interface PayrollTotals {
  headcount: number
  gross: number
  deductions: number
  tax: number
  net: number
}

export interface PayrollRunDoc extends Document<Types.ObjectId> {
  /** 'YYYY-MM' — unique, so a period can only ever be drafted once. */
  periodKey: string
  year: number
  month: number
  status: PayrollStatus
  workingDays: number
  totals: PayrollTotals
  createdBy?: Types.ObjectId
  finalizedBy?: Types.ObjectId
  finalizedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const totalsSchema = new Schema<PayrollTotals>(
  {
    headcount: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
  },
  { _id: false },
)

const payrollRunSchema = new Schema<PayrollRunDoc>(
  {
    periodKey: { type: String, required: true, unique: true, maxlength: 7 },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    status: { type: String, enum: PAYROLL_STATUSES, default: 'draft', index: true },
    workingDays: { type: Number, default: 0 },
    totals: { type: totalsSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    finalizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    finalizedAt: { type: Date },
  },
  { timestamps: true },
)

payrollRunSchema.index({ year: -1, month: -1 })

export const PayrollRunModel = model<PayrollRunDoc>('PayrollRun', payrollRunSchema)

export function toPublicRun(doc: PayrollRunDoc) {
  return {
    id: String(doc._id),
    periodKey: doc.periodKey,
    year: doc.year,
    month: doc.month,
    status: doc.status,
    workingDays: doc.workingDays,
    totals: doc.totals,
    finalizedAt: doc.finalizedAt ?? null,
    createdAt: doc.createdAt,
  }
}

/* ------------------------------------------------------------------ */
/* Payslip line                                                        */
/* ------------------------------------------------------------------ */

export interface PayrollLineDoc extends Document<Types.ObjectId> {
  runId: Types.ObjectId
  employeeId: Types.ObjectId
  employeeCode: string
  fullName: string
  departmentName?: string
  currency: string
  baseSalary: number
  allowances: SalaryComponent[]
  deductions: SalaryComponent[]
  gross: number
  tax: number
  unpaidDeduction: number
  totalDeductions: number
  net: number
  workingDays: number
  presentDays: number
  lateDays: number
  absentDays: number
  leaveDays: number
  createdAt: Date
  updatedAt: Date
}

const payrollLineSchema = new Schema<PayrollLineDoc>(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeCode: { type: String, required: true },
    fullName: { type: String, required: true },
    departmentName: { type: String, default: null },
    currency: { type: String, default: 'PKR' },
    baseSalary: { type: Number, required: true },
    allowances: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },
    gross: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    unpaidDeduction: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    lateDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
  },
  { timestamps: true },
)

// One payslip per employee per run.
payrollLineSchema.index({ runId: 1, employeeId: 1 }, { unique: true })
payrollLineSchema.index({ employeeId: 1, runId: -1 })

export const PayrollLineModel = model<PayrollLineDoc>('PayrollLine', payrollLineSchema)

export function toPublicLine(doc: PayrollLineDoc) {
  return {
    id: String(doc._id),
    runId: String(doc.runId),
    employeeId: String(doc.employeeId),
    employeeCode: doc.employeeCode,
    fullName: doc.fullName,
    departmentName: doc.departmentName ?? null,
    currency: doc.currency,
    baseSalary: doc.baseSalary,
    allowances: doc.allowances.map((entry) => ({ label: entry.label, amount: entry.amount })),
    deductions: doc.deductions.map((entry) => ({ label: entry.label, amount: entry.amount })),
    gross: doc.gross,
    tax: doc.tax,
    unpaidDeduction: doc.unpaidDeduction,
    totalDeductions: doc.totalDeductions,
    net: doc.net,
    workingDays: doc.workingDays,
    presentDays: doc.presentDays,
    lateDays: doc.lateDays,
    absentDays: doc.absentDays,
    leaveDays: doc.leaveDays,
  }
}