/** Presentation helpers. Dates arrive as ISO strings and are shown in local time. */

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime(value?: string | Date | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—'
  return `${formatDate(value)}, ${formatTime(value)}`
}

export function formatMoney(amount: number | null | undefined, currency = 'PKR'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`
}

export function formatMonth(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** 'half-day' → 'Half day' */
export function label(value: string): string {
  const spaced = value.replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Formats a 0–100 rate exactly as the API returns it: 85.6 → '85.6%'. */
export function percent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return `${rounded}%`
}

export function minutesLabel(minutes: number): string {
  if (!minutes) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Today as `YYYY-MM-DD` in the browser's zone — the format the API expects. */
export function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The UTC date portion of a calendar-day value coming back from the API. */
export function dateKey(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

export function shiftDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
