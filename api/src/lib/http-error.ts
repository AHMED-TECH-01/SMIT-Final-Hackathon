/**
 * Single error type used across the API so the error handler can produce a
 * predictable body without leaking internals.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details)

export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'UNAUTHENTICATED', message)

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'FORBIDDEN', message)

export const notFound = (message = 'Resource not found.') =>
  new HttpError(404, 'NOT_FOUND', message)

export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message)

export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE', message, details)

export const tooManyRequests = (message = 'Too many requests. Please try again later.') =>
  new HttpError(429, 'RATE_LIMITED', message)
