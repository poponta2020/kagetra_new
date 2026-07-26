/**
 * Shared date/time display helpers used across the events feature
 * (`/events` list, event detail, entry flow, grade-group broadcast, etc.).
 *
 * `formatEventDate` was originally local to the `/events` list
 * (`event-list-utils.ts`) and is moved here so the detail screen and the
 * grade-group broadcast text builder can share it without a lib→app reverse
 * import. `formatFlowDate` / `formatDateTimeFull` / `formatDateTimeShort` add
 * the other date/time formats the detail redesign needs.
 * docs/features/event-detail-redesign/implementation-plan.md タスク1。
 */

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `YYYY-MM-DD` → `M/D(曜)` (no zero-padding, weekday in Japanese).
 * e.g. `2026-07-12` → `7/12(日)`. The weekday is computed from the calendar
 * date via a UTC construction so it's timezone-independent and deterministic.
 * Returns the input unchanged if it isn't a `YYYY-MM-DD` string (defensive).
 */
export function formatEventDate(eventDate: string): string {
  const m = DATE_RE.exec(eventDate)
  if (!m) return eventDate
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month}/${day}(${WEEKDAY_JA[dow]})`
}

/**
 * 申込フロー用。`YYYY-MM-DD` → `M/D`（曜日なし・ゼロ埋めなし）。
 * `null`/`undefined`（未定日程）は `未定`。`YYYY-MM-DD` でない不正入力は
 * `formatEventDate` と同じ防御方針で入力をそのまま返す。
 */
export function formatFlowDate(date: string | null | undefined): string {
  if (date == null) return '未定'
  const m = DATE_RE.exec(date)
  if (!m) return date
  const month = Number(m[2])
  const day = Number(m[3])
  return `${month}/${day}`
}

/** `value` を Date へ正規化。null/undefined/不正値は null。 */
function parseTimestamp(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * `timeZone: 'Asia/Tokyo'` を明示した年月日時分パーツ。本番ホストの TZ に
 * 依存しないための唯一のフォーマット経路（`toLocaleString` の既定書式には
 * 頼らない — `ja-JP` は環境によって記号や桁数が揺れる）。
 */
function tokyoParts(d: Date): {
  year: string
  month: string
  day: string
  hour: string
  minute: string
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const map: Partial<Record<string, string>> = {}
  for (const part of parts) map[part.type] = part.value
  return {
    year: map.year ?? '',
    month: map.month ?? '',
    day: map.day ?? '',
    hour: map.hour ?? '',
    minute: map.minute ?? '',
  }
}

/**
 * 運用ログ（連携日時等）用。`YYYY/MM/DD HH:mm`（JST 固定・ゼロ埋め）。
 * `null`/`undefined`/不正値（`Invalid Date`）は `—`。
 */
export function formatDateTimeFull(value: Date | string | null | undefined): string {
  const d = parseTimestamp(value)
  if (!d) return '—'
  const { year, month, day, hour, minute } = tokyoParts(d)
  return `${year}/${month}/${day} ${hour}:${minute}`
}

/**
 * 配信履歴・発行日用。`M/D HH:mm`（年なし・JST 固定・月日はゼロ埋めなし・
 * 時分はゼロ埋め）。`null`/`undefined`/不正値（`Invalid Date`）は `—`。
 */
export function formatDateTimeShort(value: Date | string | null | undefined): string {
  const d = parseTimestamp(value)
  if (!d) return '—'
  const { month, day, hour, minute } = tokyoParts(d)
  return `${Number(month)}/${Number(day)} ${hour}:${minute}`
}
