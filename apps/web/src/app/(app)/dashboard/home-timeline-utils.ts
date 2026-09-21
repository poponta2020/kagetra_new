/**
 * ホーム「会の出場予定」の表示用純関数。
 *
 * `Date.now()` を呼ばない —— サーバーが JST の `todayStr` を渡し、クライアントは
 * それを使って同じ結果を描く（hydration mismatch を避ける。`event-list-utils.ts`・
 * `entry-board-utils.ts` と同じ方針）。
 */

// type-only import に限る —— このモジュールはクライアント（HomeTimeline.tsx）からも読まれる。
import type { PillTone } from '@/components/ui/pill'
import type { HomeEventStatus } from './home-timeline-types'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

/**
 * タイムライン左端の日付レール用に `YYYY-MM-DD` を「M/D」と「曜」へ分解する。
 * `formatEventDate`（`M/D(曜)` の 1 行表記）は 2 行に割れないためこちらを使う。
 * 不正入力は防御的に入力そのまま + 曜日なしを返す。
 */
export function splitTimelineDate(eventDate: string): {
  md: string
  weekday: string
} {
  const m = DATE_RE.exec(eventDate)
  if (!m) return { md: eventDate, weekday: '' }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { md: `${month}/${day}`, weekday: WEEKDAY_JA[dow] ?? '' }
}

/** {@link deriveHomeEventStatus} の入力。DB の値をそのまま詰める。 */
export interface HomeEventStatusInput {
  /**
   * 申込グループが「確定名簿あり」か。`@/lib/events/confirmed-roster` の
   * `loadConfirmedRosterStates` の `settled`（判定の正典）をそのまま渡す。
   * ここで4材料を組み直さない。
   */
  rosterSettled: boolean
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  internalDeadline: string | null
  entryDeadline: string | null
}

/**
 * 大会ステータスを導出する（requirements §3.2.1）。上から順に最初に当てはまったもの:
 * 名簿確定 → 申込済 → 締切済（基準締切 < 今日） → 参加受付中。
 *
 * - 基準締切 = 会内締切 ?? 申込締切（`entry-board-utils.baseDeadlineOf` と同じ規約）。
 *   締切当日は「参加受付中」で、翌日から「締切済」（`classify` の `base >= todayStr` と同じ境界）
 * - `not_applying` は `not_applied` と同じく日付どおりに判定する（新しいステータスを作らない）
 */
export function deriveHomeEventStatus(
  input: HomeEventStatusInput,
  todayStr: string,
): HomeEventStatus {
  if (input.rosterSettled) return 'roster_confirmed'
  if (input.entryStatus === 'applied') return 'applied'
  const base = input.internalDeadline ?? input.entryDeadline
  if (base != null && base < todayStr) return 'closed'
  return 'open'
}

/**
 * ステータスピルの文言とトーン（requirements §3.2.4）。既存の `Pill` トーンだけを使う。
 * 朱（`accent` / `danger`）は未回答アラート専用なのでここでは使わない（design-spec §3）。
 */
export const HOME_EVENT_STATUS_PILL: Record<
  HomeEventStatus,
  { label: string; tone: PillTone }
> = {
  roster_confirmed: { label: '名簿確定', tone: 'brand' },
  applied: { label: '申込済', tone: 'info' },
  open: { label: '参加受付中', tone: 'warn' },
  closed: { label: '締切済', tone: 'neutral' },
}

/**
 * 未回答アラートのカウントダウン文言。0 = 本日締切。
 * 締切超過（負値）はアラートの対象外なので想定しないが、防御的に「超過」を返す。
 */
export function alertCountdown(daysLeft: number): string {
  if (daysLeft < 0) return `${-daysLeft}日超過`
  if (daysLeft === 0) return '本日締切'
  return `あと${daysLeft}日`
}

/**
 * タイムラインの初期表示件数。これを超える分は「もっと見る」で展開する
 * （ホームを 1 画面に収めるため。ユーザー選択＝「直近だけ＋もっと見る」）。
 */
export const INITIAL_VISIBLE_COUNT = 4
