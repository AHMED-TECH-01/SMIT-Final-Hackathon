import { CompanyModel } from './company.model.js'

export interface CompanySettings {
  name: string
  timezone: string
  currency: string
  /** Minutes after midnight that the working day starts. */
  workStartMinutes: number
  /** Minutes of lateness that still count as on time. */
  graceMinutes: number
}

const DEFAULT_SETTINGS: CompanySettings = {
  name: 'HCM Lite',
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  workStartMinutes: 540,
  graceMinutes: 15,
}

let cached: { value: CompanySettings; expiresAt: number } | null = null
const TTL_MS = 30_000

/**
 * Company settings rarely change but are needed on almost every request
 * (time zone for "today", lateness, holidays), so they are cached briefly.
 */
export async function getCompanySettings(): Promise<CompanySettings> {
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const company = await CompanyModel.findOne({ key: 'primary' }).select(
    'name timezone currency workStartMinutes graceMinutes',
  )
  const value: CompanySettings = company
    ? {
        name: company.name,
        timezone: company.timezone || DEFAULT_SETTINGS.timezone,
        currency: company.currency || DEFAULT_SETTINGS.currency,
        workStartMinutes:
          typeof company.workStartMinutes === 'number'
            ? company.workStartMinutes
            : DEFAULT_SETTINGS.workStartMinutes,
        graceMinutes:
          typeof company.graceMinutes === 'number'
            ? company.graceMinutes
            : DEFAULT_SETTINGS.graceMinutes,
      }
    : DEFAULT_SETTINGS

  cached = { value, expiresAt: Date.now() + TTL_MS }
  return value
}

/** Test hook: drops the cache so a new database is not served stale settings. */
export function invalidateCompanySettings(): void {
  cached = null
}