import { describe, it, expect } from 'vitest'
import { buildEntryFlow } from './entry-flow'
import { aggregateGroupFlowInput, type GroupFlowDay } from './group-entry-flow'

/**
 * requirements.md §3.2.4「申込フロー帯の集約規則」の純関数テスト。
 * 「本番データでの検算」（2026-08-20 実測）はそのまま固定値フィクスチャで再現する。
 */

function day(overrides: Partial<GroupFlowDay> & { id: number; eventDate: string }): GroupFlowDay {
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
    entryStatus: 'not_applied',
    paymentType: null,
    paymentStatus: 'unpaid',
    ...overrides,
  }
}

const TODAY = '2026-08-20'

describe('aggregateGroupFlowInput', () => {
  it('空配列なら null', () => {
    expect(aggregateGroupFlowInput([], TODAY, false)).toBeNull()
  })

  it('全日 cancelled なら null（AC-14）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', status: 'cancelled' }),
      day({ id: 2, eventDate: '2026-09-28', status: 'cancelled' }),
    ]
    expect(aggregateGroupFlowInput(days, TODAY, false)).toBeNull()
  })

  it('全日 not_applying なら entryStatus は not_applying（AC-10）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryStatus: 'not_applying' }),
      day({ id: 2, eventDate: '2026-09-28', entryStatus: 'not_applying' }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.entryStatus).toBe('not_applying')
  })

  it('開催日 = 対象日の最も早い開催日。cancelled の日がより早くても選ばれない（AC-12）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-20', status: 'cancelled' }),
      day({ id: 2, eventDate: '2026-09-27' }),
      day({ id: 3, eventDate: '2026-09-28' }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.eventDate).toBe('2026-09-27')
  })

  it('支払: 申込対象日の advance が全て paid なら paid', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }),
      day({ id: 2, eventDate: '2026-09-28', entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.paymentStatus).toBe('paid')
  })

  it('支払: 1日でも未払があれば unpaid', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }),
      day({
        id: 2,
        eventDate: '2026-09-28',
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.paymentStatus).toBe('unpaid')
  })

  it('支払: advance が0件（全 onsite）なら paymentType=onsite・支払ステップは neutral（AC-11）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryStatus: 'applied', paymentType: 'onsite', paymentStatus: 'unpaid' }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.paymentType).toBe('onsite')
    const steps = buildEntryFlow(input)
    expect(steps.find((s) => s.key === 'payment')?.neutral).toBe(true)
  })

  it('支払: advance が0件（全 null）なら paymentType=null・支払ステップは neutral（AC-11）', () => {
    const days = [
      day({ id: 1, eventDate: '2026-09-27', entryStatus: 'applied', paymentType: null, paymentStatus: 'unpaid' }),
    ]
    const input = aggregateGroupFlowInput(days, TODAY, false)!
    expect(input.paymentType).toBeNull()
    const steps = buildEntryFlow(input)
    expect(steps.find((s) => s.key === 'payment')?.neutral).toBe(true)
  })

  describe('本番データでの検算（2026-08-20 実測、requirements.md §3.2.4）', () => {
    it('多摩CDE: C=applied/paid・D/E=not_applying/unpaid → 申込対象日={C}・全て applied → 大会申込=完了', () => {
      const days = [
        day({
          id: 1,
          eventDate: '2026-09-27',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'paid',
        }), // C
        day({ id: 2, eventDate: '2026-09-28', entryStatus: 'not_applying', paymentStatus: 'unpaid' }), // D
        day({ id: 3, eventDate: '2026-09-29', entryStatus: 'not_applying', paymentStatus: 'unpaid' }), // E
      ]
      const input = aggregateGroupFlowInput(days, TODAY, true)!
      expect(input.entryStatus).toBe('applied')
      const steps = buildEntryFlow(input)
      expect(steps.find((s) => s.key === 'entry')?.done).toBe(true)
      // 確定名簿ありなら抽選も完了・支払も済み・isNow は event へ進む（完了寄り）
      expect(steps.find((s) => s.key === 'lottery')?.done).toBe(true)
      expect(steps.find((s) => s.key === 'payment')?.done).toBe(true)
    })

    it('全日本30周年: ABC=applied/paid・A=not_applying/paid → 申込対象日={ABC} → 完了', () => {
      const days = [
        day({
          id: 1,
          eventDate: '2026-10-01',
          entryStatus: 'not_applying',
          paymentType: 'advance',
          paymentStatus: 'paid',
        }), // A
        day({
          id: 2,
          eventDate: '2026-10-02',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'paid',
        }), // B
        day({
          id: 3,
          eventDate: '2026-10-03',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'paid',
        }), // C
      ]
      const input = aggregateGroupFlowInput(days, TODAY, true)!
      expect(input.entryStatus).toBe('applied')
      expect(input.paymentStatus).toBe('paid')
      const steps = buildEntryFlow(input)
      expect(steps.find((s) => s.key === 'entry')?.done).toBe(true)
      expect(steps.find((s) => s.key === 'payment')?.done).toBe(true)
    })

    it('杉並AB: 両日 applied/unpaid（advance）→ 申込=完了・支払が現在地', () => {
      const days = [
        day({
          id: 1,
          eventDate: '2026-09-05',
          internalDeadline: '2026-08-01', // 会内締切は完了済みにしておく
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'unpaid',
        }),
        day({
          id: 2,
          eventDate: '2026-09-06',
          internalDeadline: '2026-08-01',
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'unpaid',
        }),
      ]
      const input = aggregateGroupFlowInput(days, TODAY, false)!
      expect(input.entryStatus).toBe('applied')
      expect(input.paymentType).toBe('advance')
      expect(input.paymentStatus).toBe('unpaid')
      const steps = buildEntryFlow(input)
      expect(steps.find((s) => s.key === 'entry')?.done).toBe(true)
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('payment')
    })

    it('九段E+CDE: 両日 not_applied → 大会申込が現在地', () => {
      const days = [
        day({
          id: 1,
          eventDate: '2026-09-10',
          internalDeadline: '2026-08-01',
          entryDeadline: '2026-09-05',
          entryStatus: 'not_applied',
        }),
        day({
          id: 2,
          eventDate: '2026-09-11',
          internalDeadline: '2026-08-01',
          entryDeadline: '2026-09-05',
          entryStatus: 'not_applied',
        }),
      ]
      const input = aggregateGroupFlowInput(days, TODAY, false)!
      expect(input.entryStatus).toBe('not_applied')
      const steps = buildEntryFlow(input)
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('entry')
    })
  })
})
