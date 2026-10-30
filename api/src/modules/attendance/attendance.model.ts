import { Schema, model, type Document, type Types } from 'mongoose'

export const ATTENDANCE_STATUSES = [
  'present',
  'late',
  'absent',
  'half-day',
  'remote',
  'leave',
  'holiday',
] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const ATTENDANCE_SOURCES = ['web', 'manual', 'correction', 'system'] as const
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]

export interface AttendanceDoc extends Document<Types.ObjectId> {
  employeeId: Types.ObjectId
  /** Calendar day at UTC midnight — one row per employee per business day. */
  date: Date
  status: AttendanceStatus
  checkInAt?: Date
  checkOutAt?: Date
  minutesLate: number
  minutesWorked: number
  source: AttendanceSource
  note?: string
  createdAt: Date
  updatedAt: Date
}

const attendanceSchema = new Schema<AttendanceDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    date: { type: Date, required: true, index: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    checkInAt: { type: Date },
    checkOutAt: { type: Date },
    minutesLate: { type: Number, default: 0, min: 0 },
    minutesWorked: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: ATTENDANCE_SOURCES, default: 'web' },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
)

// One attendance row per employee per day: the anchor for every upsert.
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true })
attendanceSchema.index({ date: 1, status: 1 })

export const AttendanceModel = model<AttendanceDoc>('Attendance', attendanceSchema)

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

export function toPublicAttendance(doc: AttendanceDoc) {
  return {
    id: String(doc._id),
    employeeId: refId(doc.employeeId),
    employeeName: refField(doc.employeeId, 'fullName'),
    employeeCode: refField(doc.employeeId, 'employeeCode'),
    date: doc.date,
    status: doc.status,
    checkInAt: doc.checkInAt ?? null,
    checkOutAt: doc.checkOutAt ?? null,
    minutesLate: doc.minutesLate,
    minutesWorked: doc.minutesWorked,
    source: doc.source,
    note: doc.note ?? null,
  }
}

export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number]

export interface AttendanceCorrectionDoc extends Document<Types.ObjectId> {
  employeeId: Types.ObjectId
  date: Date
  requestedStatus: AttendanceStatus
  requestedCheckInAt?: Date
  requestedCheckOutAt?: Date
  reason: string
  status: CorrectionStatus
  decidedBy?: Types.ObjectId
  decisionNote?: string
  decidedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const correctionSchema = new Schema<AttendanceCorrectionDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    date: { type: Date, required: true, index: true },
    requestedStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    requestedCheckInAt: { type: Date },
    requestedCheckOutAt: { type: Date },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: CORRECTION_STATUSES, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionNote: { type: String, trim: true, maxlength: 500 },
    decidedAt: { type: Date },
  },
  { timestamps: true },
)

correctionSchema.index({ status: 1, createdAt: -1 })

export const AttendanceCorrectionModel = model<AttendanceCorrectionDoc>(
  'AttendanceCorrection',
  correctionSchema,
)

export function toPublicCorrection(doc: AttendanceCorrectionDoc) {
  return {
    id: String(doc._id),
    employeeId: refId(doc.employeeId),
    employeeName: refField(doc.employeeId, 'fullName'),
    employeeCode: refField(doc.employeeId, 'employeeCode'),
    date: doc.date,
    requestedStatus: doc.requestedStatus,
    requestedCheckInAt: doc.requestedCheckInAt ?? null,
    requestedCheckOutAt: doc.requestedCheckOutAt ?? null,
    reason: doc.reason,
    status: doc.status,
    decisionNote: doc.decisionNote ?? null,
    decidedAt: doc.decidedAt ?? null,
    createdAt: doc.createdAt,
  }
}