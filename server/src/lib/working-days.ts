import { dateKeyRange, dateKeyToUtcMidnight, isWeekend } from './dates.js'
import { HolidayModel } from '../modules/organization/holiday.model.js'

/**
 * Days that never count as work: weekends plus every declared company holiday.
 * Expressed as 'YYYY-MM-DD' keys so callers can subtract keys from a range.
 */
export async function nonWorkingKeys(
  from: string,
  to: string,
  timeZone: string,
): Promise<Set<string>> {
  const holidays = await HolidayModel.find({
    date: { $gte: dateKeyToUtcMidnight(from), $lte: dateKeyToUtcMidnight(to) },
  }).select('date')

  const keys = new Set(holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)))

  for (const key of dateKeyRange(from, to)) {
    if (isWeekend(key, timeZone)) keys.add(key)
  }

  return keys
}

/** The working days inside an inclusive range. */
export async function workingDayKeys(
  from: string,
  to: string,
  timeZone: string,
): Promise<string[]> {
  const nonWorking = await nonWorkingKeys(from, to, timeZone)
  return dateKeyRange(from, to).filter((key) => !nonWorking.has(key))
}