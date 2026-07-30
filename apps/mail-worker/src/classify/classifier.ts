import { and, eq, inArray, sql } from 'drizzle-orm'
import { mailMessages, tournamentDrafts } from '@kagetra/shared/schema'
import type { Db } from '../db.js'
import { loadCostGuardConfig } from '../config.js'
import {
  ATTACHMENT_TOTAL_LIMIT_BYTES,
  exceededAttachmentTotalBytes,
} from './attachment-budget.js'
import { extractAttachment } from '../extract/orchestrator.js'
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
 * Normalise a `bytea` column value into a `Buffer`.
 *
 * drizzle-orm/node-postgres returns bytea differently depending on the query
 * shape: a direct `findFirst({ where })` returns a real `Buffer`, but a nested
 * `findFirst({ with: { attachments: { columns: { data: true } } } })` returns
 * the raw postgres hex-escape string (`"\\x255044462d..."`) — the same form
 * `SELECT data FROM mail_attachments` would print in psql. Calling
 * `Buffer.from(string)` on that re-interprets the literal `\x` characters as
 * UTF-8 and corrupts the bytes, which manifests downstream as Anthropic's
 *   400 invalid_request_error: messages.0.content.0.pdf.source.base64.data:
 *   The PDF specified was not valid
 * — verified 2026-05-11 via `apps/mail-worker/scripts/debug-pdf.ts` and the
 * extended worklog. Hex-decode when we see that shape and fall back to the
 * Buffer path so the helper stays correct under any future driver/version
 * combination that hands raw bytes through directly.
 */
export function bytesFromBytea(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (typeof raw === 'string' && raw.startsWith('\\x')) {
    return Buffer.from(raw.slice(2), 'hex')
  }
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  // Other shapes (e.g. number[] from a third-party JSON serializer) fall
  // through to the array-like overload. Cast is necessary because TS cannot
  // narrow `unknown` past the runtime guards without a discriminator.
  return Buffer.from(raw as ArrayLike<number>)
}

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
  /**
   * "The AI judged this mail not to be an announcement." `classifyMail` can no
   * longer produce this since PROMPT_VERSION 3.0.0 removed classification from
   * the AI's job, but the variant and `persistOutcome`'s handling of it are
   * kept deliberately: `persistOutcome` is the single write path shared with
   * the reextract CLI, and `pipeline.ts` folds this kind together with
   * `oversize_skipped` / `skipped_noise` when force-terminating a stuck
   * `ai_processing` draft. Same rationale as the `oversize_skipped` guard —
   * defensive, not dead by accident.
   */
  | { kind: 'noise'; result: LLMExtractionResult }
  /** Pre-filter (PR1) already classified the mail as noise; skip the LLM. */
  | { kind: 'skipped_noise' }
  /**
   * Cost guard tripped: at least one PDF attachment exceeded
   * `MAIL_WORKER_PDF_SIZE_LIMIT_KB` and the AI call was suppressed before
   * sending. `filename` / `sizeBytes` describe the first offending attachment
   * so the pipeline log and admin UI can name it; `limitBytes` echoes the
   * configured threshold so a stale dev DB row can be audited even after the
   * env var was raised.
   */
  | {
      kind: 'oversize_skipped'
      filename: string
      sizeBytes: number
      limitBytes: number
    }
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
  /**
   * `mail_attachments.id`s the admin selected in the attachment-picker
   * dialog (mail-ai-extract-refinements §3.2.4). Three states, mirroring
   * `tournament_drafts.selected_attachment_ids`:
   *   - `undefined` / `null` — not specified (legacy rows, or a caller that
   *     hasn't adopted selection yet). Every attachment on the mail is sent,
   *     same as before this feature existed.
   *   - `[]` — an explicit "run with the body only" choice. The LLM is still
   *     called (never an early return) with zero attachments.
   *   - non-empty array — only attachments whose `id` is in this set are
   *     forwarded; everything else (including oversized PDFs the picker UI
   *     never let the admin check) is dropped before the size guard runs.
   */
  selectedAttachmentIds?: number[] | null
}

