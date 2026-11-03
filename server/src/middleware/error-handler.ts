import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/http-error.js'
import { logger } from '../lib/logger.js'
import { isProd } from '../config/env.js'

/** Unknown routes get the same envelope as everything else. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist.`,
    },
  })
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyValue?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000
}

/**
 * What the caller hears when a request is rejected before it reaches a route.
 * The message is always ours: an upstream error text may name a driver, a
 * library or a platform runtime, and none of that belongs in a response.
 */
const REJECTION_BY_STATUS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large. Send a smaller body.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'That request encoding is not supported. Send UTF-8 JSON.' },
}

/** `express.json` reports its rejections through `err.type`, not through a status. */
const BODY_PARSER_TYPES: Record<string, number> = {
  'entity.too.large': 413,
  'entity.parse.failed': 400,
  // Both spellings of the encoding rejection are listed because body-parser
  // renames raw-body's `encoding.unsupported` to `charset.unsupported` when it
  // re-wraps it as a 400.
  'encoding.unsupported': 415,
  'charset.unsupported': 415,
}

/**
 * A request can also be rejected by an error that already declares its own 4xx:
 * on Vercel the function runtime decodes the JSON body itself and installs a
 * getter on `req.body` that throws `Invalid JSON` with `statusCode: 400`, so the
 * object reaching this handler has no body-parser `type` at all (measured in
 * production; the same request arrives as `entity.parse.failed` locally). Only
 * 4xx is honoured — a 5xx stays a server fault and keeps the generic answer —
 * and no code in the app throws a bare status-carrying object, so nothing here
 * can mask a deliberate `HttpError`, which is matched earlier.
 */
function declaredClientStatus(err: object): number | null {
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown }
  const value = typeof statusCode === 'number' ? statusCode : typeof status === 'number' ? status : null
  return value !== null && value >= 400 && value < 500 ? value : null
}

function transportRejection(err: unknown): { status: number; code: string; message: string } | null {
  if (typeof err !== 'object' || err === null) return null

  const type = (err as { type?: unknown }).type
  const status =
    (typeof type === 'string' ? BODY_PARSER_TYPES[type] : undefined) ?? declaredClientStatus(err)
  if (status === undefined || status === null) return null

  const known = REJECTION_BY_STATUS[status]
  return known
    ? { status, ...known }
    : { status, code: 'BAD_REQUEST', message: 'The request could not be processed.' }
}

/**
 * Central error handler.
 *
 * Guarantees: predictable shape, correct status code, and never a stack trace,
 * driver message, or secret in the response body.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return

  if (err instanceof HttpError) {
    res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please correct the submitted information.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    })
    return
  }

  if (isDuplicateKeyError(err)) {
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : undefined
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: field ? `That ${field} is already in use.` : 'That record already exists.',
        ...(field ? { details: [{ field, message: 'This value must be unique.' }] } : {}),
      },
    })
    return
  }

  const rejection = transportRejection(err)
  if (rejection) {
    // The caller sent something the transport will not accept; this is a
    // client error, so it is answered without logging it as a server fault.
    res.status(rejection.status).json({
      success: false,
      error: { code: rejection.code, message: rejection.message },
    })
    return
  }

  // Anything unexpected: log with context, return a generic message.
  logger.error(
    { err, method: req.method, path: req.path },
    'Unhandled error while processing request',
  )

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd
        ? 'Something went wrong. Please try again.'
        : 'Unexpected server error.',
    },
  })
}
