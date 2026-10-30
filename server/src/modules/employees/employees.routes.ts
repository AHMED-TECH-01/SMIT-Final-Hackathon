import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { notFound, unprocessable } from '../../lib/http-error.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { parsePage, pageMeta } from '../../lib/pagination.js'
import { parseCsv, toCsv } from '../../lib/csv.js'
import { recordAudit } from '../../lib/audit.js'
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  EmployeeModel,
  toPublicEmployee,
} from './employee.model.js'
import { DepartmentModel } from '../organization/department.model.js'
import { DesignationModel } from '../organization/designation.model.js'
import { UserModel } from '../auth/user.model.js'

const router = Router()

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier.')
/** Treats "" as "not provided" so HTML forms can submit blank optional fields. */
const blankToUndefined = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema)

const optionalEmail = blankToUndefined(
  z.string().trim().email('Enter a valid email address.').max(160).optional(),
)

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  departmentId: blankToUndefined(objectId.optional()),
  designationId: blankToUndefined(objectId.optional()),
  status: blankToUndefined(z.enum(EMPLOYEE_STATUSES).optional()),
  employmentType: blankToUndefined(z.enum(EMPLOYMENT_TYPES).optional()),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const employeeBody = z.object({
  employeeCode: blankToUndefined(z.string().trim().min(2).max(20).optional()),
  fullName: z.string().trim().min(2, 'Enter the employee name.').max(120),
  email: optionalEmail,
  phone: z.string().trim().max(30).optional(),
  departmentId: blankToUndefined(objectId.optional()),
  designationId: blankToUndefined(objectId.optional()),
  managerId: blankToUndefined(objectId.optional()),
  userId: blankToUndefined(objectId.optional()),
  joinDate: z.coerce.date(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  dateOfBirth: blankToUndefined(z.coerce.date().optional()),
  address: z.string().trim().max(300).optional(),
  emergencyContact: z.string().trim().max(120).optional(),
})

const updateBody = employeeBody.partial()
const statusBody = z.object({ status: z.enum(EMPLOYEE_STATUSES) })

const POPULATE = [
  { path: 'departmentId', select: 'name' },
  { path: 'designationId', select: 'title' },
]

/** Sequential, human-readable employee code: EMP-0001, EMP-0002, ... */
async function nextEmployeeCode(): Promise<string> {
  const last = await EmployeeModel.findOne({ employeeCode: /^EMP-\d+$/ })
    .sort({ employeeCode: -1 })
    .select('employeeCode')

  const current = last ? Number.parseInt(last.employeeCode.slice(4), 10) : 0
  return `EMP-${String(current + 1).padStart(4, '0')}`
}

/** Rejects references to records that do not exist, with a field-level message. */
async function assertReferences(input: {
  departmentId?: unknown
  designationId?: unknown
  managerId?: unknown
  userId?: unknown
}): Promise<void> {
  if (input.departmentId) {
    const exists = await DepartmentModel.exists({ _id: String(input.departmentId) })
    if (!exists) throw unprocessable('The selected department does not exist.')
  }
  if (input.designationId) {
    const exists = await DesignationModel.exists({ _id: String(input.designationId) })
    if (!exists) throw unprocessable('The selected designation does not exist.')
  }
  if (input.managerId) {
    const exists = await EmployeeModel.exists({ _id: String(input.managerId) })
    if (!exists) throw unprocessable('The selected manager does not exist.')
  }
  if (input.userId) {
    const exists = await UserModel.exists({ _id: String(input.userId) })
    if (!exists) throw unprocessable('The selected user account does not exist.')
  }
}

router.get(
  '/',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuery>
    const page = parsePage(req.query as Record<string, unknown>)

    const filter: Record<string, unknown> = {}
    if (query.q) {
      const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      filter.$or = [{ fullName: rx }, { employeeCode: rx }, { email: rx }]
    }
    if (query.departmentId) filter.departmentId = query.departmentId
    if (query.designationId) filter.designationId = query.designationId
    if (query.status) filter.status = query.status
    if (query.employmentType) filter.employmentType = query.employmentType

    const [total, docs] = await Promise.all([
      EmployeeModel.countDocuments(filter),
      EmployeeModel.find(filter)
        .populate(POPULATE)
        .sort({ fullName: 1 })
        .skip(page.skip)
        .limit(page.limit),
    ])

    ok(res, docs.map(toPublicEmployee), 200, pageMeta(total, page))
  }),
)

