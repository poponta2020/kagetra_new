import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { loadConfig } from '../config.js'

/**
 * Single parsed mail metadata produced by either the live IMAP path or the
 * mock path used in `--mock-imap` runs and unit tests.
 *
 * `imapUid` and `imapBox` are nullable for the mock fixture path (no real UID
 * exists). Pre-filter input keys are normalised to lowercase already so
 * downstream filters can do case-insensitive lookups without extra work.
 */
export interface ParsedMailMeta {
  messageId: string
  fromAddress: string
  fromName: string | null
  toAddresses: string[]
  /**
   * RFC 5322 Subject. Optional — mails may legitimately omit it (and the DB
   * column is nullable). UI / persistence layers handle null explicitly so we
   * don't introduce a string fallback here.
   */
  subject: string | null
  receivedAt: Date
  bodyText: string | null
  bodyHtml: string | null
  /** lowercased header name → first occurrence value (string). */
  headers: Record<string, string>
  imapUid: number | null
  imapBox: string | null
}

/**
 * Per-mail failure surfaced from the fetch path. We carry whatever identifying
 * fields IMAP gives us before parse — UID, mailbox, and the envelope-level
 * Message-ID — so the worker can log a meaningful trail even when the RFC 822
 * source is unparseable.
 */
export interface FetchedMailError {
  imapUid: number | null
  imapBox: string | null
  /** envelope.messageId from IMAP, when available; null on the fixture path. */
  envelopeMessageId: string | null
  reason: string
  stage: 'parse_failed' | 'fetch_failed'
}

export interface FetchSinceResult {
  parsed: ParsedMailMeta[]
  errors: FetchedMailError[]
}

/**
 * Thin wrapper over imapflow 1.3.x. We expose only the operations the worker
 * uses (connect / open INBOX / fetch by SearchObject / disconnect) so the
 * fetcher layer doesn't need to know about IMAP semantics directly.
 *
 * imapflow 1.x API reference:
 *   - constructor(options) — takes host/port/secure/auth
 *   - connect() / logout() — TCP lifecycle
 *   - mailboxOpen(path) — selects INBOX before fetch/search
 *   - search(SearchObject, { uid: true }) — returns UID array
 *   - fetch(range, FetchQueryObject) — async iterator of FetchMessageObject
 *
 * We pass `source: true` to fetch the full RFC 822 message and run
 * `mailparser.simpleParser` over the buffer. This is more robust than letting
 * imapflow parse parts piecemeal — header values, multipart bodies, and CTE
 * decoding are all handled in one pass.
 */
export class ImapClient {
  private flow: ImapFlow | null = null

  async connect(): Promise<void> {
    const config = loadConfig()
    if (!config.YAHOO_IMAP_USER || !config.YAHOO_IMAP_APP_PASSWORD) {
      throw new Error(
        'YAHOO_IMAP_USER / YAHOO_IMAP_APP_PASSWORD are required for live IMAP. Use --mock-imap to skip.',
      )
    }
    const flow = new ImapFlow({
      host: config.YAHOO_IMAP_HOST,
      port: config.YAHOO_IMAP_PORT,
      secure: true,
      auth: {
        user: config.YAHOO_IMAP_USER,
        pass: config.YAHOO_IMAP_APP_PASSWORD,
      },
      logger: false,
    })
    await flow.connect()
    this.flow = flow
  }

  async disconnect(): Promise<void> {
    if (this.flow) {
      await this.flow.logout().catch(() => undefined)
      this.flow = null
    }
  }

  /**
   * Fetch all messages received on/after `since` from INBOX.
   *
   * IMAP `SEARCH SINCE` is date-granular (server compares Date header truncated
   * to day), so we deliberately over-fetch and re-filter post-parse using
   * `receivedAt` (sourced from `internalDate`). This honours sub-day cutoffs
   * like `--since=2026-04-12T15:00:00+09:00`.
   *
   * Per-mail parse failures are isolated: one bad message bumps `errors` and
   * the loop moves on, so a single malformed mail can't stall the entire batch.
   */
  async fetchSince(since: Date | undefined, mailbox = 'INBOX'): Promise<FetchSinceResult> {
    if (!this.flow) throw new Error('ImapClient: not connected')
    await this.flow.mailboxOpen(mailbox)
    const searchQuery = since ? { since } : { all: true }
    const parsed: ParsedMailMeta[] = []
    const errors: FetchedMailError[] = []
    for await (const msg of this.flow.fetch(searchQuery, {
      uid: true,
      envelope: true,
      source: true,
      headers: true,
      internalDate: true,
    })) {
      const uid = typeof msg.uid === 'number' ? msg.uid : null
      const envelopeMessageId = normalizeEnvelopeMessageId(msg.envelope?.messageId)
      try {
        const meta = await parseFetched(msg, mailbox)
        if (!meta) {
          errors.push({
            imapUid: uid,
            imapBox: mailbox,
            envelopeMessageId,
            reason: !msg.source
              ? 'fetch returned no RFC 822 source buffer'
              : 'Message-ID header missing — cannot key for de-dup',
            stage: 'parse_failed',
          })
          continue
        }
        if (since && meta.receivedAt < since) continue
        parsed.push(meta)
      } catch (err) {
        errors.push({
          imapUid: uid,
          imapBox: mailbox,
          envelopeMessageId,
          reason: err instanceof Error ? err.message : String(err),
          stage: 'parse_failed',
        })
      }
    }
    return { parsed, errors }
  }
}

