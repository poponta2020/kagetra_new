import { describe, it, expect } from 'vitest'
import { aggregateGroupCommonFields, type GroupCommonFieldsDay } from './group-common-fields'

/**
 * requirements.md §3.2.4「共通値の決め方」の純関数テスト。
 * `todayStr` を注入するので `Date.now()` は読まない。
 */

function day(overrides: Partial<GroupCommonFieldsDay> & { id: number; eventDate: string }): GroupCommonFieldsDay {
  return {
    status: 'published',
    entryDeadline: '2026-09-01',
    internalDeadline: '2026-08-25',
    lotteryDate: '2026-09-05',
    paymentDeadline: '2026-09-10',
    paymentDeadlineKind: 'fixed',
    paymentMethod: '銀行振込',
    paymentInfo: '○○銀行 △△支店',
    entryMethod: 'メール',
    ...overrides,
  }
}

const TODAY = '2026-08-20'

describe('aggregateGroupCommonFields', () => {
  it('空配列なら null', () => {
    expect(aggregateGroupCommonFields([], TODAY)).toBeNull()
  })

  it('日付4項目: 全日一致（値あり）なら varies: false', () => {
    const days = [day({ id: 1, eventDate: '2026-09-27' }), day({ id: 2, eventDate: '2026-09-28' })]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.entryDeadline).toEqual({ value: '2026-09-01', varies: false })
    expect(result.internalDeadline).toEqual({ value: '2026-08-25', varies: false })
    expect(result.lotteryDate).toEqual({ value: '2026-09-05', varies: false })
    expect(result.paymentDeadline).toEqual({ value: '2026-09-10', varies: false })
  })

  it('日付4項目: 全日一致（全 null）なら varies: false', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryDeadline: null }),
      day({ id: 2, eventDate: '2026-09-28', entryDeadline: null }),
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.entryDeadline).toEqual({ value: null, varies: false })
  })

  it('日付が食い違う場合は最小の非 null 日付＋varies: true', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryDeadline: null }),
      day({ id: 2, eventDate: '2026-09-28', entryDeadline: '2026-09-25' }),
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.entryDeadline).toEqual({ value: '2026-09-25', varies: true })
  })

  it('日付以外が食い違う場合は代表イベントの値＋varies: true（代表=今日以降で最も近い日）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-08-01', paymentMethod: '現金' }), // 今日より前
      day({ id: 2, eventDate: '2026-09-28', paymentMethod: '銀行振込' }), // 今日以降で最も近い
      day({ id: 3, eventDate: '2026-10-05', paymentMethod: '郵便振替' }),
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.paymentMethod).toEqual({ value: '銀行振込', varies: true })
  })

  it('代表イベントの選定: 今日以降が無ければ最新日、同着は id 昇順', () => {
    const days = [
      day({ id: 2, eventDate: '2026-08-01', paymentMethod: 'A' }),
      day({ id: 1, eventDate: '2026-08-10', paymentMethod: 'B' }), // 全日過去のうち最新
      day({ id: 3, eventDate: '2026-08-10', paymentMethod: 'C' }), // 同着だが id が大きい
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    // 最新日 2026-08-10 の中で id 昇順=1 が代表 → B
    expect(result.paymentMethod).toEqual({ value: 'B', varies: true })
  })

  it('paymentDeadlineKind も日付以外の項目と同じ規則（食い違えば代表イベントの値）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-08-01', paymentDeadlineKind: 'fixed' }), // 今日より前
      day({ id: 2, eventDate: '2026-09-28', paymentDeadlineKind: 'later_notice' }), // 今日以降で最も近い＝代表
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.paymentDeadlineKind).toEqual({ value: 'later_notice', varies: true })
  })

  it('cancelled の日は母集団から除かれる（cancelled だけ違う値でも varies: false）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', paymentMethod: '銀行振込' }),
      day({ id: 2, eventDate: '2026-09-28', paymentMethod: '銀行振込' }),
      day({ id: 3, eventDate: '2026-09-29', paymentMethod: '現金', status: 'cancelled' }),
    ]
    const result = aggregateGroupCommonFields(days, TODAY)!
    expect(result.paymentMethod).toEqual({ value: '銀行振込', varies: false })
  })

  it('全日 cancelled なら全日へフォールバックして非 null を返す', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', paymentMethod: '銀行振込', status: 'cancelled' }),
      day({ id: 2, eventDate: '2026-09-28', paymentMethod: '現金', status: 'cancelled' }),
    ]
    const result = aggregateGroupCommonFields(days, TODAY)
    expect(result).not.toBeNull()
    expect(result!.paymentMethod.varies).toBe(true)
    expect(result!.paymentMethod.value).not.toBeNull()
  })
})
