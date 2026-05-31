import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { eventLifecycleNotificationStatusEnum, eventLifecycleNotificationTypeEnum } from './enums'
import { events } from './events'

/**
 * event_lifecycle_notifications: once-ever log for lifecycle LINE pushes.
 *
 * Each (event_id, type) is sent at most once, ever. The UNIQUE index is the
 * mechanism that guarantees it:
 *   - Completion pushes (entry_applied / payment_paid) INSERT ON CONFLICT DO
 *     NOTHING inside the toggle transaction; only a successful INSERT fires the
 *     push, so re-toggling a status never re-notifies.
 *   - Daily reminders (deadline / onsite) claim a row by INSERT before pushing;
 *     a cron re-run hits the UNIQUE and is suppressed.
 *
 * `status` records the send outcome (sent / failed / skipped). A failed push is
 * NOT auto-retried — the date condition (deadline = today / today+lead) falls
 * out of range the next day, so reminders are best-effort by design.
 *
 * No standalone index on event_id: the composite UNIQUE (event_id, type) has
 * event_id as its leading column, so it already serves the "all notifications
 * for this event" history lookup.
 */
export const eventLifecycleNotifications = pgTable(
  'event_lifecycle_notifications',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    type: eventLifecycleNotificationTypeEnum('type').notNull(),
    status: eventLifecycleNotificationStatusEnum('status').notNull().default('sent'),
    // Destination group at send time, kept for audit (the binding may later be revoked).
    lineGroupId: text('line_group_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('event_lifecycle_notifications_event_type_uq').on(t.eventId, t.type),
  ],
)
