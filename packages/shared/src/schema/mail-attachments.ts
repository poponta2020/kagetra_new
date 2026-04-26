import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { mailMessages } from './mail-messages'
import { attachmentExtractionStatusEnum } from './enums'

/**
 * PostgreSQL `bytea` ↔ Node `Buffer`. Drizzle 0.45.x has no built-in `bytea`
 * helper, and the `pg` driver (v8.x) already exchanges bytea as a Node Buffer
 * in both directions, so the customType is only here to emit the right SQL
 * type at table-create time.
 *
 * Refs:
 *   - https://orm.drizzle.team/docs/custom-types
 *   - https://orm.drizzle.team/docs/column-types/pg
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * mail_attachments: 1 attachment file = 1 row.
 *
 * Populated by `apps/mail-worker` after `mail_messages` insert (PR2). Stores
 * the raw bytes (`data bytea`) plus an extracted plain-text projection
 * (`extracted_text`) for PDF / DOCX / XLSX. Failed/unsupported types keep the
 * binary so the admin UI can still serve a download.
 *
 * Per the PR2 grill-me decisions:
 *   - filename is required (mailparser's `cid:`-only inline images are skipped
 *     by the worker before we get here).
 *   - 30 MB hard cap is enforced upstream — oversized attachments are not
 *     persisted at all (no row, log warning).
 *   - `extracted_text` stays nullable for `unsupported` and `failed` rows.
 */
export const mailAttachments = pgTable(
  'mail_attachments',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    mailMessageId: integer('mail_message_id')
      .notNull()
      .references(() => mailMessages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    extractedText: text('extracted_text'),
    extractionStatus: attachmentExtractionStatusEnum('extraction_status')
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The inbox UI loads attachments per mail row via JOIN. Without an FK index
    // the planner would scan the whole table once volume grows.
    index('mail_attachments_mail_message_id_idx').on(t.mailMessageId),
  ],
)
