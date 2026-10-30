import { Schema, model, type Document, type Types } from 'mongoose'

export const NOTIFICATION_TYPES = [
  'leave',
  'attendance',
  'payroll',
  'announcement',
  'system',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationDoc extends Document<Types.ObjectId> {
  /** The recipient — notifications are never shared between users. */
  userId: Types.ObjectId
  type: NotificationType
  title: string
  body: string
  /** Where the UI should navigate when the item is opened. */
  link?: string
  readAt?: Date
  createdAt: Date
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'system', index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 600 },
    link: { type: String, trim: true, maxlength: 200 },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// The bell reads one user's inbox, unread first, newest first.
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })

export const NotificationModel = model<NotificationDoc>('Notification', notificationSchema)

export function toPublicNotification(doc: NotificationDoc) {
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    link: doc.link ?? null,
    read: Boolean(doc.readAt),
    readAt: doc.readAt ?? null,
    createdAt: doc.createdAt,
  }
}