/**
 * Parse one imapflow FetchMessageObject (which carries the RFC 822 source as
 * a Buffer) into our normalised metadata shape. Returns `null` when the
 * message has no source buffer (which shouldn't happen with `source: true`).
 */
async function parseFetched(
  msg: FetchMessageObject,
  mailbox: string,
): Promise<ParsedMailMeta | null> {
  if (!msg.source) return null
  const parsed = await simpleParser(msg.source)
  const internalDate = msg.internalDate instanceof Date ? msg.internalDate : null
  return parsedMailToMeta(parsed, msg.uid ?? null, mailbox, internalDate)
}

/**
 * Public helper so fixture-based tests / `--mock-imap` runs can produce the
 * same `ParsedMailMeta` shape without touching IMAP.
 */
export async function parseEmlBuffer(
  source: Buffer,
  imapUid: number | null = null,
  imapBox: string | null = null,
  internalDate: Date | null = null,
): Promise<ParsedMailMeta | null> {
  const parsed = await simpleParser(source)
  return parsedMailToMeta(parsed, imapUid, imapBox, internalDate)
}

/**
 * Convert mailparser.ParsedMail → ParsedMailMeta. Skips mails whose
 * Message-ID is missing because de-dup keys off of it; without an ID we have
 * no safe primary key for `mail_messages.message_id`.
 *
 * `receivedAt` prefers IMAP `internalDate` (when supplied) over the RFC 5322
 * `Date` header. The Date header is sender-controlled and can be wildly off
 * for late or auto-generated mails, while `internalDate` reflects when the
 * Yahoo!IMAP server received it — which is the order the inbox UI cares about.
 */
function parsedMailToMeta(
  parsed: import('mailparser').ParsedMail,
  imapUid: number | null,
  imapBox: string | null,
  internalDate: Date | null,
): ParsedMailMeta | null {
  const messageId = parsed.messageId?.trim()
  if (!messageId) return null

  const fromValue = parsed.from?.value?.[0]
  const fromAddress = fromValue?.address ?? ''
  const fromName = fromValue?.name && fromValue.name.length > 0 ? fromValue.name : null

  const toAddresses = collectAddresses(parsed.to)

  const subject = parsed.subject && parsed.subject.length > 0 ? parsed.subject : null
  const receivedAt = internalDate ?? parsed.date ?? new Date()
  const bodyText = typeof parsed.text === 'string' ? parsed.text : null
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : null

  const headers: Record<string, string> = {}
  for (const [key, value] of parsed.headers.entries()) {
    headers[key.toLowerCase()] = stringifyHeaderValue(value)
  }

  return {
    messageId,
    fromAddress,
    fromName,
    toAddresses,
    subject,
    receivedAt,
    bodyText,
    bodyHtml,
    headers,
    imapUid,
    imapBox,
  }
}

function collectAddresses(
  field: import('mailparser').AddressObject | import('mailparser').AddressObject[] | undefined,
): string[] {
  if (!field) return []
  const arr = Array.isArray(field) ? field : [field]
  return arr.flatMap((obj) =>
    obj.value.map((v) => v.address).filter((addr): addr is string => Boolean(addr)),
  )
}

/**
 * Headers can be string / Date / Address / StructuredHeader, but for pre-filter
 * purposes we only need the visible textual representation (e.g. the
 * `Auto-Submitted: auto-generated` value, or the stringified address list of
 * `List-Unsubscribe`). For Date/Address objects we fall back to `String(...)`.
 */
function stringifyHeaderValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => stringifyHeaderValue(v)).join(', ')
  if (value && typeof value === 'object' && 'text' in value && typeof (value as { text: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  if (value && typeof value === 'object' && 'value' in value && typeof (value as { value: unknown }).value === 'string') {
    return (value as { value: string }).value
  }
  return String(value ?? '')
}

/**
 * Envelope.messageId can be string, undefined, or (rarely) a non-string.
 * Normalise to `string | null` so callers don't have to re-check.
 */
function normalizeEnvelopeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
