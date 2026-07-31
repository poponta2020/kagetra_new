import { describe, expect, it } from 'vitest'
import {
  formatPaymentDeadline,
  normalizePaymentDeadline,
  paymentDeadlineKindFromPayload,
  PAYMENT_DEADLINE_KIND_LABELS,
} from './payment-deadline'

/**
 * 振込締切の「日付」と「状態」を整合させる正規化（AC-39 / AC-43）。
 * events の CHECK `(payment_deadline IS NOT NULL) = (payment_deadline_kind =
 * 'fixed')` を満たす組み合わせしか返さないことが、この関数の存在理由。
 */
describe('normalizePaymentDeadline', () => {
  it('AC-43: 日付があれば状態は必ず fixed になる（「後日連絡」のまま日付を入れても矛盾しない）', () => {
    expect(
      normalizePaymentDeadline({
        paymentDeadline: '2026-05-15',
        paymentDeadlineKind: 'later_notice',
      }),
    ).toEqual({ paymentDeadline: '2026-05-15', paymentDeadlineKind: 'fixed' })
  })

  it('AC-43: 日付が無いのに fixed が来たら unspecified へ落とす', () => {
    expect(
      normalizePaymentDeadline({ paymentDeadline: null, paymentDeadlineKind: 'fixed' }),
    ).toEqual({ paymentDeadline: null, paymentDeadlineKind: 'unspecified' })
  })

  it('日付が無く later_notice ならそのまま残る', () => {
    expect(
      normalizePaymentDeadline({
        paymentDeadline: null,
        paymentDeadlineKind: 'later_notice',
      }),
    ).toEqual({ paymentDeadline: null, paymentDeadlineKind: 'later_notice' })
  })

  it('状態が未指定なら unspecified に倒れる', () => {
    expect(normalizePaymentDeadline({})).toEqual({
      paymentDeadline: null,
      paymentDeadlineKind: 'unspecified',
    })
    expect(normalizePaymentDeadline({ paymentDeadline: '2026-05-15' })).toEqual({
      paymentDeadline: '2026-05-15',
      paymentDeadlineKind: 'fixed',
    })
  })

  it('未知の状態文字列は unspecified に倒す（推測で later_notice を選ばない）', () => {
    expect(
      normalizePaymentDeadline({ paymentDeadline: null, paymentDeadlineKind: '後日連絡' }),
    ).toEqual({ paymentDeadline: null, paymentDeadlineKind: 'unspecified' })
  })

  it('返り値は常に CHECK 制約を満たす', () => {
    const inputs = [
      { paymentDeadline: '2026-05-15', paymentDeadlineKind: 'fixed' },
      { paymentDeadline: '2026-05-15', paymentDeadlineKind: 'unspecified' },
      { paymentDeadline: null, paymentDeadlineKind: 'fixed' },
      { paymentDeadline: null, paymentDeadlineKind: 'later_notice' },
      { paymentDeadline: null, paymentDeadlineKind: null },
      {},
    ]
    for (const input of inputs) {
      const out = normalizePaymentDeadline(input)
      expect(out.paymentDeadline !== null).toBe(out.paymentDeadlineKind === 'fixed')
    }
  })
})

/** AC-39: payload の日本語3値 → DB の英語 enum。 */
describe('paymentDeadlineKindFromPayload', () => {
  it('「日付あり」→ fixed /「後日連絡」→ later_notice /「記載なし」→ unspecified', () => {
    expect(paymentDeadlineKindFromPayload('日付あり')).toBe('fixed')
    expect(paymentDeadlineKindFromPayload('後日連絡')).toBe('later_notice')
    expect(paymentDeadlineKindFromPayload('記載なし')).toBe('unspecified')
  })

  it('未知の値・欠落は unspecified（later_notice は積極的な主張なので推測で選ばない）', () => {
    expect(paymentDeadlineKindFromPayload(undefined)).toBe('unspecified')
    expect(paymentDeadlineKindFromPayload(null)).toBe('unspecified')
    expect(paymentDeadlineKindFromPayload('later_notice')).toBe('unspecified')
    expect(paymentDeadlineKindFromPayload(42)).toBe('unspecified')
  })
})

/** AC-42 / AC-44: DB は英語値・UI は日本語表示。 */
describe('formatPaymentDeadline', () => {
  const fmt = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

  it('fixed は日付そのものを出す', () => {
    expect(formatPaymentDeadline('2026-05-15', 'fixed', fmt)).toBe('5/15')
  })

  it('later_notice は「後日連絡」', () => {
    expect(formatPaymentDeadline(null, 'later_notice', fmt)).toBe('後日連絡')
  })

  it('unspecified は「締切未設定」', () => {
    expect(formatPaymentDeadline(null, 'unspecified', fmt)).toBe('締切未設定')
  })

  it('ラベルは日本語（DB の英語値をそのまま画面に出さない）', () => {
    expect(Object.values(PAYMENT_DEADLINE_KIND_LABELS)).toEqual([
      '日付あり',
      '後日連絡',
      '締切未設定',
    ])
  })
})
