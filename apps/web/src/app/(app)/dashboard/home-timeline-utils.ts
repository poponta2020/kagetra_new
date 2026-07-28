/**
 * ホーム「会の出場予定」の表示用純関数。
 *
 * `Date.now()` を呼ばない —— サーバーが JST の `todayStr` を渡し、クライアントは
 * それを使って同じ結果を描く（hydration mismatch を避ける。`event-list-utils.ts`・
 * `entry-board-utils.ts` と同じ方針）。
 */

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

/** 出場者リストの確度ラベル。 */
export function confidenceLabel(confidence: 'confirmed' | 'hoped'): string {
  return confidence === 'confirmed' ? '確定' : '希望'
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
