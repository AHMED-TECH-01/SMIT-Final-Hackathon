import { z } from 'zod'
import { CompanyModel, isSetupComplete } from '../organization/company.model.js'
import { assertPasswordStrength, hashPassword, signSessionToken } from '../auth/session.js'
import { normalizeEmail, UserModel, type UserDoc } from '../auth/user.model.js'
import type { Role } from '../auth/permissions.js'
import { conflict, unprocessable } from '../../lib/http-error.js'
import { logger } from '../../lib/logger.js'

export const setupSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is too short.').max(120),
  contactEmail: z.string().trim().email('Enter a valid company email.').max(160),
  contactPhone: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  timezone: z.string().trim().min(1).max(60).optional().default('Asia/Karachi'),
  admin: z.object({
    fullName: z.string().trim().min(2, 'Administrator name is too short.').max(120),
    email: z.string().trim().email('Enter a valid administrator email.').max(160),
    password: z.string().min(1, 'Password is required.').max(200),
  }),
})

export type SetupInput = z.infer<typeof setupSchema>

export interface SetupResult {
  company: { id: string; name: string; timezone: string }
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
  try {
    const company = await CompanyModel.create({
      key: 'primary',
      name: input.companyName,
      contactEmail: normalizeEmail(input.contactEmail),
      contactPhone: input.contactPhone ?? '',
      address: input.address ?? '',
      timezone: input.timezone ?? 'Asia/Karachi',
      setupComplete: true,
    })
    companyId = String(company._id)
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

    return {
      company: { id: companyId, name: input.companyName, timezone: input.timezone ?? 'Asia/Karachi' },
      user,
      token,
    }
  } catch (err) {
    // Compensate: never leave a company row behind without its administrator.
    await CompanyModel.deleteOne({ _id: companyId })
    throw err
  }
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
