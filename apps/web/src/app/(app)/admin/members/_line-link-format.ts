/**
 * Formatters for the LINE link audit fields (`line_linked_at` /
 * `line_linked_method`). Shared between the admin members list and the
 * per-member edit page so the two views stay consistent.
 */

export type LineLinkMethod = 'self_identify' | 'admin_link' | 'account_switch'

/**
 * Format `line_linked_at` as `YYYY-MM-DD HH:mm` in the server's local time
 * (Docker container is UTC; Lightsail timezone is configured separately).
 * Seconds are omitted — audit granularity of one minute is enough, and it
 * keeps the table column narrow on mobile.
 */
export function formatLinkedAt(d: Date | null): string {
  if (!d) return '未紐付け'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Render the three enum values as short Japanese labels. Returns `'—'` for
 * null (not yet linked) so the column never shows an empty cell.
 */
export function formatLinkMethod(m: LineLinkMethod | null): string {
  if (m === 'self_identify') return '自己申告'
  if (m === 'admin_link') return '管理者'
  if (m === 'account_switch') return '切替'
  return '—'
}
