import { Schema, model, type Document, type Types } from 'mongoose'

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number]

/** Who an announcement is addressed to. */
export const ANNOUNCEMENT_AUDIENCES = ['all', 'department', 'role'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'high', 'urgent'] as const
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number]

export const ANNOUNCEMENT_CATEGORIES = [
  'general',
  'policy',
  'event',
  'holiday',
  'payroll',
  'it',
] as const
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number]

export interface ReadReceipt {
  userId: Types.ObjectId
  readAt: Date
}

export interface AnnouncementDoc extends Document<Types.ObjectId> {
  title: string
  body: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  audience: AnnouncementAudience
  /** Only set when the audience is a single department. */
  departmentId?: Types.ObjectId
  /** Only set when the audience is a single role. */
  role?: 'hr' | 'employee'
  status: AnnouncementStatus
  pinned: boolean
  publishAt: Date
  /** Optional auto-expiry, so old notices drop off the feed by themselves. */
  expiresAt?: Date
  authorId?: Types.ObjectId
  authorName: string
  /** Read receipts — one entry per user, appended in order. */
  reads: ReadReceipt[]
  createdAt: Date
  updatedAt: Date
}

const readSchema = new Schema<ReadReceipt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    readAt: { type: Date, required: true },
  },
  { _id: false },
)

const announcementSchema = new Schema<AnnouncementDoc>(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: String, enum: ANNOUNCEMENT_CATEGORIES, default: 'general' },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITIES, default: 'normal', index: true },
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, default: 'all', index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    role: { type: String, enum: ['hr', 'employee'] },
    status: { type: String, enum: ANNOUNCEMENT_STATUSES, default: 'published', index: true },
    pinned: { type: Boolean, default: false },
    publishAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String, required: true, trim: true },
    reads: { type: [readSchema], default: [] },
  },
  { timestamps: true },
)

// The feed reads published, pinned-first, newest-first.
announcementSchema.index({ status: 1, pinned: -1, publishAt: -1 })

export const AnnouncementModel = model<AnnouncementDoc>('Announcement', announcementSchema)

/** Reads either a raw ObjectId or a populated document. */
function refId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && '_id' in (value as object)) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

function refName(value: unknown): string | null {
  if (value && typeof value === 'object' && 'name' in (value as object)) {
    return (value as { name: string }).name ?? null
  }
  return null
}

export function toPublicAnnouncement(doc: AnnouncementDoc, viewerId?: string) {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    category: doc.category,
    priority: doc.priority,
    audience: doc.audience,
    departmentId: refId(doc.departmentId),
    departmentName: refName(doc.departmentId),
    role: doc.role ?? null,
    status: doc.status,
    pinned: doc.pinned,
    publishAt: doc.publishAt,
    expiresAt: doc.expiresAt ?? null,
    authorName: doc.authorName,
    readCount: doc.reads.length,
    read: viewerId ? doc.reads.some((receipt) => String(receipt.userId) === viewerId) : false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}