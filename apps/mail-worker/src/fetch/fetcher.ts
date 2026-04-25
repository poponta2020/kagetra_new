import { ImapClient, parseEmlBuffer, type ParsedMailMeta } from './imap-client.js'
import { shouldSkipByHeaders } from './pre-filter.js'

/**
 * Pluggable source of raw mails for the fetcher. The IMAP path uses
 * `LiveMailSource`; tests and `--mock-imap` use `FixtureMailSource` with eml
 * buffers.
 */
export interface MailSource {
  fetch(since: Date | undefined): Promise<ParsedMailMeta[]>
  close(): Promise<void>
}

/**
 * Live IMAP source — connects to Yahoo!IMAP, opens INBOX, fetches messages
 * received on or after `since`. Always disconnects on close.
 */
export class LiveMailSource implements MailSource {
  private client = new ImapClient()
  private connected = false

  async fetch(since: Date | undefined): Promise<ParsedMailMeta[]> {
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

  async fetch(since: Date | undefined): Promise<ParsedMailMeta[]> {
    const out: ParsedMailMeta[] = []
    for (const entry of this.entries) {
      const parsed = await parseEmlBuffer(
        entry.source,
        entry.imapUid ?? null,
        entry.imapBox ?? 'INBOX',
      )
      if (!parsed) continue
      if (since && parsed.receivedAt < since) continue
      out.push(parsed)
    }
    return out
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
  const mails = await source.fetch(since)
  const prepared = mails.map((meta) => ({
    meta,
    noise: shouldSkipByHeaders(meta.headers),
  }))
  return { prepared }
}
