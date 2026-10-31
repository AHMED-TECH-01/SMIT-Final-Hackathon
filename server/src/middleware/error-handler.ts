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
 * `express.json` rejects a body it cannot accept before any route runs, and it
 * reports that through `err.type` rather than an `HttpError`. Left unhandled it
 * fell through to the generic 500, which told the caller nothing about a request
 * that was simply too big or not JSON at all — the visible case being a large
 * CSV handed to `/employees/import`, which posts the text inside a JSON body.
 * Both spellings of the encoding rejection are listed because body-parser
 * renames raw-body's `encoding.unsupported` to `charset.unsupported` when it
 * re-wraps it as a 400.
 */
function bodyParserRejection(err: unknown): { status: number; code: string; message: string } | null {
  if (typeof err !== 'object' || err === null || !('type' in err)) return null
  switch ((err as { type: unknown }).type) {
    case 'entity.too.large':
      return {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'That request is too large. Send a smaller body.',
      }
    case 'entity.parse.failed':
      return { status: 400, code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' }
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'That request encoding is not supported. Send UTF-8 JSON.',
      }
    default:
      return null
  }
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

  const rejection = bodyParserRejection(err)
  if (rejection) {
    // The caller sent something the body parser will not accept; this is a
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
