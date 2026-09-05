import { describe, expect, it } from 'vitest'
import {
  PAYMENT_NOTICE_UNAVAILABLE_MESSAGES,
  resolvePaymentNoticeAvailability,
  selectDueDays,
  type PaymentNoticeDaySignal,
} from './payment-notice-availability'

/**
 * 送信できない理由の優先順位（line-bot-message-revamp §3.3.5.2 / AC-34・AC-35）。
 * 混在グループで**どの理由が出るか**が、管理者が次に取る行動を決める。
 */

const DUE: PaymentNoticeDaySignal = {
  entryStatus: 'applied',
  paymentType: 'advance',
  paymentStatus: 'unpaid',
}

function resolve(
  days: readonly PaymentNoticeDaySignal[],
  overrides: Partial<{
    settled: boolean
    requireSettled: boolean
    hasLineBinding: boolean
    hasPricedGrade: boolean
  }> = {},
) {
  return resolvePaymentNoticeAvailability({
    settled: true,
    requireSettled: false,
    days,
    hasLineBinding: true,
    hasPricedGrade: true,
    ...overrides,
  })
}

describe('resolvePaymentNoticeAvailability', () => {
  it('申込済・事前払い・未振込の日が1つでもあれば送れる', () => {
    expect(resolve([DUE])).toEqual({ ok: true })
    // 混在していても、対象の日が1つあれば送れる。
    expect(resolve([{ ...DUE, paymentStatus: 'paid' }, DUE])).toEqual({ ok: true })
  })

  it('申込済の日が1つも無ければ「まだ申込済みになっていません」', () => {
    const r = resolve([
      { ...DUE, entryStatus: 'not_applied' },
      { ...DUE, entryStatus: 'not_applying' },
    ])
    expect(r).toEqual({
      ok: false,
      reason: 'not_applied',
      message: 'まだ申込済みになっていません',
    })
  })

  it('申込済はあるが全て現地払いなら「現地払いのため振込は不要です」', () => {
    const r = resolve([{ ...DUE, paymentType: 'onsite' }])
    expect(r).toMatchObject({ ok: false, reason: 'onsite' })
  })

  it('payment_type 未設定（NULL）も現地払いと同じ区分に落ちる', () => {
    // NULL = 支払い通知なし。いずれにせよ振込対象にはならない。
    expect(resolve([{ ...DUE, paymentType: null }])).toMatchObject({ reason: 'onsite' })
  })

  it('事前払いの日が全て支払済なら「支払済みです」', () => {
    const r = resolve([{ ...DUE, paymentStatus: 'paid' }])
    expect(r).toMatchObject({ ok: false, reason: 'paid' })
  })

  it('LINE 紐付けが無ければ理由が出る（AC-35）', () => {
    const r = resolve([DUE], { hasLineBinding: false })
    expect(r).toMatchObject({
      ok: false,
      reason: 'no_line_binding',
      message: 'LINE グループが紐付いていません',
    })
  })

  it('単価を解決できる級が無ければ理由が出る', () => {
    const r = resolve([DUE], { hasPricedGrade: false })
    expect(r).toMatchObject({ ok: false, reason: 'no_priced_grade' })
  })

  it('requireSettled のときだけ確定名簿の有無を見る（§3.3.5.1 / §7-6）', () => {
    // メール処理画面は settled を条件に入れない（処理前は必ず false になるため）。
    expect(resolve([DUE], { settled: false, requireSettled: false })).toEqual({ ok: true })
    // グループページは従来どおり settled を要求する。
    expect(resolve([DUE], { settled: false, requireSettled: true })).toMatchObject({
      reason: 'not_settled',
    })
  })

  it('§3.3.5.2 の表の順に、最初に当たった理由だけを返す', () => {
    // 未申込・現地払い・支払済・紐付けなし・単価なし が同時に成立する状態。
    const r = resolve([{ entryStatus: 'not_applied', paymentType: 'onsite', paymentStatus: 'paid' }], {
      hasLineBinding: false,
      hasPricedGrade: false,
    })
    expect(r).toMatchObject({ reason: 'not_applied' })

    // 申込済にすると次の理由（現地払い）へ降りる。
    const r2 = resolve([{ entryStatus: 'applied', paymentType: 'onsite', paymentStatus: 'paid' }], {
      hasLineBinding: false,
      hasPricedGrade: false,
    })
    expect(r2).toMatchObject({ reason: 'onsite' })

    // 事前払いにすると支払済へ。
    const r3 = resolve([{ entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }], {
      hasLineBinding: false,
      hasPricedGrade: false,
    })
    expect(r3).toMatchObject({ reason: 'paid' })

    // 未振込にすると紐付けなしへ。
    const r4 = resolve([DUE], { hasLineBinding: false, hasPricedGrade: false })
    expect(r4).toMatchObject({ reason: 'no_line_binding' })
  })

  it('理由の文言は1箇所（この定数）だけが持つ', () => {
    expect(Object.keys(PAYMENT_NOTICE_UNAVAILABLE_MESSAGES).sort()).toEqual([
      'no_line_binding',
      'no_priced_grade',
      'not_applied',
      'not_settled',
      'onsite',
      'paid',
    ])
  })
})

describe('selectDueDays', () => {
  it('申込済 ∧ 事前払い ∧ 未振込 の日だけを残す（金額の母集団）', () => {
    const days = [
      { ...DUE, entryStatus: 'not_applied' as const },
      { ...DUE, paymentType: 'onsite' as const },
      { ...DUE, paymentStatus: 'paid' as const },
      DUE,
    ]
    expect(selectDueDays(days)).toEqual([DUE])
  })
})
