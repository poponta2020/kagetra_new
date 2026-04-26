import { fetchMails, FixtureMailSource, LiveMailSource, type MailSource } from './fetch/fetcher.js'
import type { ParsedAttachment, ParsedAttachmentSkip } from './fetch/imap-client.js'
import { insertMailMessage } from './persist/mail-message.js'
import { insertMailAttachment } from './persist/attachment.js'
import { extractAttachment, type ExtractionStatus } from './extract/orchestrator.js'
import { getDb } from './db.js'

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
