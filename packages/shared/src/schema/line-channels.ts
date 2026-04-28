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
 * `assigned_user_id` is the FK to users; the reverse pointer
 * `users.line_channel_id` is intentionally declared without a SQL FK constraint
 * to break the circular import between auth.ts and line-channels.ts. The
 * relation is wired up in `relations.ts` so Drizzle ORM joins still work.
 */
export const lineChannels = pgTable('line_channels', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  channelId: text('channel_id').notNull().unique(),
  channelSecret: text('channel_secret').notNull(),
  channelAccessToken: text('channel_access_token').notNull(),
  botId: text('bot_id').notNull(),
  status: lineChannelStatusEnum('status').notNull().default('available'),
  assignedUserId: text('assigned_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  notificationLineUserId: text('notification_line_user_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
