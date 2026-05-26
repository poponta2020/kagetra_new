import { boolean, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { eventBroadcastMessageStatusEnum } from './enums'
import { eventLineBroadcasts } from './event-line-broadcasts'
import { mailMessages } from './mail-messages'

/**
 * event_broadcast_messages: 1 mail → 1 LINE group push = 1 row.
 *
 * UNIQUE (event_line_broadcast_id, mail_message_id) prevents accidental
 * double-delivery — manual re-broadcast updates the existing row's status
 * back to 'pending' rather than inserting a new one.
 *
 * `mail_message_id` uses ON DELETE RESTRICT: delivery history must outlive
 * any operator-level pruning of mail_messages. Cascade from the broadcast
 * binding is fine — if the event itself is gone, the per-mail audit goes
 * with it.
 *
 * The counters (`sent_text_count`, `sent_image_count`, `fallback_link_count`)
 * record what actually went out so a `partial` row can be triaged without
 * replaying the original mail.
 */
export const eventBroadcastMessages = pgTable(
  'event_broadcast_messages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventLineBroadcastId: integer('event_line_broadcast_id')
      .notNull()
      .references(() => eventLineBroadcasts.id, { onDelete: 'cascade' }),
    mailMessageId: integer('mail_message_id')
      .notNull()
      .references(() => mailMessages.id, { onDelete: 'restrict' }),
    status: eventBroadcastMessageStatusEnum('status').notNull().default('pending'),
    isCorrection: boolean('is_correction').notNull().default(false),
    sentTextCount: integer('sent_text_count').notNull().default(0),
    sentImageCount: integer('sent_image_count').notNull().default(0),
    // Attachments that fell back to a signed-URL link (libreoffice/pdfjs
    // failure, 30+ page cap, or Excel-by-design).
    fallbackLinkCount: integer('fallback_link_count').notNull().default(0),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_broadcast_messages_broadcast_mail_uq').on(
      t.eventLineBroadcastId,
      t.mailMessageId,
    ),
  ],
)
