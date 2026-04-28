/**
 * LINE notification message templates for the mail-worker.
 *
 * These functions are pure string builders — no I/O, no DB. The pipeline
 * (PR5 Phase 3) calls them from `pushSystemNotification(db, message)` when a
 * cron run produces new drafts or when consecutive failure thresholds trip.
 *
 * Format choices come from the PR5 grill-me (2026-04-28):
 *   - Q4: top 5 subjects listed, surplus collapsed to `他 M 件`
 *   - Common footer `→ /admin/mail-inbox` so the admin can deep-link from LINE
 *   - Error-message tail truncated to 200 Unicode code points (not UTF-16 code
 *     units) so combining characters and astral-plane glyphs (rare in IMAP
 *     errors but cheap to handle correctly) don't cut mid-character.
 */

const INBOX_LINK = '→ /admin/mail-inbox'
const NEW_DRAFTS_TOP_LIMIT = 5
const ERROR_DETAIL_MAX = 200

export interface NewDraftsMessageInput {
  drafts: { subject: string }[]
}

/**
 * Build the "新規大会案内 N 件" notification body. The pipeline only calls this
 * when N >= 1, so a 0-length input is a programmer error and we throw rather
 * than emit a misleading "0 件" message that would still ping the admin.
 */
export function buildNewDraftsMessage({ drafts }: NewDraftsMessageInput): string {
  if (drafts.length === 0) {
    throw new Error('buildNewDraftsMessage requires at least one draft')
  }
  const total = drafts.length
  const lines: string[] = [`📬 新規大会案内 ${total} 件を取り込みました`]
  const head = drafts.slice(0, NEW_DRAFTS_TOP_LIMIT)
  for (const draft of head) {
    lines.push(`・${draft.subject}`)
  }
  if (total > NEW_DRAFTS_TOP_LIMIT) {
    const overflow = total - NEW_DRAFTS_TOP_LIMIT
    lines.push(`他 ${overflow} 件`)
  }
  lines.push(INBOX_LINK)
  return lines.join('\n')
}

export interface ErrorMessageInput {
  kind: 'imap' | 'ai'
  recentRuns: number
  lastError: string
}

/**
 * Build the consecutive-failure alert body. `kind` selects the headline; the
 * `lastError` payload is appended on its own line, truncated to keep LINE
 * messages well under the 5,000-character push limit even when the upstream
 * error includes a stack trace or a Yahoo IMAP server response dump.
 *
 * Truncation is by Unicode code point (Array.from(...).length), not by
 * `string.length`, so a Japanese error blurb that lands exactly on the
 * boundary doesn't get an orphaned high surrogate appended.
 */
export function buildErrorMessage({
  kind,
  recentRuns,
  lastError,
}: ErrorMessageInput): string {
  const headline =
    kind === 'imap'
      ? `⚠️ メール取り込みが連続 ${recentRuns} 回 IMAP エラーで失敗しています`
      : `⚠️ AI 抽出が連続 ${recentRuns} 件失敗しています`
  const truncatedDetail = truncateByCodePoint(lastError, ERROR_DETAIL_MAX)
  return [headline, truncatedDetail, INBOX_LINK].join('\n')
}

function truncateByCodePoint(input: string, max: number): string {
  // Array spread iterates code points (handles surrogate pairs correctly), so
  // a string of, say, 199 Japanese chars + one emoji counts as 200 not 201.
  const codepoints = Array.from(input)
  if (codepoints.length <= max) return input
  return codepoints.slice(0, max).join('') + '…'
}
