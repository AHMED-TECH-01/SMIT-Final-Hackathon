import type { Request } from 'express'
import { AuditLogModel } from '../modules/audit/audit.model.js'
import { logger } from './logger.js'

export interface AuditInput {
  action: string
  entity: string
  entityId?: string
  meta?: Record<string, unknown>
}

/**
 * Writes an audit entry for a privileged action.
 *
 * Never throws: a logging failure must not turn a successful business
 * operation into a 500. Failures are logged with the full context instead.
 */
export async function recordAudit(req: Request, input: AuditInput): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      meta: input.meta,
      ip: req.ip,
    })
  } catch (err) {
    logger.error({ err, ...input }, 'Failed to write audit log')
  }
}