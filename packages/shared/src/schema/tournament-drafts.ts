import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { mailMessages } from './mail-messages'
import { events } from './events'
import { users } from './auth'
import { tournamentDraftStatusEnum } from './enums'

/**
 * tournament_drafts: 1 AI-extracted tournament announcement = 1 row.
 *
 * Populated by `apps/mail-worker` after the LLM extractor runs against a
 * `mail_messages` row whose pre-filter classification did not mark it as
 * noise (PR3). One mail produces at most one draft (`message_id UNIQUE`),
 * but re-extraction (e.g. prompt version bump, model upgrade) reuses the
 * same row via UPSERT on `message_id`.
 *
 * Soft FKs to other tables (`event_id`, `approved_by_user_id`,
 * `rejected_by_user_id`) all use `ON DELETE SET NULL` so deleting an event
 * or pruning a user does not cascade-destroy review history.
 *
 * `superseded_by_draft_id` is a self-FK pointing at the draft that replaced
 * this one (manual operator action via the inbox UI, PR4). It is declared as
 * a plain integer column here — the FK constraint is added in the migration
 * via raw SQL ALTER to avoid a TypeScript circular reference in the drizzle
 * schema.
 */
export const tournamentDrafts = pgTable(
  'tournament_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    messageId: integer('message_id')
      .notNull()
      .unique()
      .references(() => mailMessages.id, { onDelete: 'cascade' }),
    status: tournamentDraftStatusEnum('status').notNull().default('pending_review'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    isCorrection: boolean('is_correction').notNull().default(false),
    referencesSubject: text('references_subject'),
    // Self-FK declared via raw ALTER in the migration (drizzle self-references
    // create a circular type ambiguity). Keep this as a plain integer here.
    supersededByDraftId: integer('superseded_by_draft_id'),
    extractedPayload: jsonb('extracted_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    aiRawResponse: text('ai_raw_response'),
    promptVersion: text('prompt_version').notNull(),
    aiModel: text('ai_model').notNull(),
    aiTokensInput: integer('ai_tokens_input'),
    aiTokensOutput: integer('ai_tokens_output'),
    aiCostUsd: numeric('ai_cost_usd', { precision: 10, scale: 6 }),
    eventId: integer('event_id').references(() => events.id, { onDelete: 'set null' }),
    approvedByUserId: text('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { mode: 'date', withTimezone: true }),
    rejectedByUserId: text('rejected_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    rejectedAt: timestamp('rejected_at', { mode: 'date', withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Confidence is the LLM's self-rated probability that the mail is a
    // tournament announcement. Bound to [0,1] (or NULL for ai_failed rows).
    check(
      'tournament_drafts_confidence_range',
      sql`${table.confidence} BETWEEN 0 AND 1 OR ${table.confidence} IS NULL`,
    ),
    // The inbox queue lists pending drafts newest-first; this composite index
    // keeps the listing fast as volume grows.
    index('idx_drafts_status_created').on(table.status, table.createdAt.desc()),
  ],
)
