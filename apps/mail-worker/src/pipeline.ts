import { fetchMails, FixtureMailSource, LiveMailSource, type MailSource } from './fetch/fetcher.js'
import { insertMailMessage } from './persist/mail-message.js'
import { getDb } from './db.js'

export interface PipelineSummary {
  /** Total mails seen by the source (parsed OK + parse failures). */
  fetched: number
  inserted: number
  duplicated: number
  noise: number
  /**
   * Per-mail failures: parse errors from the fetch path AND DB insert errors
   * from the persist path. Either way the mail is neither inserted nor
   * counted as duplicated. `fetched = inserted + duplicated + failed`.
   */
  failed: number
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

/**
 * fetch → pre-filter → persist (idempotent on Message-ID) pipeline.
 *
 * Returns a count summary the CLI logs. Per CLAUDE.md PR1 scope, no AI / no
 * notification — the pipeline only persists mail rows, optionally tagging
 * `classification='noise'` for header-filtered traffic.
 *
 * Per-mail errors are isolated at two layers:
 *   1. fetch/parse — surfaced as `result.errors` from the source; one bad
 *      RFC 822 buffer can't abort the batch.
 *   2. persist — DB insert failures are caught per-mail.
 * Both bump `summary.failed` and are logged via the injected logger.
 */
export async function runPipeline(opts: RunPipelineOptions = {}): Promise<PipelineSummary> {
  const log = opts.logger ?? NOOP_LOGGER
  const source = opts.source ?? new LiveMailSource()
  const summary: PipelineSummary = {
    fetched: 0,
    inserted: 0,
    duplicated: 0,
    noise: 0,
    failed: 0,
  }

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
      log.info('pipeline dry-run', { ...summary })
      return summary
    }

    const db = getDb()
    for (const { meta, noise } of result.prepared) {
      try {
        const { row, duplicated } = await insertMailMessage(db, {
          messageId: meta.messageId,
          fromAddress: meta.fromAddress,
          fromName: meta.fromName,
          toAddresses: meta.toAddresses,
          subject: meta.subject,
          receivedAt: meta.receivedAt,
          bodyText: meta.bodyText,
          bodyHtml: meta.bodyHtml,
          // Pre-filtered mails skip AI in PR3; recording the classification now
          // means the inbox UI can hide them straight away even before AI runs.
          classification: noise ? 'noise' : null,
          status: 'fetched',
          imapUid: meta.imapUid,
          imapBox: meta.imapBox,
        })
        if (duplicated) {
          summary.duplicated += 1
        } else {
          summary.inserted += 1
        }
        if (noise) summary.noise += 1
        log.info('persisted mail', {
          id: row.id,
          messageId: row.messageId,
          duplicated,
          noise,
        })
      } catch (err) {
        // Isolate per-mail failures so one bad row doesn't abort the batch.
        // The mail can be retried on the next run (Message-ID dedup is idempotent).
        summary.failed += 1
        log.warn('mail persist failed', {
          messageId: meta.messageId,
          err: err instanceof Error ? err.message : String(err),
        })
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
