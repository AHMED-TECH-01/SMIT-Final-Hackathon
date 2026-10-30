import type { Response } from 'express'

/** Consistent success envelope: { success: true, data, meta? } */
export function ok<T>(res: Response, data: T, status = 200, meta?: Record<string, unknown>) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) })
}
