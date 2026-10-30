import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'
import { ROLES, type Role } from './permissions.js'

export const USER_STATUSES = ['active', 'inactive'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    // Never selected by default: must be requested explicitly.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'active' },

    // Temporary-password flow: the account must change it before doing
    // anything else.
    mustChangePassword: { type: Boolean, required: true, default: false },

    /**
     * Bumped on password change, reset, or deactivation. Embedded in the
     * JWT and compared on every request, which invalidates every existing
     * session without needing a server-side session store.
     */
    tokenVersion: { type: Number, required: true, default: 0 },

    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        // Defense in depth: these must never appear in a response body.
        delete ret.passwordHash
        delete ret.tokenVersion
        return ret
      },
    },
  },
)

userSchema.index({ role: 1, status: 1 })

export type User = InferSchemaType<typeof userSchema>
export type UserDoc = HydratedDocument<User>

export const UserModel = model('User', userSchema)

/** Shape returned to clients. Deliberately minimal. */
export interface PublicUser {
  id: string
  email: string
  fullName: string
  role: Role
  status: UserStatus
  mustChangePassword: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

export function toPublicUser(doc: UserDoc): PublicUser {
  return {
    id: String(doc._id),
    email: doc.email,
    fullName: doc.fullName,
    role: doc.role as Role,
    status: doc.status as UserStatus,
    mustChangePassword: doc.mustChangePassword,
    lastLoginAt: doc.lastLoginAt ?? null,
    createdAt: doc.createdAt as Date,
  }
}

/** Normalise an email the same way everywhere it is compared or stored. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
