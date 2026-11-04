import { z } from 'zod'
import { CompanyModel, isSetupComplete } from '../organization/company.model.js'
import { invalidateCompanySettings } from '../organization/company.settings.js'
import { assertPasswordStrength, hashPassword, signSessionToken } from '../auth/session.js'
import { normalizeEmail, UserModel, type UserDoc } from '../auth/user.model.js'
import type { Role } from '../auth/permissions.js'
import { conflict, unprocessable } from '../../lib/http-error.js'
import { logger } from '../../lib/logger.js'

/**
 * Phone numbers are stored as typed. What is validated is the part that can
 * actually be checked without a carrier: an optional `+`, then 7-15 digits,
 * with spaces, brackets, dashes and dots allowed as separators.
 */
function isPhoneLike(value: string): boolean {
  return /^\+?\d{7,15}$/.test(value.replace(/[ ().\-]/g, ''))
}

const phoneField = (message: string) =>
  z
    .string()
    .trim()
    .max(40)
    .refine(isPhoneLike, message)

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const

export const setupSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is too short.').max(120),
  contactEmail: z.string().trim().email('Enter a valid company email.').max(160),
  contactPhone: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  industry: z.string().trim().max(80).optional().default(''),
  companySize: z.string().trim().max(40).optional().default(''),
  country: z.string().trim().max(80).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  timezone: z.string().trim().min(1).max(60).optional().default('Asia/Karachi'),
  admin: z.object({
    fullName: z.string().trim().min(2, 'Administrator name is too short.').max(120),
    email: z.string().trim().email('Enter a valid administrator email.').max(160),
    phone: z.string().trim().max(40).optional().default(''),
    password: z.string().min(1, 'Password is required.').max(200),
  }),
})

/**
 * The payload the public sign-up page sends. `z.input` rather than `z.infer`
 * because the optional fields carry defaults: a caller may legitimately omit
 * them, which is what `bootstrapAdminFromEnv` does.
 */
export type SetupInput = z.input<typeof setupSchema>

/**
 * Self-service company registration.
 *
 * Field names follow what the form renders, and the whole shape is translated
 * to `performSetup()` - the one code path that creates a company and its first
 * administrator. Nothing here can mint an extra administrator, and no role,
 * company id or status can be sent by the client: unknown keys are stripped by
 * this schema before the service ever sees them.
 */
export const registerSchema = z.object({
  admin: z
    .object({
      name: z.string().trim().min(2, 'Enter your full name.').max(120),
      email: z.string().trim().email('Enter a valid work email.').max(160),
      phone: phoneField('Enter a valid phone number, e.g. +92 300 1234567.'),
      password: z.string().min(1, 'Password is required.').max(200),
      confirmPassword: z.string().min(1, 'Confirm your password.').max(200),
    })
    .refine((admin) => admin.password === admin.confirmPassword, {
      message: 'Passwords do not match.',
      path: ['confirmPassword'],
    }),
  company: z.object({
    name: z.string().trim().min(2, 'Company name is too short.').max(120),
    industry: z.string().trim().min(2, 'Choose an industry.').max(80),
    companySize: z.enum(COMPANY_SIZES, {
      message: 'Choose how many people work here.',
    }),
    country: z.string().trim().min(2, 'Enter a country.').max(80),
    city: z.string().trim().min(1, 'Enter a city.').max(80),
    email: z.string().trim().email('Enter a valid company email.').max(160),
    phone: phoneField('Enter a valid company phone number.'),
  }),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service.' }),
  }),
  acceptedPrivacyPolicy: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Privacy Policy.' }),
  }),
})

export type RegisterInput = z.infer<typeof registerSchema>

