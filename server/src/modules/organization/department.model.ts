import { Schema, model, type Document, type Types } from 'mongoose'

export interface DepartmentDoc extends Document<Types.ObjectId> {
  name: string
  code?: string
  description?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const departmentSchema = new Schema<DepartmentDoc>(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 120 },
    code: { type: String, trim: true, uppercase: true, sparse: true, unique: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const DepartmentModel = model<DepartmentDoc>('Department', departmentSchema)

export function toPublicDepartment(doc: DepartmentDoc) {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    description: doc.description ?? null,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
  }
}