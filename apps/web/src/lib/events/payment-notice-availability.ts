import type { Grade } from '@kagetra/shared/types'

/**
 * payment-notice-availability: 振込連絡（line-bot-message-revamp §3.3）を
 * **送れるかどうか**と、送れないときの**理由**を決める純関数。
 *
 * DB を触らない。グループページ（`settled` 判定あり）とメール処理画面
 * （`settled` 判定なし・§3.3.5.1）が同じ優先順位で判定するために、
 * 判定そのものをここ1箇所に置く。
 *
 * ★**client から import される**（`MailProcessForm` が理由を表示する）ので、
 * `server-only` / `@kagetra/shared/schema` / `drizzle-orm` を**型 import も含めて**
 * 持ち込まない。この違反は eslint / vitest / check-types のどれでも検知できず
 * `next build` で初めて壊れる（requirements §6）。
 *
 * ★日本語ラベルもここに置く。サーバー側モジュールへ置くと UI が文言を二重定義し、
 * §3.3.5.2 の表と静かに食い違う。
 */

/** 送信できない理由。§3.3.5.2 の表の**上から順に**評価する。 */
export type PaymentNoticeUnavailableReason =
  | 'not_settled'
  | 'not_applied'
  | 'onsite'
  | 'paid'
  | 'no_line_binding'
  | 'no_priced_grade'

/** 画面に1行で出す理由（§3.3.5.2 の表の右列）。 */
export const PAYMENT_NOTICE_UNAVAILABLE_MESSAGES: Record<
  PaymentNoticeUnavailableReason,
  string
> = {
  not_settled: '確定名簿がまだ出ていません',
  not_applied: 'まだ申込済みになっていません',
  onsite: '現地払いのため振込は不要です',
  paid: '支払済みです',
  no_line_binding: 'LINE グループが紐付いていません',
  no_priced_grade: '参加費を算出できる級がありません（非公認・団体戦のみ）',
}

export type PaymentNoticeAvailability =
  | { ok: true }
  | { ok: false; reason: PaymentNoticeUnavailableReason; message: string }

/**
 * 判定に使う1日ぶんの状態。**中止の日は呼び出し側で除いてから渡す**
 * （§3.3.5.2「判定は非中止の日だけを見て」）。
 *
 * 列挙値は `@kagetra/shared/schema` の enum と同じだが、client 経路へ schema を
 * 持ち込めないので文字列リテラル型で受ける。
 */
export interface PaymentNoticeDaySignal {
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  /** `null` = 未設定（支払い通知なし）。`'advance'` 以外は振込対象にならない。 */
  paymentType: 'advance' | 'onsite' | null
  paymentStatus: 'unpaid' | 'paid'
}

export interface PaymentNoticeAvailabilityInput {
  /** 確定名簿あり（`confirmed-roster.ts` の判定結果）。 */
  settled: boolean
  /**
   * `settled` を条件に含めるか。グループページは `true`、メール処理画面は `false`
   * （処理の実行そのものがシグナル③を成立させるので、処理前は必ず false になる・§7-6）。
   */
  requireSettled: boolean
  /** 非中止の日だけ。 */
  days: readonly PaymentNoticeDaySignal[]
  hasLineBinding: boolean
  /** 単価を解決できる級が1つでもあるか（`resolveEntryFee` の結果から）。 */
  hasPricedGrade: boolean
}

/** 対象日（申込済 ∧ 事前払い ∧ 未振込）だけを残す。金額の母集団と同じ集合。 */
export function selectDueDays<T extends PaymentNoticeDaySignal>(
  days: readonly T[],
): T[] {
  return days.filter(
    (d) =>
      d.entryStatus === 'applied' && d.paymentType === 'advance' && d.paymentStatus === 'unpaid',
  )
}

/**
 * 送信可否を判定する。**最初に当たった理由**を返す（§3.3.5.2 の優先順位）。
 *
 * 順序を変えてはならない — 「未申込」と「現地払い」が同時に成り立つ混在グループで
 * どちらを出すかは、管理者が次に取る行動（申込状態を進める／何もしない）を決める。
 */
export function resolvePaymentNoticeAvailability(
  input: PaymentNoticeAvailabilityInput,
): PaymentNoticeAvailability {
  const deny = (reason: PaymentNoticeUnavailableReason): PaymentNoticeAvailability => ({
    ok: false,
    reason,
    message: PAYMENT_NOTICE_UNAVAILABLE_MESSAGES[reason],
  })

  if (input.requireSettled && !input.settled) return deny('not_settled')

  const applied = input.days.filter((d) => d.entryStatus === 'applied')
  if (applied.length === 0) return deny('not_applied')

  // `paymentType` は nullable（未設定 = 支払い通知なし）。`'advance'` 以外はすべて
  // 「振込が要らない日」としてこの区分に落ちる（§3.3.5.2 の表の2行目）。
  const advance = applied.filter((d) => d.paymentType === 'advance')
  if (advance.length === 0) return deny('onsite')

  const unpaid = advance.filter((d) => d.paymentStatus === 'unpaid')
  if (unpaid.length === 0) return deny('paid')

  if (!input.hasLineBinding) return deny('no_line_binding')
  if (!input.hasPricedGrade) return deny('no_priced_grade')

  return { ok: true }
}

/** 級の正順（A→E）。行の並び順の唯一の基準。 */
export const PAYMENT_NOTICE_GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']
