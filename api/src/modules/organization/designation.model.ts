import { Schema, model, type Document, type Types } from 'mongoose'

export interface DesignationDoc extends Document<Types.ObjectId> {
  title: string
  departmentId?: Types.ObjectId
  grade?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const designationSchema = new Schema<DesignationDoc>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    grade: { type: String, trim: true, maxlength: 20 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

// A title is unique within a department, not globally.
designationSchema.index({ title: 1, departmentId: 1 }, { unique: true })

export const DesignationModel = model<DesignationDoc>('Designation', designationSchema)

export function toPublicDesignation(doc: DesignationDoc) {
  const department = doc.departmentId as unknown
  return {
    id: String(doc._id),
    title: doc.title,
    departmentId: department && typeof department === 'object' && '_id' in (department as object)
      ? String((department as { _id: unknown })._id)
      : department
        ? String(department)
        : null,
    departmentName:
      department && typeof department === 'object' && 'name' in (department as object)
        ? (department as { name: string }).name
        : null,
    grade: doc.grade ?? null,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
  }
}