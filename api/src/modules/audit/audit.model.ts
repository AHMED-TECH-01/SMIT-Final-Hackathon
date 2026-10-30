import { Schema, model, type Document, type Types } from 'mongoose'

export interface AuditLogDoc extends Document<Types.ObjectId> {
  actorId?: Types.ObjectId
  actorEmail?: string
  action: string
  entity: string
  entityId?: string
  meta?: Record<string, unknown>
  ip?: string
  createdAt: Date
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: { type: String, trim: true },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: String },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// Audit entries are read newest-first almost exclusively.
auditLogSchema.index({ createdAt: -1 })

export const AuditLogModel = model<AuditLogDoc>('AuditLog', auditLogSchema)

export function toPublicAudit(entry: AuditLogDoc) {
  return {
    id: String(entry._id),
    actorId: entry.actorId ? String(entry.actorId) : null,
    actorEmail: entry.actorEmail ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    meta: entry.meta ?? null,
    ip: entry.ip ?? null,
    createdAt: entry.createdAt,
  }
}