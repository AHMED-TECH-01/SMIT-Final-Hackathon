/**
 * Time-zone aware date helpers.
 *
 * Business rules ("is this late?", "which day is this?") are always evaluated in
 * the company's time zone, while timestamps themselves stay in UTC.
 */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU builds render midnight as "24".
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  }
}

/** 'YYYY-MM-DD' as seen in the company time zone. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Minutes elapsed since local midnight — used for lateness and worked-hours. */
export function zonedMinutesOfDay(date: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(date, timeZone)
  return hour * 60 + minute
}

/**
 * Calendar days are stored as UTC midnight so a unique index on
 * (employeeId, date) identifies one business day unambiguously.
 */
export function dateKeyToUtcMidnight(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = dateKeyToUtcMidnight(key)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key
}

/** Expands an inclusive calendar range into the keys it covers. */
export function dateKeyRange(from: string, to: string): string[] {
  const keys: string[] = []
  const cursor = dateKeyToUtcMidnight(from)
  const end = dateKeyToUtcMidnight(to)
  while (cursor <= end && keys.length < 400) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

export function isWeekend(key: string, timeZone: string): boolean {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay()
  void timeZone
  return day === 0 || day === 6
}