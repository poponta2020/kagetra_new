/**
 * Asia/Tokyo の "今日" を `YYYY-MM-DD` 文字列で返す。
 *
 * r-final-19 should_fix: `Date.now()` 直系 / `new Date().toISOString()`
 * は UTC 基準なので、04:00 JST = 19:00 UTC のように 1 日ずれる。
 * events.event_date や release-expired-broadcasts.ts が JST カレンダーで
 * 動いているため、admin 画面や candidate event 絞り込みでも同じ helper
 * を使って表示・判定を揃える。
 *
 * `sv-SE` ロケールは ISO 風 YYYY-MM-DD を返す慣用テクニック。
 * `Asia/Tokyo` 固定なので、JST 以外で動かしてもサーバ時刻に依存せず
 * 日本のカレンダー基準で計算できる。
 */
export function todayInJst(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/**
 * `YYYY-MM-DD` 文字列同士の差分日数を返す。
 * a より b が後なら正、a が後なら負。UTC ベースで Date オブジェクトを
 * 作るので、文字列のカレンダー差分が素直に出る。
 */
export function diffDays(a: string, b: string): number {
  // `2026-05-31` をそのまま new Date すると UTC 0:00:00 として解釈される。
  // 同じ規則で計算した a と b の差分は時差の影響を受けない。
  const aMs = Date.parse(`${a}T00:00:00Z`)
  const bMs = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return Number.NaN
  return Math.round((bMs - aMs) / 86_400_000)
}

/**
 * `YYYY-MM-DD` に `days` 日加算した文字列を返す。
 */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) return date
  const next = new Date(ms + days * 86_400_000)
  return next.toISOString().slice(0, 10)
}
