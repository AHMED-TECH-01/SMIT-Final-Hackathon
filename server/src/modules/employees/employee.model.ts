import { Schema, model, type Document, type Types } from 'mongoose'

export const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'intern'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const EMPLOYEE_STATUSES = ['active', 'probation', 'resigned', 'terminated'] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export interface EmployeeDoc extends Document<Types.ObjectId> {
  employeeCode: string
  fullName: string
  email?: string
  phone?: string
  departmentId?: Types.ObjectId
  designationId?: Types.ObjectId
  managerId?: Types.ObjectId
  userId?: Types.ObjectId
  joinDate: Date
  employmentType: EmploymentType
  status: EmployeeStatus
  dateOfBirth?: Date
  address?: string
  emergencyContact?: string
  createdAt: Date
  updatedAt: Date
}

const employeeSchema = new Schema<EmployeeDoc>(
  {
    employeeCode: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 20 },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    // Sparse so employees without a work email can still be created.
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 30 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    designationId: { type: Schema.Types.ObjectId, ref: 'Designation', index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    joinDate: { type: Date, required: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full-time' },
    status: { type: String, enum: EMPLOYEE_STATUSES, default: 'active', index: true },
    dateOfBirth: { type: Date },
    address: { type: String, trim: true, maxlength: 300 },
    emergencyContact: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true },
)

// Directory default ordering and the common "active employees" filter.
employeeSchema.index({ fullName: 1 })
employeeSchema.index({ status: 1, departmentId: 1 })
// A login belongs to at most one employee record; sparse keeps unlinked rows out of the index.
employeeSchema.index({ userId: 1 }, { unique: true, sparse: true })

export const EmployeeModel = model<EmployeeDoc>('Employee', employeeSchema)

/** Handles both raw ObjectIds and populated documents. */
function refId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && '_id' in (value as object)) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

function refField(value: unknown, field: 'name' | 'title'): string | null {
  if (value && typeof value === 'object' && field in (value as object)) {
    return (value as Record<string, string>)[field] ?? null
  }
  return null
}

export function toPublicEmployee(doc: EmployeeDoc) {
  return {
    id: String(doc._id),
    employeeCode: doc.employeeCode,
    fullName: doc.fullName,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    departmentId: refId(doc.departmentId),
    departmentName: refField(doc.departmentId, 'name'),
    designationId: refId(doc.designationId),
    designationTitle: refField(doc.designationId, 'title'),
    managerId: refId(doc.managerId),
    userId: refId(doc.userId),
    joinDate: doc.joinDate,
    employmentType: doc.employmentType,
    status: doc.status,
    dateOfBirth: doc.dateOfBirth ?? null,
    address: doc.address ?? null,
    emergencyContact: doc.emergencyContact ?? null,
    createdAt: doc.createdAt,
  }
}