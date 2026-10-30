/**
 * The single door between the UI and the API.
 *
 * Every call goes through `request`, so three things are guaranteed in one
 * place instead of in twelve screens:
 *  1. the session cookie is always sent (`credentials: 'include'`),
 *  2. a failed request becomes an `ApiError` carrying the server's error code
 *     and field-level details,
 *  3. a 401 outside the auth endpoints clears the session.
 */

const BASE = '/api/v1'

export interface ApiMeta {
  total?: number
  limit?: number
  page?: number
  pages?: number
  unread?: number
  [key: string]: unknown
}

export interface ApiEnvelope<T> {
  success: true
  data: T
  meta?: ApiMeta
}

interface ApiErrorBody {
  success: false
  error: { code: string; message: string; details?: unknown }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Validation failures arrive as `[{ field, message }]`; index them by field. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {}
    const map: Record<string, string> = {}
    for (const entry of this.details) {
      if (entry && typeof entry === 'object' && 'field' in entry && 'message' in entry) {
        const { field, message } = entry as { field: string; message: string }
        if (!map[field]) map[field] = message
      }
    }
    return map
  }
}

let unauthorizedHandler: (() => void) | null = null

/** Registered by the session provider so an expired cookie signs the UI out. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

type QueryValue = string | number | boolean | undefined | null

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, QueryValue>
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return `${BASE}${path}${search ? `?${search}` : ''}`
}

const AUTH_PATHS = ['/auth/login', '/auth/me', '/auth/logout']

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is the API running?')
  }

  const raw = await response.text()
  let payload: ApiEnvelope<T> | ApiErrorBody | null = null
  try {
    payload = raw ? (JSON.parse(raw) as ApiEnvelope<T> | ApiErrorBody) : null
  } catch {
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'The server returned an unreadable reply.')
  }

  if (!response.ok || !payload || payload.success === false) {
    const error = payload && payload.success === false ? payload.error : null

    if (response.status === 401 && !AUTH_PATHS.includes(path)) {
      unauthorizedHandler?.()
    }

    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    )
  }

  return payload
}

/** Turns any thrown value into a message that is safe to show a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** Fetches a binary response (payslip PDF) and saves it through the browser. */
  async download(path: string, filename: string): Promise<void> {
    const response = await fetch(buildUrl(path), { credentials: 'include' })
    if (!response.ok) {
      throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'The file could not be downloaded.')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}
