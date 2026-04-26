import { and, eq, inArray, sql } from 'drizzle-orm'
import { mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
import type { Db } from '../db.js'
import { upsertDraft } from '../persist/draft.js'
import { updateStatus } from '../persist/mail-message.js'
import {
  LLMExtractorError,
  type LLMExtractionInput,
  type LLMExtractionResult,
  type LLMExtractor,
} from './llm/types.js'
import { buildSystemPrompt, PROMPT_VERSION } from './prompt.js'

/**
 * What the classifier produced for a single mail. The pipeline (and the
 * `reextract` CLI) consume this discriminated union and decide which DB
 * mutations to issue: insert/update a draft row, bump
 * `mail_messages.status`, etc.
 *
 * Crucially, `classifyMail` itself never writes to the DB — keeping the
 * classifier pure-read+LLM means tests can run it against an in-memory DB
 * snapshot without any side effects on the assertion path, and the reextract
 * CLI can chain its own persistence with reused logic.
 */
export type ClassifyOutcome =
  | { kind: 'tournament'; result: LLMExtractionResult }
  | { kind: 'noise'; result: LLMExtractionResult }
  /** Pre-filter (PR1) already classified the mail as noise; skip the LLM. */
  | { kind: 'skipped_noise' }
  /**
   * LLM call or Zod validation failed twice; payload to persist comes from
   * caller. `rawResponse` carries the provider's actual response when the
   * thrown error was an `LLMExtractorError` subclass (e.g. content blocks
   * for `LLMNoToolUseError`, the unparsed tool input for
   * `LLMValidationError`); otherwise it falls back to the error message.
   * `attemptedModel` is the `llm.modelId` of the extractor that failed,
   * recorded so the `ai_failed` draft's `ai_model` column stays accurate
   * across model bumps and provider swaps.
   */
  | {
      kind: 'failed'
      rawResponse: string | null
      attemptedModel: string
      reason: string
    }

export interface ClassifyOptions {
  /**
   * Bypass the pre-filter `classification === 'noise'` early-return. Used by
   * the `reextract` CLI when an operator wants to re-run AI on a mail the
   * pre-filter previously dropped (e.g. a venue allow-list change).
   */
  force?: boolean
}

/**
 * Load a mail row + attachments, build an `LLMExtractionInput`, call the
 * extractor with a single retry on failure, and return a `ClassifyOutcome`.
 *
 * The retry path covers two failure modes from `AnthropicSonnet46Extractor`:
 *   1. `LLMNoToolUseError` — Claude returned a text-only response.
 *   2. `ZodError` — Claude called the tool but returned a payload that didn't
 *      match `ExtractionPayloadSchema` (extra/missing fields, wrong types).
 *
 * One retry is enough in practice; both failure modes are rare (forced
 * tool_use + Zod-typed schema) and a second prompt does not change Claude's
 * mind on a deterministic mistake. If the second attempt also fails we hand
 * the raw error message back so the caller can persist it on an `ai_failed`
 * draft for human review.
 */
export async function classifyMail(
  db: Db,
  messageId: number,
  llm: LLMExtractor,
  opts: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  const mail = await db.query.mailMessages.findFirst({
    where: eq(mailMessages.id, messageId),
    with: {
      attachments: {
        columns: {
          filename: true,
          contentType: true,
          data: true,
          extractedText: true,
          extractionStatus: true,
        },
      },
    },
  })
  if (!mail) {
    throw new Error(`classifyMail: message ${messageId} not found`)
  }

  if (!opts.force && mail.classification === 'noise') {
    return { kind: 'skipped_noise' }
  }

  const attachmentsForLlm: LLMExtractionInput['attachments'] = []
  for (const att of mail.attachments) {
    if (att.contentType === 'application/pdf' && att.extractionStatus !== 'failed') {
      // Pass PDFs as native document blocks. Anthropic gets richer layout
      // info from the original PDF than from pdfjs's text dump, and our
      // `extractedText` is only ever a fallback for older retrieval paths.
      attachmentsForLlm.push({
        kind: 'pdf',
        filename: att.filename,
        base64: Buffer.from(att.data).toString('base64'),
      })
    } else if (att.extractedText) {
      // DOCX (or future text-extracted formats) — forward the extracted text.
      attachmentsForLlm.push({
        kind: 'text',
        filename: att.filename,
        text: att.extractedText,
      })
    }
    // XLSX / failed extractions: skipped. PR2 disabled the XLSX extractor
    // for security, and a failed PDF has no usable text anyway. Better to let
    // the LLM judge from headers + body than to feed it noise.
  }

  const input: LLMExtractionInput = {
    systemPrompt: buildSystemPrompt(),
    promptVersion: PROMPT_VERSION,
    emailMeta: {
      subject: mail.subject ?? '',
      from: mail.fromAddress,
      date: mail.receivedAt,
    },
    emailBodyText: mail.bodyText ?? mail.bodyHtml ?? '',
    attachments: attachmentsForLlm,
  }

  let lastResult: LLMExtractionResult | null = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lastResult = await llm.extract(input)
      break
    } catch (err) {
      lastError = err
      // Falls through to the next iteration; on the final attempt the loop
      // exits with `lastResult` still null.
    }
  }

  if (!lastResult) {
    // Prefer the provider response captured by `LLMExtractorError` (e.g.
    // Anthropic's tool_use-less content blocks or the unparsed tool input
    // from a Zod failure). Fall back to the error message only when the
    // error didn't carry a provider response.
    const rawResponse =
      lastError instanceof LLMExtractorError
        ? lastError.rawResponse
        : lastError instanceof Error
          ? lastError.message
          : String(lastError)
    return {
      kind: 'failed',
      rawResponse,
      attemptedModel: llm.modelId,
      reason: 'LLM call or Zod validation failed twice',
    }
  }

  if (lastResult.parsed.is_tournament_announcement) {
    return { kind: 'tournament', result: lastResult }
  }
  return { kind: 'noise', result: lastResult }
}