/**
 * Load a mail row + attachments, build an `LLMExtractionInput`, call the
 * extractor with a single retry on failure, and return a `ClassifyOutcome`.
 *
 * The retry path covers two failure modes from `AnthropicExtractor`:
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
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
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

  // Attachment selection (mail-ai-extract-refinements §3.2.4). `undefined`/
  // `null` means "not specified" — send every attachment, matching the
  // pre-selection behaviour and legacy `tournament_drafts` rows whose
  // `selected_attachment_ids` is NULL. An explicit array (including `[]`)
  // restricts the set the LLM ever sees to those ids.
  const attachmentsInScope =
    opts.selectedAttachmentIds == null
      ? mail.attachments
      : mail.attachments.filter((att) =>
          opts.selectedAttachmentIds!.includes(att.id),
        )

  // PDF cost guard. Runs after the pre-filter short-circuit (pre-filter noise
  // never reaches the AI call regardless of size) but before building the
  // Anthropic input, and against `attachmentsInScope` rather than every
  // attachment on the mail — a selection UI blocks checking an oversized PDF
  // in the first place, so a legitimate selection that stays within the
  // limit must not be skipped just because an unselected sibling attachment
  // is oversized (AC-36). We check `sizeBytes` from `mail_attachments` rather
  // than re-measuring `att.data`, because the bytea round-trip can hand us a
  // postgres hex-escape string (see `bytesFromBytea` doc) whose `.length`
  // would over-report by ~2x. `sizeBytes` is populated upstream from the
  // original parsed buffer length and is the canonical source of truth.
  //
  // Limit of 0 disables the guard — used by tests that exercise downstream
  // behaviour without crafting an oversized attachment.
  const limitKb = loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB
  if (limitKb > 0) {
    const limitBytes = limitKb * 1024
    for (const att of attachmentsInScope) {
      if (att.contentType === 'application/pdf' && att.sizeBytes > limitBytes) {
        return {
          kind: 'oversize_skipped',
          filename: att.filename,
          sizeBytes: att.sizeBytes,
          limitBytes,
        }
      }
    }
  }

  // 合計サイズガード（要件 §6）。1件ごとの上限を通っても、複数選べば合計は
  // Anthropic のリクエスト上限 32MB を超え得る（base64 で約 4/3 に膨らむ）。
  // 超えたリクエストは 413 で確実に失敗するので、送る前に弾く。
  //
  // 正常系では Server Action と選択ダイアログが先に止めるが、ここが要るのは
  // **選択が未指定（NULL）の経路**が実在するから: 大きな PDF を何件も持つ古い
  // メールを reextract CLI にかけると、選択なし＝全添付でこの合計に届き得る。
  const totalOver = exceededAttachmentTotalBytes(attachmentsInScope)
  if (totalOver !== null) {
    return {
      kind: 'oversize_skipped',
      filename: `選択した PDF 添付の合計（${attachmentsInScope.filter((a) => a.contentType === 'application/pdf').length} 件）`,
      sizeBytes: totalOver,
      limitBytes: ATTACHMENT_TOTAL_LIMIT_BYTES,
    }
  }

  const attachmentsForLlm: LLMExtractionInput['attachments'] = []
  for (const att of attachmentsInScope) {
    if (att.contentType === 'application/pdf' && att.extractionStatus !== 'failed') {
      // Pass PDFs as native document blocks. Anthropic gets richer layout
      // info from the original PDF than from pdfjs's text dump, and our
      // `extractedText` is only ever a fallback for older retrieval paths.
      attachmentsForLlm.push({
        kind: 'pdf',
        filename: att.filename,
        base64: bytesFromBytea(att.data).toString('base64'),
        id: att.id,
      })
    } else if (att.extractedText) {
      // DOCX/DOC (or future text-extracted formats) — forward the extracted text.
      attachmentsForLlm.push({
        kind: 'text',
        filename: att.filename,
        text: att.extractedText,
        id: att.id,
      })
    } else if (
      att.extractionStatus === 'unsupported' ||
      att.extractionStatus === 'pending'
    ) {
      // Lazy in-memory fallback (Issue #133): rows ingested before a format
      // became supported sit at `unsupported` with NULL text forever — the
      // 多摩大会 .doc was invisible to the AI even after re-extraction. Re-run
      // the extractor on the stored bytes for THIS call only; the row is NOT
      // updated (classifyMail stays pure-read+LLM, see the type doc above),
      // so the admin-facing extraction_status keeps reflecting ingest time.
      // Still-unsupported formats (XLSX) and corrupt files return
      // unsupported/failed here and stay skipped, same as before.
      const fallback = await extractAttachment({
        contentType: att.contentType,
        filename: att.filename,
        data: bytesFromBytea(att.data),
      })
      if (fallback.status === 'extracted' && fallback.text) {
        attachmentsForLlm.push({
          kind: 'text',
          filename: att.filename,
          text: fallback.text,
          id: att.id,
        })
      }
    }
    // `failed` extractions: skipped — a corrupt file has no usable text and
    // retrying it on every classify would just burn CPU. Better to let the
    // LLM judge from headers + body than to feed it noise.
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

  // 3.0.0: the AI no longer votes on whether the mail is an announcement — the
  // administrator already decided that by pressing 「会で流す (AI 抽出)」. Every
  // successful extraction is therefore a tournament outcome. `ClassifyOutcome`
  // keeps its `noise` variant (see the type doc) because `persistOutcome` is a
  // shared write path and the pre-filter's own noise concept is untouched.
  return { kind: 'tournament', result: lastResult }
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

  if (outcome.kind === 'oversize_skipped') {
    // No draft is written — the AI never produced an extraction. We only flip
    // the mail status so the inbox UI can surface "AI スキップ (PDF サイズ超過)"
    // and the operator can decide whether to raise the limit and reextract.
    // The classifier-level outcome.filename / sizeBytes are NOT persisted on
    // the row today; the pipeline log line (pipeline.ts: ai oversize_skipped)
    // is the single source of truth for which file tripped the guard, kept
    // out of the DB so the schema stays unchanged.
    await updateStatus(db, messageId, 'oversize_skipped')
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
      // 3.0.0: `confidence` / `is_correction` / `references_subject` left the
      // extraction schema (classification and correction detection are human
      // work now). The columns stay — dropping them is an explicit Non-goal —
      // but nothing writes a value to them any more. Existing rows keep theirs.
      confidence: null,
      isCorrection: false,
      referencesSubject: null,
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
