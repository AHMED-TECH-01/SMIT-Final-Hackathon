import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { notFound } from '../../lib/http-error.js'
import { recordAudit } from '../../lib/audit.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { UserModel } from '../auth/user.model.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { DepartmentModel } from '../organization/department.model.js'
import { CompanyModel, type CompanyDoc } from '../organization/company.model.js'
import {
  getCompanySettings,
  invalidateCompanySettings,
  type CompanySettings,
} from '../organization/company.settings.js'

/**
 * Company settings.
 *
 * Two levels of access:
 *  • `/public` — name, time zone and currency. Branding, not secrets; every
 *    signed-in user needs it to render dates and money correctly.
 *  • everything else — `settings.manage`, which only the administrator holds.
 *
 * Changing the attendance policy here actually changes behaviour: check-in
 * reads the work start and grace period from these settings, so an administrator
 * who moves the day start to 10:00 immediately makes 09:30 a late arrival.
 */

const router = Router()

const WORKFORCE = ['active', 'probation']

const auth = [requireAuth, requirePasswordChanged]
const manage = [...auth, requirePermission('settings.manage')]

/** 'HH:MM' → minutes after midnight. The schema guarantees the format. */
function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

/** `Intl` is the authority on time zones: anything it rejects is not a zone. */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function companyPayload(company: CompanyDoc | null, settings: CompanySettings) {
  return {
    id: company ? String(company._id) : null,
    name: company?.name ?? settings.name,
    contactEmail: company?.contactEmail ?? '',
    contactPhone: company?.contactPhone ?? '',
    address: company?.address ?? '',
    timezone: settings.timezone,
    currency: settings.currency,
    updatedAt: company ? ((company as unknown as { updatedAt?: Date }).updatedAt ?? null) : null,
  }
}

/** One read model for both `GET /` and every successful update. */
async function settingsPayload() {
  const [company, settings, employees, activeEmployees, departments, users] = await Promise.all([
    CompanyModel.findOne({ key: 'primary' }),
    getCompanySettings(),
    EmployeeModel.countDocuments({}),
    EmployeeModel.countDocuments({ status: { $in: WORKFORCE } }),
    DepartmentModel.countDocuments({}),
    UserModel.countDocuments({}),
  ])

  return {
    company: companyPayload(company, settings),
    attendance: {
      workStart: minutesToTime(settings.workStartMinutes),
      workStartMinutes: settings.workStartMinutes,
      graceMinutes: settings.graceMinutes,
    },
    roster: { employees, activeEmployees, departments, users },
    system: { apiVersion: 'v1', setupComplete: Boolean(company) },
  }
}

/** Values the whole UI needs before it can render a date or an amount. */
router.get(
  '/public',
  auth,
  asyncHandler(async (_req, res) => {
    const { name, timezone, currency } = await getCompanySettings()
    ok(res, { name, timezone, currency })
  }),
)

router.use(manage)

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    ok(res, await settingsPayload())
  }),
)
/* ------------------------------------------------------------------ */
/* Company profile                                                     */
/* ------------------------------------------------------------------ */

const companyBody = z
  .object({
    name: z.string().trim().min(2, 'Company name is too short.').max(120).optional(),
    contactEmail: z.string().trim().email('Enter a valid company email.').max(160).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(300).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine(isValidTimeZone, 'Enter a valid IANA time zone, e.g. Asia/Karachi.')
      .optional(),
    currency: z
      .string()
      .trim()
      .max(3)
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{3}$/.test(value), 'Use a three-letter currency code, e.g. PKR.')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')

router.patch(
  '/company',
  validate({ body: companyBody }),
  asyncHandler(async (req, res) => {
    const patch = req.body as z.infer<typeof companyBody>

    const company = await CompanyModel.findOneAndUpdate(
      { key: 'primary' },
      { $set: patch },
      { new: true, runValidators: true },
    )
    if (!company) throw notFound('Company profile not found. Complete setup first.')

    // The cached copy is what every other request reads, so it must go now.
    invalidateCompanySettings()

    await recordAudit(req, {
      action: 'update',
      entity: 'settings',
      entityId: String(company._id),
      meta: { section: 'company', fields: Object.keys(patch) },
    })

    ok(res, await settingsPayload())
  }),
)
/* ------------------------------------------------------------------ */
/* Attendance policy                                                   */
/* ------------------------------------------------------------------ */

const attendanceBody = z
  .object({
    workStart: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the HH:MM format, e.g. 09:00.')
      .optional(),
    graceMinutes: z.coerce.number().int().min(0).max(240).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')

router.patch(
  '/attendance',
  validate({ body: attendanceBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof attendanceBody>

    const patch: Record<string, number> = {}
    if (body.workStart !== undefined) patch.workStartMinutes = timeToMinutes(body.workStart)
    if (body.graceMinutes !== undefined) patch.graceMinutes = body.graceMinutes

    const company = await CompanyModel.findOneAndUpdate(
      { key: 'primary' },
      { $set: patch },
      { new: true, runValidators: true },
    )
    if (!company) throw notFound('Company profile not found. Complete setup first.')

    invalidateCompanySettings()

    await recordAudit(req, {
      action: 'update',
      entity: 'settings',
      entityId: String(company._id),
      meta: { section: 'attendance', ...patch },
    })

    ok(res, await settingsPayload())
  }),
)

export default router
