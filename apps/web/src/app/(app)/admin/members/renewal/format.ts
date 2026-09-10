/**
 * annual-registration-renewal タスク9（S2）の日付表示ヘルパー。
 *
 * `lib/jst-date.ts` は `YYYY-MM-DD` 文字列専用で、`membership_renewals` の
 * `started_at`/`completed_at`（timestamp）や回答日時はここでは Date で
 * 届くため、`Asia/Tokyo` を明示した `Intl.DateTimeFormat` で別に持つ
 * （既存 `settings/club-line-group/ClubLineGroupForm.tsx` の
 * `formatTaskTime`/`formatCapturedDate` と同じ方針）。
 */

export function formatJstMonthDay(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(date)
}

export function formatJstYmd(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(date)
}
