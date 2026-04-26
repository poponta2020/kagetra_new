import { eq, sql } from 'drizzle-orm'
import { tournamentDrafts } from '@kagetra/shared/schema'
import type { Db } from '../db.js'

type TournamentDraftRow = typeof tournamentDrafts.$inferSelect
type TournamentDraftInsert = typeof tournamentDrafts.$inferInsert

/**
 * Status values valid on the AI-write path. The full enum (incl. `'approved'`,
 * `'rejected'`, `'superseded'`) covers later admin actions in PR4 — the worker
 * itself only ever produces these three.
 */
export type DraftWriteStatus = 'pending_review' | 'ai_failed'

export interface UpsertDraftInput {
  messageId: number
  status: DraftWriteStatus
  /**
   * Stored as numeric(3,2). Drizzle's numeric column expects a string at the
   * insert boundary (the pg driver does the parse), so callers stringify the
   * float themselves before handing it in. `null` is valid for `ai_failed`
   * rows where the model never produced a valid confidence value.
   */
  confidence: string | null
  isCorrection: boolean
  referencesSubject: string | null
  /** Parsed AI payload (or `{}` for ai_failed). Stored as jsonb. */
  extractedPayload: unknown
  aiRawResponse: string | null
  promptVersion: string
  aiModel: string
  aiTokensInput: number | null
  aiTokensOutput: number | null
  /** numeric(10,6) — same string-on-insert quirk as `confidence`. */
  aiCostUsd: string | null
}

export interface UpsertDraftResult {
  row: TournamentDraftRow
  /**
   * `'inserted'` when this is the first draft for the mail; `'updated'` when
   * an existing draft was overwritten (re-extract path or earlier ai_failed
   * being retried). The pipeline counters split insert/update so an operator
   * can tell pure new volume from re-runs at a glance.
   */
  action: 'inserted' | 'updated'
}

/**
 * Upsert a tournament draft keyed on `messageId` (UNIQUE in the schema).
 *
 * We deliberately do a SELECT-then-INSERT-or-UPDATE rather than wrestling
 * Postgres `ON CONFLICT (message_id) DO UPDATE` for a jsonb column — drizzle
 * 0.45's `onConflictDoUpdate` builder requires hand-spelling each column, and
 * the jsonb default + numeric strings make `excluded.*` fragile here. The
 * UNIQUE constraint guarantees we can't end up with duplicate rows; the only
 * race is "two re-extracts on the same mail simultaneously" which is not a
 * scenario we need to defend against (re-extract is an operator command, not
 * an automated cron).
 */
export async function upsertDraft(
  db: Db,
  input: UpsertDraftInput,
): Promise<UpsertDraftResult> {
  const existing = await db
    .select({ id: tournamentDrafts.id })
    .from(tournamentDrafts)
    .where(eq(tournamentDrafts.messageId, input.messageId))
    .limit(1)

  const values: TournamentDraftInsert = {
    messageId: input.messageId,
    status: input.status,
    confidence: input.confidence,
    isCorrection: input.isCorrection,
    referencesSubject: input.referencesSubject,
    extractedPayload: input.extractedPayload,
    aiRawResponse: input.aiRawResponse,
    promptVersion: input.promptVersion,
    aiModel: input.aiModel,
    aiTokensInput: input.aiTokensInput,
    aiTokensOutput: input.aiTokensOutput,
    aiCostUsd: input.aiCostUsd,
  }

  if (existing.length === 0) {
    const inserted = await db.insert(tournamentDrafts).values(values).returning()
    if (!inserted[0]) {
      throw new Error('upsertDraft: insert returned no rows')
    }
    return { row: inserted[0], action: 'inserted' }
  }

  // Re-extract path: keep the original `created_at` and `id`, refresh
  // everything else and bump `updated_at`. We deliberately do NOT touch the
  // approval columns (`approvedAt`, `rejectedAt`, etc.) — re-extracting an
  // already-approved draft is an operator footgun the UI guards against (PR4),
  // but if it ever happens here we don't want to silently nuke the audit
  // trail. PR4 will revisit this once the approval surface is in place.
  const updated = await db
    .update(tournamentDrafts)
    .set({
      status: input.status,
      confidence: input.confidence,
      isCorrection: input.isCorrection,
      referencesSubject: input.referencesSubject,
      extractedPayload: input.extractedPayload,
      aiRawResponse: input.aiRawResponse,
      promptVersion: input.promptVersion,
      aiModel: input.aiModel,
      aiTokensInput: input.aiTokensInput,
      aiTokensOutput: input.aiTokensOutput,
      aiCostUsd: input.aiCostUsd,
      updatedAt: sql`now()`,
    })
    .where(eq(tournamentDrafts.messageId, input.messageId))
    .returning()
  if (!updated[0]) {
    throw new Error(
      `upsertDraft: update for message_id=${input.messageId} returned no rows after presence check`,
    )
  }
  return { row: updated[0], action: 'updated' }
}