export interface SetupResult {
  company: {
    id: string
    name: string
    timezone: string
    industry: string
    companySize: string
    country: string
    city: string
    email: string
    phone: string
  }
  user: UserDoc
  token: string
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

/**
 * Creates the company and the first administrator.
 *
 * Concurrency and atomicity:
 *  1. The `key: 'primary'` unique index means only one request can ever win.
 *  2. If administrator creation fails after the company row exists, the company
 *     is removed again so the operator can retry cleanly. This is the documented
 *     compensating strategy for deployments without transactions.
 */
export async function performSetup(input: SetupInput): Promise<SetupResult> {
  if (await isSetupComplete()) {
    throw conflict('This deployment has already been set up. Please sign in instead.')
  }

  const strengthProblem = assertPasswordStrength(input.admin.password)
  if (strengthProblem) throw unprocessable(strengthProblem)

  const adminEmail = normalizeEmail(input.admin.email)
  const passwordHash = await hashPassword(input.admin.password)

  let companyId: string
  let companyEmail: string
  try {
    const company = await CompanyModel.create({
      key: 'primary',
      name: input.companyName,
      contactEmail: normalizeEmail(input.contactEmail),
      contactPhone: input.contactPhone ?? '',
      address: input.address ?? '',
      industry: input.industry ?? '',
      companySize: input.companySize ?? '',
      country: input.country ?? '',
      city: input.city ?? '',
      timezone: input.timezone ?? 'Asia/Karachi',
      setupComplete: true,
    })
    companyId = String(company._id)
    companyEmail = String(company.contactEmail)
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw conflict('This deployment has already been set up. Please sign in instead.')
    }
    throw err
  }

  try {
    const user = await UserModel.create({
      email: adminEmail,
      fullName: input.admin.fullName,
      phone: input.admin.phone ?? '',
      passwordHash,
      role: 'admin' satisfies Role,
      status: 'active',
      mustChangePassword: false,
    })

    const token = signSessionToken({
      sub: String(user._id),
      role: 'admin',
      cv: user.tokenVersion,
    })

    // The settings cache may still hold the pre-registration defaults, which
    // would otherwise show the wrong company name and working hours for up to
    // 30 seconds after the first sign-up.
    invalidateCompanySettings()

    return {
      company: {
        id: companyId,
        name: input.companyName,
        timezone: input.timezone ?? 'Asia/Karachi',
        industry: input.industry ?? '',
        companySize: input.companySize ?? '',
        country: input.country ?? '',
        city: input.city ?? '',
        email: companyEmail,
        phone: input.contactPhone ?? '',
      },
      user,
      token,
    }
  } catch (err) {
    // Compensate: never leave a company row behind without its administrator.
    await CompanyModel.deleteOne({ _id: companyId })
    invalidateCompanySettings()
    throw err
  }
}

/**
 * Company registration through the public sign-up form.
 *
 * Translates the form's shape into the one creation path, `performSetup()`, and
 * adds nothing of its own: the role is fixed there, the company key is fixed
 * there, and a second registration is refused there with 409. `timezone` and
 * `currency` are not asked for on the form, so they stay at the deployment
 * default until they are edited in Settings — they are not guessed from the
 * chosen country.
 */
export async function registerCompany(input: RegisterInput): Promise<SetupResult> {
  return performSetup({
    companyName: input.company.name,
    contactEmail: input.company.email,
    contactPhone: input.company.phone,
    industry: input.company.industry,
    companySize: input.company.companySize,
    country: input.company.country,
    city: input.company.city,
    admin: {
      fullName: input.admin.name,
      email: input.admin.email,
      phone: input.admin.phone,
      password: input.admin.password,
    },
  })
}

export async function getSetupStatus(): Promise<{ setupRequired: boolean }> {
  return { setupRequired: !(await isSetupComplete()) }
}

/**
 * Optional bootstrap from environment variables, for automated deployments.
 * Runs at most once: if a company already exists this is a no-op, so an
 * existing administrator is never recreated or reset on restart.
 */
export async function bootstrapAdminFromEnv(): Promise<boolean> {
  if (await isSetupComplete()) return false

  const email = process.env.ADMIN_EMAIL?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return false

  const result = await performSetup({
    companyName: process.env.COMPANY_NAME?.trim() || 'HCM Lite Company',
    contactEmail: process.env.COMPANY_EMAIL?.trim() || email,
    contactPhone: '',
    address: '',
    timezone: 'Asia/Karachi',
    admin: { fullName: 'Administrator', email, password },
  })

  // Log the fact, never the credentials.
  logger.info(
    { adminEmail: result.user.email, company: result.company.name },
    'Bootstrapped initial administrator from environment',
  )
  return true
}
