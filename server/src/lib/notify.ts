import { Types } from 'mongoose'
import {
  NotificationModel,
  type NotificationType,
} from '../modules/notifications/notification.model.js'
import { logger } from './logger.js'

export interface NotifyInput {
  userIds: readonly (string | Types.ObjectId)[]
  type: NotificationType
  title: string
  body: string
  link?: string
}

/**
 * Creates one in-app notification per recipient.
 *
 * Like the audit writer this never throws: losing a notification must not fail
 * the business action that produced it. Recipients are de-duplicated first, so
 * a broadcast can never put the same notice in an inbox twice.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const recipients = [
    ...new Set(
      input.userIds
        .map((value) => String(value))
        .filter((value) => Types.ObjectId.isValid(value)),
    ),
  ]
  if (recipients.length === 0) return 0

  try {
    const created = await NotificationModel.insertMany(
      recipients.map((userId) => ({
        userId: new Types.ObjectId(userId),
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
      })),
      { ordered: false },
    )
    return created.length
  } catch (err) {
    logger.error(
      { err, type: input.type, recipients: recipients.length },
      'Failed to create notifications',
    )
    return 0
  }
}