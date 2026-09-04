import { describe, expect, it } from 'vitest'
import { buildLifecycleMessage } from '@/lib/event-lifecycle-notify'
import { buildPaymentReportMessage } from './payment-report-message'

/**
 * payment-receipt-broadcast タスク3: 支払報告メッセージの組み立て（要件 §3.2.4-13）。
 * DB を読まない純関数のテスト。
 */
describe('buildPaymentReportMessage', () => {
  it('証憑0枚のときは buildLifecycleMessage(payment_paid) と文字列一致する（AC-2 回帰）', () => {
    const result = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'tally',
      unknownGradeCount: 2,
      receiptCount: 0,
    })
    expect(result).toBe(buildLifecycleMessage('payment_paid', { title: '' }))
  })

  it('証憑ありでも金額が算出できない（source=none）ときは固定文言のみ（AC-10）', () => {
    const result = buildPaymentReportMessage({
      amountJpy: null,
      source: 'none',
      unknownGradeCount: 0,
      receiptCount: 1,
    })
    expect(result).toBe(buildLifecycleMessage('payment_paid', { title: '' }))
  })

  it('amountJpy が null なら source を問わず固定文言のみ', () => {
    const result = buildPaymentReportMessage({
      amountJpy: null,
      source: 'tally',
      unknownGradeCount: 0,
      receiptCount: 1,
    })
    expect(result).toBe(buildLifecycleMessage('payment_paid', { title: '' }))
  })

  it('振込連絡由来の金額（payment_notice）は級未設定注記を付けない（AC-8/AC-11）', () => {
    const result = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'payment_notice',
      // 振込連絡由来では常に 0 のはずだが、万一非0が渡っても注記しないことを確認する。
      unknownGradeCount: 2,
      receiptCount: 1,
    })
    expect(result).toBe(
      [
        '参加費の振り込みが完了しました。',
        '',
        '景虎上の想定金額は 12,500円 です。',
        '添付の明細と金額が一致しているかご確認ください。',
      ].join('\n'),
    )
    expect(result).not.toContain('級未設定')
  })

  it('その場集計（tally）で未算入がいれば級未設定注記を付ける（AC-9/AC-11）', () => {
    const result = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'tally',
      unknownGradeCount: 2,
      receiptCount: 1,
    })
    expect(result).toBe(
      [
        '参加費の振り込みが完了しました。',
        '',
        '景虎上の想定金額は 12,500円 です。',
        '※級未設定 2名は未算入',
        '添付の明細と金額が一致しているかご確認ください。',
      ].join('\n'),
    )
  })

  it('その場集計（tally）でも未算入が0名なら注記を付けない', () => {
    const result = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'tally',
      unknownGradeCount: 0,
      receiptCount: 1,
    })
    expect(result).not.toContain('級未設定')
    expect(result).toBe(
      [
        '参加費の振り込みが完了しました。',
        '',
        '景虎上の想定金額は 12,500円 です。',
        '添付の明細と金額が一致しているかご確認ください。',
      ].join('\n'),
    )
  })

  it('金額は3桁区切りで整形される', () => {
    const result = buildPaymentReportMessage({
      amountJpy: 1_234_500,
      source: 'tally',
      unknownGradeCount: 0,
      receiptCount: 1,
    })
    expect(result).toContain('景虎上の想定金額は 1,234,500円 です。')
  })

  it('証憑が複数枚でも本文は receiptCount=0 との分岐だけで変わらない', () => {
    const a = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'tally',
      unknownGradeCount: 0,
      receiptCount: 1,
    })
    const b = buildPaymentReportMessage({
      amountJpy: 12_500,
      source: 'tally',
      unknownGradeCount: 0,
      receiptCount: 3,
    })
    expect(a).toBe(b)
  })
})
