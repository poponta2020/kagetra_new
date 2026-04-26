import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { mailMessageStatusEnum, mailClassificationEnum } from './enums'

/**
 * mail_messages: 1 received e-mail = 1 row.
 *
 * Populated by `apps/mail-worker` via Yahoo!IMAP fetch (PR1). De-duplicated on
 * `messageId` (RFC 5322 Message-ID header), so identical re-fetches do not
 * insert duplicates.
 *
 * `classification` stays nullable until AI extraction runs (PR3); pre-filtered
 * mails (List-Unsubscribe, Auto-Submitted, etc.) are persisted with
 * `classification='noise'` directly so the inbox UI can suppress them.
 *
 * Downstream FKs (mail_attachments, tournament_drafts) arrive in PR2/PR3.
 */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    messageId: text('message_id').notNull().unique(),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses').array().notNull(),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true }).notNull(),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    status: mailMessageStatusEnum('status').notNull().default('pending'),
    classification: mailClassificationEnum('classification'),
    imapUid: integer('imap_uid'),
    imapBox: text('imap_box'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Inbox UI lists newest-first; without this index the sort scans the full
    // table once mail volume grows. Status / classification filters added in
    // later PRs will also benefit from the receivedAt order being indexed.
    index('mail_messages_received_at_desc_idx').on(t.receivedAt.desc()),
  ],
)
