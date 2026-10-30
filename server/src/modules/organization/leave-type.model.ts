import { Schema, model, type Document, type Types } from 'mongoose'

export interface LeaveTypeDoc extends Document<Types.ObjectId> {
  name: string
  code: string
  annualQuota: number
  paid: boolean
  carryForward: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const leaveTypeSchema = new Schema<LeaveTypeDoc>(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 12 },
    annualQuota: { type: Number, required: true, min: 0, max: 366, default: 0 },
    paid: { type: Boolean, default: true },
    carryForward: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const LeaveTypeModel = model<LeaveTypeDoc>('LeaveType', leaveTypeSchema)

export function toPublicLeaveType(doc: LeaveTypeDoc) {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    annualQuota: doc.annualQuota,
    paid: doc.paid,
    carryForward: doc.carryForward,
    isActive: doc.isActive,
  }
}