/**
 * Persist a `ClassifyOutcome` into `mail_messages` (status / classification)
 * and, where applicable, `tournament_drafts`. Centralised so that both the
 * pipeline and the `reextract` CLI go through one identical write path —
 * status transitions and draft fields can't drift between the two callers.
 *
 * Returns the side-effect tally so callers can roll it into their own summary
 * counters. The function does NOT swallow errors; isolation (per-mail
 * try/catch) is the caller's responsibility.
 */
export interface PersistOutcomeTally {
  draftsInserted: number
  draftsUpdated: number
  /**
   * Drafts left untouched because their existing status was operator-owned
   * (`approved` / `rejected`). Surfaced separately from `draftsUpdated` so the
   * reextract CLI can show "AI verdict ran but admin decision preserved" at a
   * glance — distinct from "no draft existed yet" or "draft was actually
   * refreshed".
   */
  draftsPreserved: number
  aiSucceeded: number
  aiFailed: number
  aiSkipped: number
}

export function emptyOutcomeTally(): PersistOutcomeTally {
  return {
    draftsInserted: 0,
    draftsUpdated: 0,
    draftsPreserved: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    aiSkipped: 0,
  }
}

export async function persistOutcome(
  db: Db,
  messageId: number,
  outcome: ClassifyOutcome,
): Promise<PersistOutcomeTally> {
  const tally = emptyOutcomeTally()

  if (outcome.kind === 'skipped_noise') {
    tally.aiSkipped += 1
    return tally
  }

  if (outcome.kind === 'failed') {
    // ai_failed drafts retain the raw error so a human can decide whether to
    // retry the prompt or give up. `extractedPayload` defaults to `{}` so the
    // jsonb column stays valid.
    const upsert = await upsertDraft(db, {
      messageId,
      status: 'ai_failed',
      confidence: null,
      isCorrection: false,
      referencesSubject: null,
      extractedPayload: {},
      aiRawResponse: outcome.rawResponse,
      promptVersion: PROMPT_VERSION,
      // The classifier captured the extractor's `modelId` at the time of
      // failure, so this stays correct after a model bump or under a
      // non-Anthropic extractor — review r3 Should fix replaced the
      // previous `'claude-sonnet-4-6'` literal.
      aiModel: outcome.attemptedModel,
      aiTokensInput: null,
      aiTokensOutput: null,
      aiCostUsd: null,
    })
    if (upsert.action === 'inserted') tally.draftsInserted += 1
    else if (upsert.action === 'updated') tally.draftsUpdated += 1
    else tally.draftsPreserved += 1
    tally.aiFailed += 1
    // Mail status mirrors the AI outcome; the existing draft preservation
    // happens at the draft level only, so an admin-approved draft on a now-
    // failing mail still flips `mail_messages.status` to `ai_failed` to
    // surface the regression in the inbox UI without rewriting the audit
    // trail attached to the draft.
    await updateStatus(db, messageId, 'ai_failed')
    return tally
  }

  // tournament | noise — both have an `LLMExtractionResult`.
  const result = outcome.result
  const parsed = result.parsed

  if (outcome.kind === 'tournament') {
    const upsert = await upsertDraft(db, {
      messageId,
      status: 'pending_review',
      confidence: parsed.confidence.toFixed(2),
      isCorrection: parsed.is_correction === true,
      referencesSubject: parsed.references_subject ?? null,
      extractedPayload: parsed,
      aiRawResponse: result.raw,
      promptVersion: result.promptVersion,
      aiModel: result.model,
      aiTokensInput: result.tokensInput,
      aiTokensOutput: result.tokensOutput,
      aiCostUsd: result.costUsd.toFixed(6),
    })
    if (upsert.action === 'inserted') tally.draftsInserted += 1
    else if (upsert.action === 'updated') tally.draftsUpdated += 1
    else tally.draftsPreserved += 1
    tally.aiSucceeded += 1
    // Update classification AND status atomically. Skipping the
    // classification update here used to leave positive mails with a NULL
    // pill while the noise branch updated theirs (review r1 Should Fix:
    // "AI が tournament と判定しても classification が更新されません").
    await db
      .update(mailMessages)
      .set({ classification: 'tournament', status: 'ai_done', updatedAt: sql`now()` })
      .where(eq(mailMessages.id, messageId))
    return tally
  }

  // outcome.kind === 'noise' — AI verdict was "not a tournament announcement".
  // No new draft is inserted (drafts only exist for tournament-positive
  // mails); the mail's `classification` is upgraded to 'noise' so the inbox
  // UI can hide it.
  //
  // Re-extract corner case: if a previous run created a `pending_review` /
  // `ai_failed` draft and this run flipped the verdict to noise (prompt or
  // model bump), the stale draft must be marked `superseded` so the review
  // queue stops surfacing it. We deliberately do NOT touch `approved` /
  // `rejected` drafts — those are operator-owned audit trail; flipping them
  // here would silently overwrite a human decision.
  await db
    .update(mailMessages)
    .set({ classification: 'noise', status: 'ai_done', updatedAt: sql`now()` })
    .where(eq(mailMessages.id, messageId))
  const superseded = await db
    .update(tournamentDrafts)
    .set({ status: 'superseded', updatedAt: sql`now()` })
    .where(
      and(
        eq(tournamentDrafts.messageId, messageId),
        inArray(tournamentDrafts.status, ['pending_review', 'ai_failed']),
      ),
    )
    .returning({ id: tournamentDrafts.id })
  if (superseded.length > 0) tally.draftsUpdated += 1
  tally.aiSucceeded += 1
  return tally
}
