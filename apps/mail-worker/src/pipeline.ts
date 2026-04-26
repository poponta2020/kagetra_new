import { fetchMails, FixtureMailSource, LiveMailSource, type MailSource } from './fetch/fetcher.js'
import type { ParsedAttachment, ParsedAttachmentSkip } from './fetch/imap-client.js'
import { findByMessageId, insertMailMessage, updateStatus } from './persist/mail-message.js'
import { insertMailAttachment } from './persist/attachment.js'
import { extractAttachment, type ExtractionStatus } from './extract/orchestrator.js'
import { getDb } from './db.js'
import { classifyMail, persistOutcome } from './classify/classifier.js'
import type { LLMExtractor } from './classify/llm/types.js'

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
  /** Tournament-positive + AI-classified-as-noise mails (any successful AI run). */
  aiSucceeded: number
  /** AI calls that threw twice or returned malformed payloads. */
  aiFailed: number
  /** Pre-filter said noise → AI was not invoked. */
  aiSkipped: number
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
}

export interface PipelineLogger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

const NOOP_LOGGER: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
}

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
    aiSucceeded: 0,
    aiFailed: 0,
    aiSkipped: 0,
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
    summary.aiSucceeded += tally.aiSucceeded
    summary.aiFailed += tally.aiFailed
    summary.aiSkipped += tally.aiSkipped
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
    log.warn('ai phase failed', {
      messageId,
      rowId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
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
