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
