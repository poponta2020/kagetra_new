import type { entryGroupPaymentReports } from '@kagetra/shared/schema'
import {
  buildLifecycleMessage,
  formatFeeAmount,
  formatUnknownGradeNote,
} from '@/lib/event-lifecycle-notify'

/**
 * payment-receipt-broadcast タスク3: 支払報告の LINE 本文の組み立て（要件 §3.2.4-13）。
 *
 * DB を読まない純関数。金額の決定（`resolvePaymentReportAmount`）は呼び出し側の仕事で、
 * ここは決まった値から文言を組むだけ。
 *
 * 証憑0枚（`receiptCount === 0`）のときは既存の「支払済にする」と**完全に同一の文面**
 * （`buildLifecycleMessage('payment_paid', …)`）を返す（AC-2 の回帰）。金額が出せない
 * とき（`source === 'none'` または `amountJpy == null`）も同じ固定文言のみ（§3.2.4-13）。
 */

type AmountSource = (typeof entryGroupPaymentReports.$inferInsert)['amountSource']

export interface PaymentReportMessageInput {
  amountJpy: number | null
  source: AmountSource
  unknownGradeCount: number
  /** 添える証憑の枚数。0 のときは現行の固定文言そのまま（AC-2 の回帰）。 */
  receiptCount: number
}

/** 証憑0枚・金額なしのときに使う固定文言（既存の完了通知と正本を二重化しない）。 */
function fixedMessage(): string {
  return buildLifecycleMessage('payment_paid', { title: '' })
}

export function buildPaymentReportMessage(input: PaymentReportMessageInput): string {
  // AC-2: 証憑0枚は現行と完全に同一の文面（金額行・確認依頼文も出さない）。
  if (input.receiptCount === 0) return fixedMessage()

  // §3.2.4-13: 金額が出せないときも固定文言のみ（画像は別途送られる）。
  if (input.source === 'none' || input.amountJpy == null) return fixedMessage()

  const lines = [fixedMessage(), '', `景虎上の想定金額は ${formatFeeAmount(input.amountJpy)} です。`]

  // AC-11: 未算入注記が付くのは金額をその場集計（tally）で出したときだけ。
  if (input.source === 'tally' && input.unknownGradeCount > 0) {
    const note = formatUnknownGradeNote(input.unknownGradeCount)
    if (note) lines.push(note)
  }

  lines.push('添付の明細と金額が一致しているかご確認ください。')

  return lines.join('\n')
}
