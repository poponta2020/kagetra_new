/**
 * mail-inbox-mailer: 既存イベント結びつけシートの「リンク許容条件」を
 * UI クエリ (loadLinkableEvents) と Server Action (linkMailToEvent) 双方で
 * 共有するための helper。
 *
 * 要件 §3.1.6 (Codex r5 should-fix): UI が「cancelled 除外 / 開催日が過去 30 日
 * 以降」で候補を絞っていても、Server Action 側で event の存在しか見ないと、
 * 画面表示後に status が cancelled に変わった場合や Server Action を直接
 * 叩かれた場合に許容範囲外のイベントへ紐付けられてしまう。条件をここに
 * 一本化し、サーバー側でも同じ判定を回す。
 */

import type { EventStatus } from '@kagetra/shared/types'

/** 「過去 30 日以内」cutoff の YYYY-MM-DD 文字列を返す（JST 基準）。 */
export function linkableEventCutoffStr(now: Date = new Date()): string {
  const todayJst = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
  )
  const cutoff = new Date(todayJst.getTime() - 30 * 24 * 3600 * 1000)
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
}

/**
 * Server Action 側で event 行が「リンク候補に出してよい状態か」を判定する。
 * UI の loadLinkableEvents と同じ条件: cancelled でないこと + 開催日が
 * cutoff 以降であること。`undefined` 返却なら OK、文字列ならエラーメッセージ。
 */
export function validateLinkableEvent(
  // draft 廃止: status は EventStatus（published/cancelled/done）。
  event: { eventDate: string; status: EventStatus },
  cutoffStr: string,
): string | undefined {
  if (event.status === 'cancelled') {
    return 'キャンセル済みのイベントには紐付けできません'
  }
  if (event.eventDate < cutoffStr) {
    return 'リンク候補の範囲外（過去 30 日より古い）のイベントです'
  }
  return undefined
}