router.get(
  '/:id([0-9a-fA-F]{24})',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.read'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Employee not found.')

    const employee = await EmployeeModel.findById(id)
      .populate(POPULATE)
      .populate({ path: 'managerId', select: 'fullName employeeCode' })

    if (!employee) throw notFound('Employee not found.')

    const directReports = await EmployeeModel.countDocuments({ managerId: id })

    ok(res, {
      employee: toPublicEmployee(employee),
      manager: employee.managerId
        ? {
            id: String((employee.managerId as unknown as { _id: unknown })._id),
            fullName: (employee.managerId as unknown as { fullName: string }).fullName,
            employeeCode: (employee.managerId as unknown as { employeeCode: string }).employeeCode,
          }
        : null,
      directReports,
    })
  }),
)

router.post(
  '/',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.create'),
  validate({ body: employeeBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof employeeBody>
    await assertReferences(body)

    const employee = await EmployeeModel.create({
      ...body,
      employeeCode: body.employeeCode?.toUpperCase() ?? (await nextEmployeeCode()),
    })
    await employee.populate(POPULATE)

    await recordAudit(req, {
      action: 'create',
      entity: 'employee',
      entityId: String(employee._id),
      meta: { employeeCode: employee.employeeCode },
    })

    ok(res, toPublicEmployee(employee), 201)
  }),
)
router.patch(
  '/:id',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.update'),
  validate({ body: updateBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Employee not found.')

    const body = req.body as z.infer<typeof updateBody>
    await assertReferences(body)

    if (body.managerId && body.managerId === id) {
      throw unprocessable('An employee cannot be their own manager.')
    }

    const employee = await EmployeeModel.findByIdAndUpdate(
      id,
      { $set: body },
      { new: true, runValidators: true },
    )
      .populate(POPULATE)

    if (!employee) throw notFound('Employee not found.')

    await recordAudit(req, { action: 'update', entity: 'employee', entityId: id })
    ok(res, toPublicEmployee(employee))
  }),
)

router.patch(
  '/:id/status',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.update'),
  validate({ body: statusBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Employee not found.')

    const { status } = req.body as z.infer<typeof statusBody>
    const employee = await EmployeeModel.findByIdAndUpdate(id, { $set: { status } }, { new: true })
      .populate(POPULATE)
    if (!employee) throw notFound('Employee not found.')

    await recordAudit(req, {
      action: 'status_change',
      entity: 'employee',
      entityId: id,
      meta: { status },
    })
    ok(res, toPublicEmployee(employee))
  }),
)

/** Archiving is a soft delete: the record survives for payroll and audit history. */
router.post(
  '/:id/archive',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.archive'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) throw notFound('Employee not found.')

    const employee = await EmployeeModel.findByIdAndUpdate(
      id,
      { $set: { status: 'terminated' } },
      { new: true },
    ).populate(POPULATE)
    if (!employee) throw notFound('Employee not found.')

    await recordAudit(req, { action: 'archive', entity: 'employee', entityId: id })
    ok(res, toPublicEmployee(employee))
  }),
)

const importBody = z.object({
  csv: z.string().min(1, 'Paste or upload a CSV first.').max(500_000),
  commit: z.boolean().optional(),
})

/** Column names are matched case-insensitively so spreadsheet exports just work. */
const IMPORT_ALIASES = {
  fullName: ['fullname', 'name', 'employee', 'employeename'],
  employeeCode: ['employeecode', 'code'],
  email: ['email', 'workemail'],
  phone: ['phone', 'mobile'],
  department: ['department', 'dept'],
  designation: ['designation', 'title', 'jobtitle'],
  joinDate: ['joindate', 'dateofjoining', 'joiningdate'],
  employmentType: ['employmenttype', 'type'],
  status: ['status'],
} as const

function pick(row: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== '') return value
  }
  return ''
}

