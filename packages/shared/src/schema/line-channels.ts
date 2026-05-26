import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { lineChannelStatusEnum, lineChannelPurposeEnum } from './enums'
import { users } from './auth'
import { events } from './events'

/**
 * line_channels: pool of LINE Messaging API channels managed by the system.
 *
 * `purpose` partitions the pool:
 *   - `system_notify`: a single channel consumed by mail-worker for admin
 *     notifications (new draft, IMAP/AI failure alerts).
 *   - `event_broadcast`: a 30-Bot pool for the event-line-broadcast feature,
 *     each reserved per-tournament via `assigned_event_id`. UNIQUE on
 *     `assigned_event_id` enforces 1-channel-per-event at the DB layer; the
 *     reverse direction is `WHERE assigned_event_id = ?`.
 *
 * Legacy `assigned_user_id` is retained for the future per-user assignment
 * use case (Phase 2 scope-out) and stays NULL for event_broadcast rows.
 */
export const lineChannels = pgTable('line_channels', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  channelId: text('channel_id').notNull().unique(),
  channelSecret: text('channel_secret').notNull(),
  channelAccessToken: text('channel_access_token').notNull(),
  botId: text('bot_id').notNull(),
  status: lineChannelStatusEnum('status').notNull().default('available'),
  purpose: lineChannelPurposeEnum('purpose').notNull().default('system_notify'),
  // UNIQUE makes the relation 1:1 at the DB layer: a given user can never
  // accidentally end up with two `assigned`/`active` channel rows. NULLs are
  // not unique-checked by Postgres so unassigned channels (the pool) are
  // unconstrained. Reverse direction lookup is `WHERE assigned_user_id = ?`.
  assignedUserId: text('assigned_user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
  // event-line-broadcast: same UNIQUE-NULL pattern as assignedUserId. Prevents
  // the same Bot from being assigned to two events simultaneously.
  assignedEventId: integer('assigned_event_id')
    .unique()
    .references(() => events.id, { onDelete: 'set null' }),
  notificationLineUserId: text('notification_line_user_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
