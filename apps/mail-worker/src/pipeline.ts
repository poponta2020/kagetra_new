import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { mailMessages, mailWorkerRuns, tournamentDrafts } from '@kagetra/shared/schema'
import { fetchMails, FixtureMailSource, LiveMailSource, type MailSource } from './fetch/fetcher.js'
import type { ParsedAttachment, ParsedAttachmentSkip } from './fetch/imap-client.js'
import { findByMessageId, insertMailMessage, updateStatus } from './persist/mail-message.js'
import { insertMailAttachment } from './persist/attachment.js'
import { extractAttachment, type ExtractionStatus } from './extract/orchestrator.js'
import { getDb } from './db.js'
import { classifyMail, persistOutcome } from './classify/classifier.js'
import type { LLMExtractor } from './classify/llm/types.js'
import {
  evaluateAndNotify,
  type MailWorkerRunSummary,
  type Notifier,
} from './notify/orchestrator.js'
import {
  notifyExtractCompleted,
  notifyNewMailPush,
  type NewMailInfo,
} from './notify/web-push.js'
import type { WebPushConfig } from './config.js'

export interface PipelineSummary {
  /** Total mails seen by the source (parsed OK + parse failures). */
  fetched: number
  inserted: number
  duplicated: number
  noise: number
  /**
   * Per-mail failures: parse errors from the fetch path AND DB transaction
   * errors from the persist path. Either way the mail is neither inserted nor
   * counted as duplicated, and can be retried on the next run because the
   * parent + all attachments roll back together. `fetched = inserted + duplicated + failed`.
   */
  failed: number
  /** Attachment counters (PR2). Skips are inline/oversized/no-filename drops
   * surfaced from the fetch parser, NOT extractor failures. */
  attachmentsInserted: number
  attachmentsExtracted: number
  attachmentsExtractionFailed: number
  attachmentsUnsupported: number
  attachmentsSkipped: number
  /**
   * AI phase counters (PR3). Populated only when `runPipeline()` was given an
   * `llmExtractor`. When no extractor is provided (legacy tests, --dry-run)
   * all four stay 0.
   */
  draftsInserted: number
  draftsUpdated: number
  /**
   * Drafts left untouched because their existing status was operator-owned
   * (`approved` / `rejected`). Bumped by the AI write path when reextract /
   * pipeline tries to refresh a draft an admin already acted on. Should be
   * zero in normal operation — non-zero means an operator decision survived
   * a stale AI re-run, which is the desired behaviour but worth surfacing.
   */
  draftsPreserved: number
  /** Tournament-positive + AI-classified-as-noise mails (any successful AI run). */
  aiSucceeded: number
  /** AI calls that threw twice or returned malformed payloads. */
  aiFailed: number
  /** Pre-filter said noise → AI was not invoked. */
  aiSkipped: number
  /**
   * Capped error messages from per-mail AI failures (review r2 should-fix).
   * Populated by `runAiPhase` for both the outer-catch path (classifyMail /
   * persistOutcome threw) and the `kind: 'failed'` outcome (LLM call or Zod
   * validation failed twice). `runOnce` merges these into `summary.errors` so
   * the AI consecutive-failure LINE alert can surface the actual provider
   * error instead of "unknown AI error".
   */
  aiErrors: string[]
}

export interface RunPipelineOptions {
  /** Restrict IMAP fetch to mails received on/after this date. */
  since?: Date
  /**
   * When provided, bypass live IMAP and use the supplied source instead.
   * Tests and `--mock-imap` runs pass a `FixtureMailSource` here.
   */
  source?: MailSource
  /** When true, do not write to DB (still parse + classify, returns summary). */
  dryRun?: boolean
  /** Optional logger. Defaults to no-op so tests stay quiet. */
  logger?: PipelineLogger
  /**
   * AI extractor for the post-persist classifier phase. When omitted the AI
   * phase is skipped entirely — used by `--dry-run`, by older PR1/PR2 tests
   * that haven't been migrated, and by `--mock-imap` smoke runs that don't
   * want to load `ANTHROPIC_API_KEY`. When provided, every freshly inserted
   * mail (skipping duplicates and pre-filtered noise) is run through
   * `classifyMail` + `persistOutcome` in its own try/catch.
   */
  llmExtractor?: LLMExtractor
  /**
   * mail-triage-badge: 新規 inserted メール1件ごとに呼ばれる best-effort フック。
   * runOnce が webPushConfig から構築して渡す（配信失敗は pipeline を止めない）。
   * テストは vi.fn() を直接渡してフック発火を検証できる。
   */
  onMailInserted?: (mail: NewMailInfo) => Promise<void>
}

export interface PipelineLogger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

const NOOP_LOGGER: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
}

/**
 * Limit `summary.errors` (and the per-run `summary.aiErrors` feed that flows
 * into it) so a malformed mail batch can't blow up jsonb size. Used in two
 * places: `runAiPhase` caps how many AI failure messages it accumulates, and
 * `runOnce` slices the merged error list before persisting.
 */
const MAX_ERRORS_IN_SUMMARY = 10

