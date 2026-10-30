import { Schema, model, type Document, type Types } from 'mongoose'

export interface HolidayDoc extends Document<Types.ObjectId> {
  name: string
  date: Date
  optional: boolean
  createdAt: Date
  updatedAt: Date
}

const holidaySchema = new Schema<HolidayDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: Date, required: true, index: true },
    optional: { type: Boolean, default: false },
  },
  { timestamps: true },
)

holidaySchema.index({ name: 1, date: 1 }, { unique: true })

export const HolidayModel = model<HolidayDoc>('Holiday', holidaySchema)

export function toPublicHoliday(doc: HolidayDoc) {
  return {
    id: String(doc._id),
    name: doc.name,
    date: doc.date,
    optional: doc.optional,
  }
}