router.post(
  '/import',
  requireAuth,
  requirePasswordChanged,
  requirePermission('employee.create'),
  validate({ body: importBody }),
  asyncHandler(async (req, res) => {
    const { csv, commit } = req.body as z.infer<typeof importBody>
    const parsed = parseCsv(csv)
    const headers = parsed.headers.map((h) => h.toLowerCase())
    const rows = parsed.rows.map((row) => {
      const normalized: Record<string, string> = {}
      Object.entries(row).forEach(([key, value]) => {
        normalized[key.toLowerCase()] = value
      })
      return normalized
    })

    if (!rows.length) throw unprocessable('The CSV contains no data rows.')

    const [departments, designations] = await Promise.all([
      DepartmentModel.find().select('name'),
      DesignationModel.find().select('title'),
    ])
    const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), String(d._id)]))
    const designationByTitle = new Map(
      designations.map((d) => [d.title.toLowerCase(), String(d._id)]),
    )

    const errors: { row: number; message: string }[] = []
    const valid: Record<string, unknown>[] = []
    const seenEmails = new Set<string>()

    rows.forEach((row, index) => {
      const rowNumber = index + 2 // header occupies row 1

      const fullName = pick(row, IMPORT_ALIASES.fullName)
      if (!fullName) {
        errors.push({ row: rowNumber, message: 'Name is required.' })
        return
      }

      const joinDateRaw = pick(row, IMPORT_ALIASES.joinDate)
      const joinDate = joinDateRaw ? new Date(joinDateRaw) : null
      if (!joinDate || Number.isNaN(joinDate.getTime())) {
        errors.push({ row: rowNumber, message: 'Join date must be a valid date (YYYY-MM-DD).' })
        return
      }

      const email = pick(row, IMPORT_ALIASES.email).toLowerCase()
      if (email && seenEmails.has(email)) {
        errors.push({ row: rowNumber, message: `Duplicate email in file: ${email}` })
        return
      }

      const departmentName = pick(row, IMPORT_ALIASES.department)
      const designationTitle = pick(row, IMPORT_ALIASES.designation)

      if (departmentName && !departmentByName.has(departmentName.toLowerCase())) {
        errors.push({ row: rowNumber, message: `Unknown department: ${departmentName}` })
        return
      }
      if (designationTitle && !designationByTitle.has(designationTitle.toLowerCase())) {
        errors.push({ row: rowNumber, message: `Unknown designation: ${designationTitle}` })
        return
      }

      if (email) seenEmails.add(email)

      const employmentType = pick(row, IMPORT_ALIASES.employmentType).toLowerCase()
      const status = pick(row, IMPORT_ALIASES.status).toLowerCase()

      valid.push({
        employeeCode: pick(row, IMPORT_ALIASES.employeeCode).toUpperCase() || undefined,
        fullName,
        email: email || undefined,
        phone: pick(row, IMPORT_ALIASES.phone) || undefined,
        departmentId: departmentName ? departmentByName.get(departmentName.toLowerCase()) : undefined,
        designationId: designationTitle
          ? designationByTitle.get(designationTitle.toLowerCase())
          : undefined,
        joinDate,
        employmentType: (EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)
          ? employmentType
          : 'full-time',
        status: (EMPLOYEE_STATUSES as readonly string[]).includes(status) ? status : 'active',
      })
    })

    // Dry run returns a preview and never writes.
    if (!commit) {
      ok(res, {
        dryRun: true,
        totalRows: rows.length,
        validRows: valid.length,
        invalidRows: errors.length,
        imported: 0,
        columns: headers,
        preview: valid.slice(0, 10),
        errors: errors.slice(0, 50),
      })
      return
    }

    let imported = 0
    for (const record of valid) {
      try {
        const code = (record.employeeCode as string | undefined) ?? (await nextEmployeeCode())
        await EmployeeModel.create({ ...record, employeeCode: code })
        imported += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not import this row.'
        errors.push({ row: 0, message })
      }
    }

    await recordAudit(req, {
      action: 'import',
      entity: 'employee',
      meta: { imported, rejected: errors.length },
    })

    ok(res, {
      dryRun: false,
      totalRows: rows.length,
      validRows: valid.length,
      invalidRows: errors.length,
      imported,
      errors: errors.slice(0, 50),
    })
  }),
)

router.get(
  '/export',
  requireAuth,
  requirePasswordChanged,
  requirePermission('report.export'),
  asyncHandler(async (_req, res) => {
    const employees = await EmployeeModel.find()
      .populate(POPULATE)
      .sort({ fullName: 1 })
      .limit(5000)

    const csv = toCsv(
      [
        'employeeCode',
        'fullName',
        'email',
        'phone',
        'department',
        'designation',
        'joinDate',
        'employmentType',
        'status',
      ],
      employees.map((employee) => {
        const pub = toPublicEmployee(employee)
        return [
          pub.employeeCode,
          pub.fullName,
          pub.email,
          pub.phone,
          pub.departmentName,
          pub.designationTitle,
          new Date(pub.joinDate).toISOString().slice(0, 10),
          pub.employmentType,
          pub.status,
        ]
      }),
    )

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"')
    res.send(csv)
  }),
)

export default router
