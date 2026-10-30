import type { RequestHandler } from 'express'

/**
 * Express 4 does not forward rejected promises to the error handler, so every
 * async handler must be wrapped. Using one helper keeps that consistent.
 */
export function asyncHandler(
  fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
