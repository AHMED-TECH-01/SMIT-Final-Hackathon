import type { RequestHandler } from 'express'
import type { ZodTypeAny } from 'zod'

interface Schemas {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/**
 * Parses and replaces request input with validated values.
 * Unknown keys are stripped by the schemas themselves, which blocks
 * mass-assignment of privileged fields.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body)
      // req.query is a getter in Express 5 but writable in Express 4; assigning
      // the parsed object keeps handlers reading validated values.
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
      next()
    } catch (err) {
      next(err)
    }
  }
}