function emptySummary(): PipelineSummary {
  return {
    fetched: 0,
    inserted: 0,
    duplicated: 0,
    noise: 0,
    failed: 0,
    attachmentsInserted: 0,
    attachmentsExtracted: 0,
    attachmentsExtractionFailed: 0,
    attachmentsUnsupported: 0,
    attachmentsSkipped: 0,
    draftsInserted: 0,
    draftsUpdated: 0,
    draftsPreserved: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    aiSkipped: 0,
    aiErrors: [],
  }
}

interface ExtractedAttachment {
  att: ParsedAttachment
  text: string | null
  status: ExtractionStatus
}

/**
 * fetch → pre-filter → persist (idempotent on Message-ID) → extract+persist
 * attachments. Returns a count summary the CLI logs.
 *
 * Per-mail and per-attachment errors are isolated:
 *   1. fetch/parse — surfaced as `result.errors` from the source; one bad
 *      RFC 822 buffer can't abort the batch.
 *   2. attachment extract — corrupt PDFs/DOCX downgrade to
 *      `extraction_status='failed'` and the binary is still persisted.
 *   3. mail + attachments persist — wrapped in a single transaction per mail.
 *      If the parent insert or any attachment insert raises, the whole row
 *      group rolls back and is counted as `failed`. The Message-ID UNIQUE
 *      makes the retry idempotent on the next run, so transient DB hiccups
 *      can't leave an orphan parent without its attachments.
 *
 * In dry-run mode, attachments are still inspected for skip/extraction
 * counters but never inserted, so operators can preview pipeline behaviour
 * without touching the DB.
 */
