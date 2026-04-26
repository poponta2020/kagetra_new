import {
  ImapClient,
  parseEmlBuffer,
  type FetchSinceResult,
  type FetchedMailError,
  type ParsedMailMeta,
} from './imap-client.js'
import { shouldSkipByHeaders } from './pre-filter.js'

/**
 * Pluggable source of raw mails for the fetcher. The IMAP path uses
 * `LiveMailSource`; tests and `--mock-imap` use `FixtureMailSource` with eml
 * buffers.
 *
 * `fetch` returns both successfully-parsed mails AND per-mail parse errors so
 * one bad message can never abort the batch.
 */
export interface MailSource {
  fetch(since: Date | undefined): Promise<FetchSinceResult>
  close(): Promise<void>
}

/**
 * Live IMAP source — connects to Yahoo!IMAP, opens INBOX, fetches messages
 * received on or after `since`. Always disconnects on close.
 */
export class LiveMailSource implements MailSource {
  private client = new ImapClient()
  private connected = false

  async fetch(since: Date | undefined): Promise<FetchSinceResult> {
    if (!this.connected) {
      await this.client.connect()
      this.connected = true
    }
    return this.client.fetchSince(since)
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect()
      this.connected = false
    }
  }
}

/**
 * Fixture source — used by `--mock-imap` and unit tests. Each entry pairs a
 * raw eml Buffer with an optional pseudo-UID and mailbox label.
 */
export interface FixtureEntry {
  source: Buffer
  imapUid?: number
  imapBox?: string
}

export class FixtureMailSource implements MailSource {
  constructor(private readonly entries: readonly FixtureEntry[]) {}

  async fetch(since: Date | undefined): Promise<FetchSinceResult> {
    const parsed: ParsedMailMeta[] = []
    const errors: FetchedMailError[] = []
    for (const entry of this.entries) {
      const imapUid = entry.imapUid ?? null
      const imapBox = entry.imapBox ?? 'INBOX'
      try {
        const meta = await parseEmlBuffer(entry.source, imapUid, imapBox)
        if (!meta) {
          errors.push({
            imapUid,
            imapBox,
            envelopeMessageId: null,
            reason: 'Message-ID header missing — cannot key for de-dup',
            stage: 'parse_failed',
          })
          continue
        }
        if (since && meta.receivedAt < since) continue
        parsed.push(meta)
      } catch (err) {
        errors.push({
          imapUid,
          imapBox,
          envelopeMessageId: null,
          reason: err instanceof Error ? err.message : String(err),
          stage: 'parse_failed',
        })
      }
    }
    return { parsed, errors }
  }

  async close(): Promise<void> {
    /* no-op */
  }
}

export interface PreparedMail {
  meta: ParsedMailMeta
  /** True when the header pre-filter classified this as noise. */
  noise: boolean
}

export interface FetchResult {
  prepared: PreparedMail[]
  /** Per-mail parse failures forwarded from the source — pipeline counts them. */
  errors: FetchedMailError[]
}

/**
 * Run the source and tag each successfully parsed mail with its noise flag.
 * Pure orchestration — no DB writes, no logging side effects. The caller
 * decides whether to dedup, persist, or short-circuit on noise.
 */
export async function fetchMails(
  source: MailSource,
  since: Date | undefined,
): Promise<FetchResult> {
  const { parsed, errors } = await source.fetch(since)
  const prepared = parsed.map((meta) => ({
    meta,
    noise: shouldSkipByHeaders(meta.headers),
  }))
  return { prepared, errors }
}
