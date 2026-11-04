import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * One company per deployment.
 *
 * `key` is a fixed constant guarded by a unique index. That index is what
 * makes first-run setup concurrency-safe: two simultaneous setup requests can
 * never both create a company — the second receives a duplicate-key error.
 *
 * The public sign-up page (`POST /auth/register`) is the front door to that one
 * company, not a way around it: once `key: 'primary'` exists, registration
 * answers 409 for everyone. This product is deliberately single-tenant — no
 * other model carries a `companyId`, so a second tenant would share the first
 * one's employees, payroll and audit trail.
 */
const companySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, immutable: true, default: 'primary' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    contactPhone: { type: String, trim: true, maxlength: 40, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    /**
     * Self-descriptive fields captured at registration. All optional with an
     * empty default so an already-initialised deployment (and the seed script)
     * keeps working without a migration — an absent answer stays absent rather
     * than being invented.
     */
    industry: { type: String, trim: true, maxlength: 80, default: '' },
    companySize: { type: String, trim: true, maxlength: 40, default: '' },
    country: { type: String, trim: true, maxlength: 80, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    timezone: { type: String, required: true, default: 'Asia/Karachi', maxlength: 60 },
    currency: { type: String, required: true, uppercase: true, trim: true, default: 'PKR', maxlength: 3 },
    /** Minutes after midnight, so lateness can be computed without parsing strings. */
    workStartMinutes: { type: Number, required: true, default: 540, min: 0, max: 1439 },
    graceMinutes: { type: Number, required: true, default: 15, min: 0, max: 240 },
    setupComplete: { type: Boolean, required: true, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.key
        return ret
      },
    },
  },
)

export type Company = InferSchemaType<typeof companySchema>
export type CompanyDoc = HydratedDocument<Company>

export const CompanyModel = model('Company', companySchema)

/** True when the deployment has already been initialised. */
export async function isSetupComplete(): Promise<boolean> {
  const exists = await CompanyModel.exists({ key: 'primary' })
  return Boolean(exists)
}
