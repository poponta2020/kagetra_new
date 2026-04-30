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
  /**
   * Canonical count of newly created drafts for this run. This is the value
   * surfaced as "N 件" in the headline — taken from the pipeline summary, not
   * derived from `previewSubjects.length`, so a run that creates 11 drafts
   * but only previews 10 still reads as "11 件".
   */
  totalCount: number
  /**
   * Subject preview list. Trimmed to the top N for display (overflow becomes
   * `他 M 件`). May be empty if the post-hoc subject lookup failed — the
   * headline still fires so the admin doesn't miss the new-draft signal.
   */
  previewSubjects: string[]
}

/**
 * Build the "新規大会案内 N 件" notification body. The pipeline only calls this
 * when totalCount >= 1, so a 0 count is a programmer error and we throw
 * rather than emit a misleading "0 件" message that would still ping the
 * admin. An empty `previewSubjects` is *not* an error — the headline alone is
 * still useful, and the alternative (silent skip) would hide a real signal
 * just because subject lookup is brittle.
 */
export function buildNewDraftsMessage({
  totalCount,
  previewSubjects,
}: NewDraftsMessageInput): string {
  if (totalCount <= 0) {
    throw new Error('buildNewDraftsMessage requires totalCount >= 1')
  }
  const lines: string[] = [`📬 新規大会案内 ${totalCount} 件を取り込みました`]
  const head = previewSubjects.slice(0, NEW_DRAFTS_TOP_LIMIT)
  for (const subject of head) {
    lines.push(`・${subject}`)
  }
  // `他 M 件` is computed against `totalCount` (the canonical figure), not
  // `previewSubjects.length` — so an 11-draft run with only 10 known subjects
  // still says "他 6 件" relative to the top-5 preview.
  if (totalCount > NEW_DRAFTS_TOP_LIMIT && head.length > 0) {
    const overflow = totalCount - head.length
    if (overflow > 0) lines.push(`他 ${overflow} 件`)
  } else if (head.length === 0 && totalCount > 0) {
    // Subject lookup returned nothing (best-effort post-hoc query failed or
    // returned empty). Still record the count so the admin sees something.
    lines.push(`(件名取得に失敗 / ${totalCount} 件)`)
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
