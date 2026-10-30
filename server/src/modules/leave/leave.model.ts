import { Schema, model, type Document, type Types } from 'mongoose'

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]

/** Statuses that consume a leave balance. */
export const BALANCE_CONSUMING: readonly LeaveStatus[] = ['approved']
/** Statuses that block a second overlapping request. */
export const BLOCKING_STATUSES: readonly LeaveStatus[] = ['pending', 'approved']

export interface LeaveRequestDoc extends Document<Types.ObjectId> {
  employeeId: Types.ObjectId
  leaveTypeId: Types.ObjectId
  /** First and last calendar day, both stored at UTC midnight. */
  startDate: Date
  endDate: Date
  /** Deducted working days; a half day is 0.5. */
  days: number
  halfDay: boolean
  reason: string
  status: LeaveStatus
  decidedBy?: Types.ObjectId
  decisionNote?: string
  decidedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const leaveRequestSchema = new Schema<LeaveRequestDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 0.5 },
    halfDay: { type: Boolean, default: false },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: LEAVE_STATUSES, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionNote: { type: String, trim: true, maxlength: 500 },
    decidedAt: { type: Date },
  },
  { timestamps: true },
)

// Approval queues read newest-first; balances scan one employee's year.
leaveRequestSchema.index({ status: 1, createdAt: -1 })
leaveRequestSchema.index({ employeeId: 1, startDate: -1 })

export const LeaveRequestModel = model<LeaveRequestDoc>('LeaveRequest', leaveRequestSchema)

/** Handles both raw ObjectIds and populated documents. */
function refId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && '_id' in (value as object)) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

function refField(value: unknown, field: string): string | null {
  if (value && typeof value === 'object' && field in (value as object)) {
    return (value as Record<string, string>)[field] ?? null
  }
  return null
}

export function toPublicLeaveRequest(doc: LeaveRequestDoc) {
  return {
    id: String(doc._id),
    employeeId: refId(doc.employeeId),
    employeeName: refField(doc.employeeId, 'fullName'),
    employeeCode: refField(doc.employeeId, 'employeeCode'),
    leaveTypeId: refId(doc.leaveTypeId),
    leaveTypeName: refField(doc.leaveTypeId, 'name'),
    startDate: doc.startDate,
    endDate: doc.endDate,
    days: doc.days,
    halfDay: doc.halfDay,
    reason: doc.reason,
    status: doc.status,
    decisionNote: doc.decisionNote ?? null,
    decidedAt: doc.decidedAt ?? null,
    createdAt: doc.createdAt,
  }
}