import { sql } from 'drizzle-orm'
import {
  index,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  gradeEnum,
  rosterImportDraftStatusEnum,
  rosterImportSourceKindEnum,
  rosterTypeEnum,
} from './enums'
import { mailAttachments } from './mail-attachments'
import { mailMessages } from './mail-messages'
import { tournamentSeriesEditions } from './tournament-series-editions'
import { users } from './auth'

/** Structured roster candidate awaiting explicit admin verification. */
export const tournamentRosterImportDrafts = pgTable(
  'tournament_roster_import_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sourceKind: rosterImportSourceKindEnum('source_kind').notNull(),
    sourceMailMessageId: integer('source_mail_message_id'),
    sourceAttachmentId: integer('source_attachment_id'),
    parserVersion: text('parser_version').notNull(),
    status: rosterImportDraftStatusEnum('status').notNull().default('pending_review'),
    extractedPayload: jsonb('extracted_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    failureReason: text('failure_reason'),
    inferredEditionId: integer('inferred_edition_id'),
    inferredRosterType: rosterTypeEnum('inferred_roster_type'),
    inferredGrade: gradeEnum('inferred_grade'),
    approvedAt: timestamp('approved_at', { mode: 'date', withTimezone: true }),
    approvedByUserId: text('approved_by_user_id'),
    rejectedAt: timestamp('rejected_at', { mode: 'date', withTimezone: true }),
    rejectedByUserId: text('rejected_by_user_id'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tournament_roster_import_drafts_attachment_key')
      .on(table.sourceAttachmentId)
      .where(
        sql`${table.sourceKind} = 'attachment' AND ${table.sourceAttachmentId} IS NOT NULL`,
      ),
    uniqueIndex('tournament_roster_import_drafts_body_message_key')
      .on(table.sourceMailMessageId)
      .where(sql`${table.sourceKind} = 'body' AND ${table.sourceMailMessageId} IS NOT NULL`),
    index('tournament_roster_import_drafts_status_created_idx').on(
      table.status,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.sourceMailMessageId],
      foreignColumns: [mailMessages.id],
      name: 'trid_source_mail_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.sourceAttachmentId],
      foreignColumns: [mailAttachments.id],
      name: 'trid_source_attachment_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.inferredEditionId],
      foreignColumns: [tournamentSeriesEditions.id],
      name: 'trid_inferred_edition_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.approvedByUserId],
      foreignColumns: [users.id],
      name: 'trid_approved_by_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.rejectedByUserId],
      foreignColumns: [users.id],
      name: 'trid_rejected_by_fk',
    }).onDelete('set null'),
  ],
)
