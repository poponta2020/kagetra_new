import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { lineChannelStatusEnum } from './enums'
import { users } from './auth'

/**
 * line_channels: pool of LINE Messaging API channels managed by the system.
 *
 * One row per provisioned LINE channel. The `system` status row is consumed by
 * the mail-worker for admin notifications (new draft created, IMAP/AI failure
 * alerts). `assigned`/`active` rows reserve a channel for an individual user
 * (Phase 2, scope-out for PR5). `available` rows form the unassigned pool.
 *
 * `assigned_user_id` is the canonical FK from a channel to its assigned user
 * — also the only FK between the two tables, on purpose. Pre-PR5-r2 we also
 * had a `users.line_channel_id` reverse pointer but it carried no FK / UNIQUE,
 * leaving the two sides free to disagree. The reverse direction is now done
 * by querying line_channels with `assigned_user_id = users.id` (a future
 * UNIQUE on assigned_user_id will make this 1:1 at the DB layer).
 */
export const lineChannels = pgTable('line_channels', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  channelId: text('channel_id').notNull().unique(),
  channelSecret: text('channel_secret').notNull(),
  channelAccessToken: text('channel_access_token').notNull(),
  botId: text('bot_id').notNull(),
  status: lineChannelStatusEnum('status').notNull().default('available'),
  // UNIQUE makes the relation 1:1 at the DB layer: a given user can never
  // accidentally end up with two `assigned`/`active` channel rows. NULLs are
  // not unique-checked by Postgres so unassigned channels (the pool) are
  // unconstrained. Reverse direction lookup is `WHERE assigned_user_id = ?`.
  assignedUserId: text('assigned_user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
  notificationLineUserId: text('notification_line_user_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