export async function runPipeline(opts: RunPipelineOptions = {}): Promise<PipelineSummary> {
  const log = opts.logger ?? NOOP_LOGGER
  const source = opts.source ?? new LiveMailSource()
  const summary = emptySummary()

  try {
    const result = await fetchMails(source, opts.since)
    summary.fetched = result.prepared.length + result.errors.length
    summary.failed = result.errors.length

    for (const err of result.errors) {
      log.warn('mail fetch failed', {
        stage: err.stage,
        imapUid: err.imapUid,
        imapBox: err.imapBox,
        envelopeMessageId: err.envelopeMessageId,
        reason: err.reason,
      })
    }

    if (opts.dryRun) {
      summary.noise = result.prepared.filter((p) => p.noise).length
      // In dry-run we still account attachments so operators see the same
      // counters they'll see post-merge, just without DB side effects.
      for (const { meta } of result.prepared) {
        accountAttachmentSkips(meta.attachmentSkips, summary, log, meta.messageId)
        for (const att of meta.attachments) {
          await runExtraction(att, summary, log, meta.messageId)
        }
      }
      log.info('pipeline dry-run', { ...summary })
      return summary
    }

    const db = getDb()
    for (const { meta, noise } of result.prepared) {
      // Attachment skip counters land regardless of duplicate/insert status —
      // operators care that an inline-only mail came in even when the parent
      // row already existed.
      accountAttachmentSkips(meta.attachmentSkips, summary, log, meta.messageId)

      // Pre-check Message-ID before kicking off CPU-heavy extraction. cron
      // re-fetches the same window on every tick, so most mails already exist
      // and re-parsing their PDFs (which can be tens of megabytes through
      // pdfjs) is pure waste. The transactional `ON CONFLICT DO NOTHING` in
      // `insertMailMessage` is still our final defense against the rare race
      // where two workers land the same Message-ID concurrently — this
      // pre-check is a fast path, not a uniqueness guarantee.
      const existing = await findByMessageId(db, meta.messageId)
      if (existing) {
        summary.duplicated += 1
        if (noise) summary.noise += 1
        log.info('persisted mail', {
          id: existing.id,
          messageId: meta.messageId,
          duplicated: true,
          noise,
        })
        // Recover rows the AI phase never finished. Two scenarios:
        //   1. status='ai_processing' — a previous run crashed or DB-faulted
        //      between marking the row and persisting the outcome. Without
        //      this branch the mail stays `ai_processing` forever (review
        //      r1: "ai_processing 復旧経路が実装されていません").
        //   2. status='fetched' AND classification IS NULL — pre-PR3 backfill
        //      or a worker that crashed between the mail-insert txn and the
        //      AI call. Pre-filter noise rows (`classification='noise'`,
        //      `status='fetched'`) are deliberately excluded — they were
        //      intentionally never sent to AI.
        // A duplicate that's already `ai_done`/`ai_failed`/`archived` keeps
        // the existing fast-path behaviour: no AI re-run, operator owns it
        // via the reextract CLI.
        if (
          opts.llmExtractor &&
          (existing.status === 'ai_processing' ||
            (existing.status === 'fetched' && existing.classification !== 'noise'))
        ) {
          await runAiPhase(
            db,
            opts.llmExtractor,
            existing.id,
            meta.messageId,
            summary,
            log,
          )
        }
        continue
      }

      // Extract first, outside the DB transaction. Extraction is CPU-heavy
      // and side-effect-free, so we don't want to hold a Postgres txn open
      // while pdfjs / mammoth chew through bytes. Counters tracking the work
      // (attachmentsExtracted / Failed / Unsupported) are correctly populated
      // before any DB touch.
      const extracted: ExtractedAttachment[] = []
      for (const att of meta.attachments) {
        const result = await runExtraction(att, summary, log, meta.messageId)
        extracted.push({ att, ...result })
      }

      let parentResult: { duplicated: boolean; rowId: number | null }
      try {
        parentResult = await db.transaction(async (tx) => {
          const { row, duplicated } = await insertMailMessage(tx, {
            messageId: meta.messageId,
            fromAddress: meta.fromAddress,
            fromName: meta.fromName,
            toAddresses: meta.toAddresses,
            subject: meta.subject,
            receivedAt: meta.receivedAt,
            bodyText: meta.bodyText,
            bodyHtml: meta.bodyHtml,
            // Pre-filtered mails skip AI in PR3; recording the classification
            // now means the inbox UI can hide them straight away even before
            // AI runs.
            classification: noise ? 'noise' : null,
            status: 'fetched',
            imapUid: meta.imapUid,
            imapBox: meta.imapBox,
          })
          if (!duplicated) {
            // Insert siblings inside the same txn; any failure here aborts
            // the parent insert too, so the next run can retry the mail
            // cleanly via Message-ID dedup.
            for (const { att, text, status } of extracted) {
              await insertMailAttachment(tx, {
                mailMessageId: row.id,
                filename: att.filename,
                contentType: att.contentType,
                sizeBytes: att.sizeBytes,
                data: att.data,
                extractedText: text,
                extractionStatus: status,
              })
            }
          }
          return { duplicated, rowId: duplicated ? null : row.id }
        })
      } catch (err) {
        // Atomic failure — the parent insert (if it ran) was rolled back, so
        // the mail can be retried on the next run. We don't bump
        // attachmentsInserted at all because the rollback un-inserted them.
        summary.failed += 1
        log.warn('mail persist failed', {
          messageId: meta.messageId,
          // Mirror the fetch-error log fields (`pipeline.ts:104-110`) so an
          // operator can cross-reference the failing mail against the IMAP
          // server's per-uid state.
          imapUid: meta.imapUid,
          imapBox: meta.imapBox,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      if (parentResult.duplicated) {
        summary.duplicated += 1
      } else {
        summary.inserted += 1
        summary.attachmentsInserted += extracted.length
      }
      if (noise) summary.noise += 1
      log.info('persisted mail', {
        id: parentResult.rowId,
        messageId: meta.messageId,
        duplicated: parentResult.duplicated,
        noise,
      })

      // mail-triage-badge: 新規 inserted メールごとに Web Push 配信（best-effort）。
      // AI phase の前に呼ぶので、バッジの未処理数には今 insert した行が含まれる。
      // 配信失敗で取り込みを止めない（既存 LINE 通知と独立）。
      if (!parentResult.duplicated && opts.onMailInserted) {
        try {
          await opts.onMailInserted({
            subject: meta.subject,
            fromName: meta.fromName,
            fromAddress: meta.fromAddress,
          })
        } catch (err) {
          log.warn('onMailInserted hook failed', {
            messageId: meta.messageId,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // AI phase. Only runs for freshly inserted mails (parent row id known)
      // when an extractor was wired; duplicates and missing extractor short
      // circuit. AI calls are deliberately OUTSIDE the mail+attachments txn
      // (which committed above) — Anthropic round trips can take seconds and
      // we don't want a Postgres connection idle in transaction during them.
      //
      // Pre-filter noise mails are short-circuited here rather than via the
      // classifier's `skipped_noise` branch — saves a DB read and avoids
      // setting `status: ai_processing` on a row that's never going to be
      // classified.
      if (opts.llmExtractor && !parentResult.duplicated && parentResult.rowId !== null) {
        if (noise) {
          summary.aiSkipped += 1
        } else {
          await runAiPhase(
            db,
            opts.llmExtractor,
            parentResult.rowId,
            meta.messageId,
            summary,
            log,
          )
        }
      }
    }
    return summary
  } finally {
    await source.close().catch((err) => {
      log.warn('mail-source close failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }
}

function accountAttachmentSkips(
  skips: ParsedAttachmentSkip[],
  summary: PipelineSummary,
  log: PipelineLogger,
  messageId: string,
): void {
  for (const skip of skips) {
    summary.attachmentsSkipped += 1
    log.warn('attachment skipped', {
      messageId,
      filename: skip.filename,
      contentType: skip.contentType,
      sizeBytes: skip.sizeBytes,
      reason: skip.reason,
    })
  }
}

async function runExtraction(
  att: ParsedAttachment,
  summary: PipelineSummary,
  log: PipelineLogger,
  messageId: string,
): Promise<{ text: string | null; status: ExtractionStatus }> {
  const result = await extractAttachment({
    contentType: att.contentType,
    filename: att.filename,
    data: att.data,
  })
  if (result.status === 'extracted') summary.attachmentsExtracted += 1
  else if (result.status === 'failed') summary.attachmentsExtractionFailed += 1
  else summary.attachmentsUnsupported += 1
  if (result.status === 'failed') {
    log.warn('attachment extraction failed', {
      messageId,
      filename: att.filename,
      contentType: att.contentType,
      reason: result.reason,
    })
  }
  return { text: result.text, status: result.status }
}

/**
 * Wrapper around `classifyMail` + `persistOutcome` for the per-mail AI phase.
 *
 * Three policy decisions are concentrated here:
 *
 *   1. **`status: 'ai_processing'` marker.** Set BEFORE the Anthropic call so
 *      a worker that crashes mid-call leaves the row in a state the next run
 *      can recognise as "needs retry". The marker is best-effort — if even
 *      this update fails the AI call still runs, because losing the marker
 *      is strictly less bad than losing the AI result.
 *
 *   2. **Per-mail try/catch.** Mirrors the per-mail isolation pattern from
 *      PR1's persist phase: one mail's AI failure must not abort the batch.
 *      If the catch path itself fails (DB down etc.) we log and continue —
 *      the next pipeline run will see the `ai_processing` marker and retry.
 *
 *   3. **Tally roll-up via `persistOutcome`.** All draft/status writes
 *      happen inside `persistOutcome` so the reextract CLI can reuse the
 *      same write path with no drift.
 */
async function runAiPhase(
  db: import('./db.js').Db,
  llm: LLMExtractor,
  rowId: number,
  messageId: string,
  summary: PipelineSummary,
  log: PipelineLogger,
): Promise<void> {
  // Best-effort marker so a crash mid-call is recoverable on the next run.
  // Wrap in try/catch so a transient update failure doesn't keep us from
  // attempting the AI call itself.
  try {
    await updateStatus(db, rowId, 'ai_processing')
  } catch (err) {
    log.warn('ai status marker failed', {
      messageId,
      rowId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    const outcome = await classifyMail(db, rowId, llm, { force: false })
    const tally = await persistOutcome(db, rowId, outcome)
    summary.draftsInserted += tally.draftsInserted
    summary.draftsUpdated += tally.draftsUpdated
    summary.draftsPreserved += tally.draftsPreserved
    summary.aiSucceeded += tally.aiSucceeded
    summary.aiFailed += tally.aiFailed
    summary.aiSkipped += tally.aiSkipped
    // `kind: 'failed'` means LLM call/Zod validation failed twice and the
    // failure is already persisted on the draft row. Surface a short reason
    // here too so the AI alert message has something concrete to show. We
    // prefer `rawResponse` (the actual provider output / underlying error)
    // over the static `reason` line, but fall back when rawResponse is null.
    if (
      outcome.kind === 'failed' &&
      summary.aiErrors.length < MAX_ERRORS_IN_SUMMARY
    ) {
      const detail = outcome.rawResponse ?? outcome.reason
      summary.aiErrors.push(truncateAiError(detail))
    }
    // Cost-guard trips are warn-level: an operator-actionable event (raise
    // the env var and reextract, or accept the skip) that shouldn't blend
    // into the info stream alongside successful classifications.
    if (outcome.kind === 'oversize_skipped') {
      log.warn('ai oversize_skipped', {
        messageId,
        rowId,
        filename: outcome.filename,
        sizeBytes: outcome.sizeBytes,
        limitBytes: outcome.limitBytes,
      })
    }
    log.info('ai outcome', {
      messageId,
      rowId,
      kind: outcome.kind,
      draftsInserted: tally.draftsInserted,
      draftsUpdated: tally.draftsUpdated,
    })
  } catch (err) {
    // Outer catch: classifyMail / persistOutcome blew up in a way the inner
    // retry didn't catch (DB write failure, missing row, etc.). Log and move
    // on — the row stays in `ai_processing` and the next run picks it up.
    summary.aiFailed += 1
    const message = err instanceof Error ? err.message : String(err)
    if (summary.aiErrors.length < MAX_ERRORS_IN_SUMMARY) {
      summary.aiErrors.push(truncateAiError(message))
    }
    log.warn('ai phase failed', {
      messageId,
      rowId,
      err: message,
    })
  }
}

/** Trim a single AI error string so one verbose provider response can't blow
 * up `mail_worker_runs.summary` jsonb size. 500 chars is enough for a Zod
 * issue list or an HTTP error body excerpt while staying well under any
 * realistic row-size cap. */
const MAX_AI_ERROR_LENGTH = 500
function truncateAiError(s: string): string {
  if (s.length <= MAX_AI_ERROR_LENGTH) return s
  return s.slice(0, MAX_AI_ERROR_LENGTH) + '…'
}

/**
 * Convenience helper for tests / `--mock-imap`. Builds a FixtureMailSource
 * from raw eml buffers and runs the pipeline against it.
 */
export async function runPipelineFromFixtures(
  fixtures: Array<{ source: Buffer; imapUid?: number; imapBox?: string }>,
  opts: Omit<RunPipelineOptions, 'source'> = {},
): Promise<PipelineSummary> {
  const source = new FixtureMailSource(fixtures)
  return runPipeline({ ...opts, source })
}

// ─────────────────────────────────────────────────────────────────────────────
// runOnce: PR5 Phase 3a wrapper
//
// Wraps `runPipeline` with mail_worker_runs persistence + notification
// orchestration. The pipeline itself still does the IMAP/AI work; runOnce is
// responsible for:
//   1. Inserting a `running` row at the start.
//   2. Running the pipeline (catch top-level errors so the row can still be
//      finalized).
//   3. Computing terminal status from the summary.
//   4. UPDATEing the row with `summary`/`error`/`finished_at`/`status`.
//   5. Calling `evaluateAndNotify` (which handles new-draft + consecutive-
//      failure pings, with its own catch for LineNotifyError).
//
// Crucially, the runs INSERT/UPDATE happen OUTSIDE the per-mail transactions
// — the same reason classify/persist run outside the mail-insert txn:
// connection-pool contention with multi-second IMAP/Anthropic round trips.
// ─────────────────────────────────────────────────────────────────────────────

/** Cap subject list at 10 (the templates layer further trims to 5 for display). */
const MAX_DRAFT_SUBJECTS = 10

export interface RunOnceOptions extends RunPipelineOptions {
  /** Distinguishes scheduler invocations from admin-requested ones. Default 'cron'. */
  kind?: 'cron' | 'manual'
  /** Set when this run was claimed from a `mail_worker_jobs` row. */
  triggeredByUserId?: string | null
  /**
   * DI seam for tests: replace the LINE push with a `vi.fn()`. Defaults to
   * the real `pushSystemNotification`.
   */
  notifier?: Notifier
  /**
   * mail-triage-badge: VAPID 設定。あれば新着メール Web Push 配信フックを組む。
   * null/未設定なら配信は無効（鍵未設定でも取り込みは動く）。
   */
  webPushConfig?: WebPushConfig | null
}

export interface RunOnceResult extends PipelineSummary {
  /** The `mail_worker_runs.id` of the row created for this invocation. */
  runId: number
}

/**
 * Top-level entry: insert a `mail_worker_runs` row, execute the pipeline,
 * finalize the row, fire any LINE notifications, and return the run id +
 * pipeline counters.
 *
 * Failure semantics:
 *   - IMAP-only failure (top-level throw from `runPipeline`) → status
 *     `'imap_failed'`, summary.imap_error=true.
 *   - AI failures with at least one mail also classified successfully →
 *     status `'partial'`.
 *   - AI failures only, mail count > 0, no AI successes → `'ai_failed'`.
 *   - Otherwise (incl. fetched=0 with no errors) → `'success'`.
 *
 * Any failure to UPDATE the run row at the end is rethrown — that's a real
 * DB problem the cron / dispatcher should surface (exit 1). Notification
 * failures are caught inside `evaluateAndNotify` and DO NOT affect the run.
 */
export async function runOnce(opts: RunOnceOptions = {}): Promise<RunOnceResult> {
  const log = opts.logger ?? NOOP_LOGGER
  const kind = opts.kind ?? 'cron'
  const db = getDb()

  // (1) Insert running row up front. We need its id so a crash later can be
  // diagnosed by inspecting the orphaned `running` row.
  const startedAt = new Date()
  const inserted = await db
    .insert(mailWorkerRuns)
    .values({
      startedAt,
      kind,
      status: 'running',
      triggeredByUserId: opts.triggeredByUserId ?? null,
      since: opts.since ?? null,
    })
    .returning({ id: mailWorkerRuns.id })
  const runId = inserted[0]!.id

  // (2) Execute pipeline. Catch top-level throws (IMAP fetch failure,
  // connection refused, etc.) — anything per-mail is already isolated inside
  // runPipeline.
  let summary: PipelineSummary = emptySummary()
  let topLevelError: Error | null = null
  // mail-triage-badge: webPushConfig があれば新着メール Push 配信フックを組む。
  // 未設定（null）ならテスト DI 用の opts.onMailInserted をそのまま使う。
  const onMailInserted = opts.webPushConfig
    ? (mail: NewMailInfo) => notifyNewMailPush(db, opts.webPushConfig!, mail, log)
    : opts.onMailInserted
  try {
    summary = await runPipeline({ ...opts, onMailInserted })
  } catch (err) {
    topLevelError = err instanceof Error ? err : new Error(String(err))
    log.warn('pipeline top-level error', {
      runId,
      err: topLevelError.message,
    })
  }

  // (3) Compose summary jsonb. New draft subjects are looked up post-hoc
  // (createdAt >= startedAt) so we don't have to thread them through the
  // pipeline summary shape (which would risk regressing classifier tests).
  const newDraftSubjects = summary.draftsInserted > 0
    ? await fetchNewDraftSubjects(db, startedAt)
    : []

  // Merge top-level error (if any) with per-mail AI errors collected by
  // runAiPhase. Top-level first so the AI alert's `lastError` lookup
  // (notify/orchestrator.ts) prefers the most-specific failure when one
  // exists. Capped to MAX_ERRORS_IN_SUMMARY so a giant batch of AI
  // failures can't bloat the jsonb row.
  const errors: string[] = []
  if (topLevelError) errors.push(topLevelError.message)
  for (const aiErr of summary.aiErrors) errors.push(aiErr)

  const summaryJson: MailWorkerRunSummary = {
    fetched: summary.fetched,
    classified: summary.aiSucceeded + summary.aiFailed + summary.aiSkipped,
    drafts_created: summary.draftsInserted,
    ai_failed: summary.aiFailed,
    imap_error: topLevelError !== null,
    errors: errors.slice(0, MAX_ERRORS_IN_SUMMARY),
    new_draft_subjects: newDraftSubjects.slice(0, MAX_DRAFT_SUBJECTS),
  }

  const status = computeRunStatus(summary, topLevelError !== null)

  // (4) Finalize the run row. If THIS update fails it's a real DB problem
  // — let it propagate so the cron exits 1 and we notice.
  await db
    .update(mailWorkerRuns)
    .set({
      finishedAt: sql`now()`,
      status,
      summary: summaryJson,
      error: topLevelError ? topLevelError.message : null,
    })
    .where(eq(mailWorkerRuns.id, runId))

  // (5) Notification orchestration. Catches its own LineNotifyError so we
  // don't propagate transient LINE failures past the run boundary.
  try {
    await evaluateAndNotify(db, runId, log, opts.notifier)
  } catch (err) {
    log.warn('evaluateAndNotify threw', {
      runId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // If the pipeline itself top-level threw we should still rethrow so the
  // CLI can exit non-zero. The run row is already persisted with
  // status=imap_failed so the next run's evaluator can see it. We wrap the
  // error in `RunOnceError` so the dispatcher (`index.ts`) can recover the
  // `runId` and link the failed `mail_worker_jobs` row back to the run that
  // captured the error detail (review r2). Message + cause are forwarded so
  // existing `rejects.toThrow(/.../)` tests keep matching.
  if (topLevelError) {
    throw new RunOnceError(topLevelError.message, runId, { cause: topLevelError })
  }

  return { ...summary, runId }
}

/**
 * Wrapper around a runOnce top-level failure that carries the `mail_worker_runs.id`
 * of the run row that already captured the error. `index.ts` checks
 * `instanceof RunOnceError` to forward `runId` to `markJobFailed`, so the
 * failed manual job links to its run.
 *
 * `message` mirrors the underlying error so existing
 * `expect(...).rejects.toThrow(/imap connect refused/)` tests still pass.
 */
export class RunOnceError extends Error {
  readonly runId: number
  constructor(message: string, runId: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RunOnceError'
    this.runId = runId
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runManualExtract: mail-inbox-mailer タスク2
//
// 管理者が inbox 詳細で「会で流す（AI 抽出）」ボタンを押すと、Server Action が
// `mail_worker_jobs` に kind='manual_extract', payload={mail_message_id} を
// INSERT する。`--mode=extract-only` で起動した mail-worker は 30 秒間隔で
// このジョブを claim し、本関数を呼ぶ。
//
// 既存の `runOnce` (IMAP fetch + AI) と意図的に別関数として切り出した理由:
//   - IMAP fetch を skip するので runPipeline の流れを使わない
//   - cron AI 廃止に伴い、AI 抽出はこの経路に集約される
//   - 失敗時のステータス計算 ('ai_failed') がシンプル
//
// 流れ:
//   1. mail_worker_runs (kind='manual', status='running') を INSERT
//   2. classifyMail + persistOutcome を per-mail try/catch で実行
//   3. **persistOutcome が ai_processing draft を更新しない kind**
//      (noise / oversize_skipped / skipped_noise) では、Server Action が事前に
//      作った draft が永遠に ai_processing で残り UI polling が停止しない
//      問題があるため、明示的に ai_failed へ終端させる (Codex r1 blocker)。
//   4. terminal status を計算して mail_worker_runs を UPDATE
//   5. Web Push で完了通知を送る（success / failed）。UI 表記
//      「完了したら通知します」の裏付け (Codex r1 should-fix)。
//
// 注: classifyMail 自体が draft 行を `status='ai_processing'` でマークする前に
// 走るが、Server Action が draft を INSERT 済みなので redundant ではない。
// classifyMail 内の updateStatus は mail_messages.status を更新するもの。
// ─────────────────────────────────────────────────────────────────────────────

export interface RunManualExtractOptions {
  /** 対象の mail_messages.id。Server Action が payload に乗せて渡した値。 */
  mailMessageId: number
  /** AI 抽出器。`buildLlmExtractor` から渡される。 */
  llmExtractor: LLMExtractor
  /** 起動者 (mail_worker_jobs.requested_by_user_id)。run 行の triggered_by に乗る。 */
  triggeredByUserId: string
  /**
   * Web Push 完了通知用 VAPID 設定。null/未設定なら配信スキップ（鍵未設定
   * 環境でも extract 自体は動く）。Codex r1 should-fix 対応。
   */
  webPushConfig?: WebPushConfig | null
  logger?: PipelineLogger
}

export interface RunManualExtractResult {
  /** mail_worker_runs.id */
  runId: number
  /** terminal status */
  status: 'success' | 'ai_failed'
  /** classifyMail/persistOutcome が回せた件数 */
  draftsInserted: number
  draftsUpdated: number
  draftsPreserved: number
  aiSucceeded: number
  aiFailed: number
  aiSkipped: number
  aiErrors: string[]
}

export async function runManualExtract(
  opts: RunManualExtractOptions,
): Promise<RunManualExtractResult> {
  const log = opts.logger ?? NOOP_LOGGER
  const db = getDb()

  const inserted = await db
    .insert(mailWorkerRuns)
    .values({
      startedAt: sql`now()`,
      kind: 'manual',
      status: 'running',
      triggeredByUserId: opts.triggeredByUserId,
      since: null,
    })
    .returning({ id: mailWorkerRuns.id })
  const runId = inserted[0]!.id

  // 個別 mail への classify を per-mail try/catch で。pipeline.ts の runAiPhase
  // と同じ構造（mail_messages.status を `ai_processing` でマーク → classifyMail
  // → persistOutcome → tally 加算）。再利用したいが runAiPhase は private 関数
  // なので、ここで簡潔に inline する。
  const tally = {
    draftsInserted: 0,
    draftsUpdated: 0,
    draftsPreserved: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    aiSkipped: 0,
    aiErrors: [] as string[],
  }
  let topLevelError: Error | null = null

  try {
    // Best-effort marker。crash recovery のため。
    try {
      await updateStatus(db, opts.mailMessageId, 'ai_processing')
    } catch (err) {
      log.warn('manual_extract ai status marker failed', {
        runId,
        mailMessageId: opts.mailMessageId,
        err: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      // force:true で classification='noise' でも AI を呼ぶ（管理者が明示的に
      // AI 抽出を要求したケース。pre-filter が noise と判定したメールでも
      // 「会で流す」と判断した時点で AI 抽出すべき）。
      const outcome = await classifyMail(db, opts.mailMessageId, opts.llmExtractor, {
        force: true,
      })
      const t = await persistOutcome(db, opts.mailMessageId, outcome)
      tally.draftsInserted += t.draftsInserted
      tally.draftsUpdated += t.draftsUpdated
      tally.draftsPreserved += t.draftsPreserved
      tally.aiSucceeded += t.aiSucceeded
      tally.aiFailed += t.aiFailed
      tally.aiSkipped += t.aiSkipped
      if (
        outcome.kind === 'failed' &&
        tally.aiErrors.length < MAX_ERRORS_IN_SUMMARY
      ) {
        const detail = outcome.rawResponse ?? outcome.reason
        tally.aiErrors.push(truncateAiError(detail))
      }
      if (outcome.kind === 'oversize_skipped') {
        log.warn('manual_extract oversize_skipped', {
          runId,
          mailMessageId: opts.mailMessageId,
          filename: outcome.filename,
          sizeBytes: outcome.sizeBytes,
          limitBytes: outcome.limitBytes,
        })
      }

      // Codex r1 blocker: persistOutcome は noise / oversize_skipped /
      // skipped_noise の場合 tournament_drafts を触らない。Server Action
      // (triggerExtractDraft) が事前に作った draft が `ai_processing` のまま
      // 永遠に残り、UI polling が止まらない。
      //
      // - failed   → persistOutcome が upsertDraft で ai_failed に上書き済 (OK)
      // - tournament → upsertDraft で pending_review に上書き済 (OK)
      // - noise    → mail_messages.classification='noise' に倒すが draft は
      //              「pending_review/ai_failed のみ superseded」なので
      //              ai_processing は対象外。ai_failed へ強制終端する。
      // - oversize_skipped → draft は触られない。同じく強制終端。
      // - skipped_noise   → force:true で来ないはずだが防御的に同じ扱い。
      //
      // tally への影響: 既存の aiSucceeded（noise）はそのまま残しつつ、UI 観点で
      // draft を「再試行可能な ai_failed」へ寄せる（UI は ai_failed で
      // 「再試行」「手動でイベントを作成」を出す）。
      if (
        outcome.kind === 'noise' ||
        outcome.kind === 'oversize_skipped' ||
        outcome.kind === 'skipped_noise'
      ) {
        const closed = await db
          .update(tournamentDrafts)
          .set({ status: 'ai_failed', updatedAt: sql`now()` })
          .where(
            and(
              eq(tournamentDrafts.messageId, opts.mailMessageId),
              eq(tournamentDrafts.status, 'ai_processing'),
            ),
          )
          .returning({ id: tournamentDrafts.id })
        if (closed.length > 0) {
          log.info('manual_extract forced ai_processing draft to ai_failed', {
            runId,
            mailMessageId: opts.mailMessageId,
            kind: outcome.kind,
          })
          // 実害は無いが UI 表記との整合のため aiFailed もカウント。
          // （tally.aiSucceeded は noise 経由で既に +1 されているが、aiFailed
          // をインクリメントすることで run.status='ai_failed' に倒れて Web Push
          // が「失敗」として通知される）
          tally.aiFailed += 1
        }
      }

      log.info('manual_extract outcome', {
        runId,
        mailMessageId: opts.mailMessageId,
        kind: outcome.kind,
        draftsInserted: t.draftsInserted,
        draftsUpdated: t.draftsUpdated,
      })
    } catch (err) {
      tally.aiFailed += 1
      const message = err instanceof Error ? err.message : String(err)
      if (tally.aiErrors.length < MAX_ERRORS_IN_SUMMARY) {
        tally.aiErrors.push(truncateAiError(message))
      }
      log.warn('manual_extract phase failed', {
        runId,
        mailMessageId: opts.mailMessageId,
        err: message,
      })
    }
  } catch (err) {
    // outer catch は classifyMail の外（DB connection 切断など）。tally に乗ら
    // ない致命的失敗。
    topLevelError = err instanceof Error ? err : new Error(String(err))
    log.warn('manual_extract top-level error', {
      runId,
      err: topLevelError.message,
    })
  }

  const status: 'success' | 'ai_failed' =
    topLevelError !== null || tally.aiFailed > 0 ? 'ai_failed' : 'success'

  const errors: string[] = []
  if (topLevelError) errors.push(topLevelError.message)
  for (const e of tally.aiErrors) errors.push(e)

  const summaryJson: MailWorkerRunSummary = {
    fetched: 0,
    classified: tally.aiSucceeded + tally.aiFailed + tally.aiSkipped,
    drafts_created: tally.draftsInserted,
    ai_failed: tally.aiFailed,
    imap_error: false,
    errors: errors.slice(0, MAX_ERRORS_IN_SUMMARY),
    new_draft_subjects: [],
  }

  await db
    .update(mailWorkerRuns)
    .set({
      finishedAt: sql`now()`,
      status,
      summary: summaryJson,
      error: topLevelError ? topLevelError.message : null,
    })
    .where(eq(mailWorkerRuns.id, runId))

  // Codex r1 should-fix: 完了通知 (Web Push)。詳細画面の
  // 「完了したら通知します」表記の裏付け。鍵未設定 (config が null) なら
  // skip（既存 cron と同じ慣行）。配信失敗は best-effort で run 自体は止めない。
  if (opts.webPushConfig) {
    try {
      const subjectRow = await db
        .select({ subject: mailMessages.subject })
        .from(mailMessages)
        .where(eq(mailMessages.id, opts.mailMessageId))
        .limit(1)
      const subject = subjectRow[0]?.subject ?? null
      await notifyExtractCompleted(
        db,
        opts.webPushConfig,
        {
          mailMessageId: opts.mailMessageId,
          subject,
          result: status === 'success' ? 'success' : 'failed',
        },
        log,
      )
    } catch (err) {
      log.warn('manual_extract completion notify failed', {
        runId,
        mailMessageId: opts.mailMessageId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    runId,
    status,
    draftsInserted: tally.draftsInserted,
    draftsUpdated: tally.draftsUpdated,
    draftsPreserved: tally.draftsPreserved,
    aiSucceeded: tally.aiSucceeded,
    aiFailed: tally.aiFailed,
    aiSkipped: tally.aiSkipped,
    aiErrors: tally.aiErrors,
  }
}

function computeRunStatus(
  summary: PipelineSummary,
  imapError: boolean,
): 'success' | 'imap_failed' | 'ai_failed' | 'partial' {
  if (imapError) return 'imap_failed'
  // AI partial: some succeeded, some failed.
  if (summary.aiFailed > 0 && summary.aiSucceeded > 0) return 'partial'
  // AI-only failure path: mails were fetched but AI failed on every attempt
  // (i.e. zero successes). Skipped pre-filter mails are not counted as AI
  // failures.
  if (
    summary.aiFailed > 0 &&
    summary.aiSucceeded === 0 &&
    (summary.aiFailed + summary.aiSucceeded) > 0
  ) {
    return 'ai_failed'
  }
  return 'success'
}

/**
 * Look up subjects of drafts created during this run. We filter by
 * `createdAt >= startedAt` and join through `mail_messages` for the subject
 * line. Drafts are typically small in number per run (a handful at most), so
 * the IN-list join is cheap.
 *
 * If the query fails for any reason we return `[]` rather than aborting the
 * whole run — a missing notification preview is far less bad than rolling
 * back a successful pipeline write.
 */
async function fetchNewDraftSubjects(
  db: import('./db.js').Db,
  startedAt: Date,
): Promise<string[]> {
  try {
    const draftRows = await db
      .select({ messageId: tournamentDrafts.messageId })
      .from(tournamentDrafts)
      .where(
        and(
          gte(tournamentDrafts.createdAt, startedAt),
          eq(tournamentDrafts.status, 'pending_review'),
        ),
      )
    if (draftRows.length === 0) return []
    const ids = draftRows.map((r) => r.messageId)
    const subjects = await db
      .select({ subject: mailMessages.subject })
      .from(mailMessages)
      .where(inArray(mailMessages.id, ids))
    return subjects
      .map((r) => r.subject ?? '(no subject)')
      .filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}
