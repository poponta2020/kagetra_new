import { describe, it, expect } from 'vitest'
import { AREAS, classify } from './entry-board-utils'
import {
  CANCELLED_PHASE_LABEL,
  dayPhase,
  NO_APPLICANTS_PHASE_LABEL,
  type DayPhaseDay,
} from './day-phase'

/**
 * design-spec §3.3-1「案C: 進行フェーズ1語」の純関数テスト。
 * 語彙は申込管理ボードの区画名（AREAS）と同一（7語ちょうど）。
 */

function baseDay(overrides: Partial<DayPhaseDay> = {}): DayPhaseDay {
  return {
    id: 1,
    entryGroupId: 1,
    groupName: '杉並A',
    groupDisplayName: '杉並A',
    groupRepresentativeEventId: 1,
    title: '杉並A大会',
    shortName: '杉並',
    eventDate: '2026-09-27',
    eligibleGrades: null,
    internalDeadline: null,
    entryDeadline: null,
    paymentDeadline: null,
    paymentDeadlineKind: 'unspecified',
    lotteryDate: null,
    entryStatus: 'not_applied',
    paymentType: null,
    paymentStatus: 'unpaid',
    attendCount: 0,
    hasConfirmedRoster: false,
    status: 'published',
    ...overrides,
  }
}

const TODAY = '2026-08-20'

describe('dayPhase', () => {
  it('締切前: not_applied かつ会内締切未到来 → 締切前', () => {
    const d = baseDay({ entryStatus: 'not_applied', internalDeadline: '2026-09-01' })
    expect(classify(d, TODAY)).toBe('before_deadline')
    expect(dayPhase(d, TODAY)).toEqual({ label: '締切前', tone: 'wait' })
  })

  it('要申込: not_applied かつ会内締切超過かつ希望者あり → 要申込', () => {
    const d = baseDay({ entryStatus: 'not_applied', internalDeadline: '2026-08-01', attendCount: 1 })
    expect(classify(d, TODAY)).toBe('action_required')
    expect(dayPhase(d, TODAY)).toEqual({ label: '要申込', tone: 'action' })
  })

  it('抽選待ち: applied かつ advance/unpaid かつ確定名簿なし → 抽選待ち', () => {
    const d = baseDay({
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      hasConfirmedRoster: false,
    })
    expect(classify(d, TODAY)).toBe('applied_waiting')
    expect(dayPhase(d, TODAY)).toEqual({ label: '抽選待ち', tone: 'wait' })
  })

  it('要振込: applied かつ advance/unpaid かつ確定名簿あり → 要振込', () => {
    const d = baseDay({
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      hasConfirmedRoster: true,
    })
    expect(classify(d, TODAY)).toBe('payment_due')
    expect(dayPhase(d, TODAY)).toEqual({ label: '要振込', tone: 'action' })
  })

  it('完了: applied かつ paid（または advance でない） → 完了', () => {
    const d = baseDay({ entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' })
    expect(classify(d, TODAY)).toBe('done')
    expect(dayPhase(d, TODAY)).toEqual({ label: '完了', tone: 'done' })
  })

  it('申込なし: entryStatus=not_applying → 申込なし', () => {
    const d = baseDay({ entryStatus: 'not_applying' })
    expect(classify(d, TODAY)).toBe('no_applicants')
    expect(dayPhase(d, TODAY)).toEqual({ label: NO_APPLICANTS_PHASE_LABEL, tone: 'na' })
  })

  it('申込なし: not_applied かつ希望者0名かつ会内締切超過 → 8語目を作らず同じく申込なし', () => {
    const d = baseDay({ entryStatus: 'not_applied', internalDeadline: '2026-08-01', attendCount: 0 })
    expect(classify(d, TODAY)).toBe('no_applicants')
    expect(dayPhase(d, TODAY)).toEqual({ label: NO_APPLICANTS_PHASE_LABEL, tone: 'na' })
  })

  it('中止: status=cancelled → 中止（classify に渡らない）', () => {
    // entryStatus=applied 等「完了」になるはずのデータでも中止が優先されることを確認する
    const d = baseDay({
      status: 'cancelled',
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'paid',
    })
    expect(dayPhase(d, TODAY)).toEqual({ label: CANCELLED_PHASE_LABEL, tone: 'na' })
  })

  it('5区画の短縮ラベルが要申込・抽選待ち・要振込・完了・締切前になる', () => {
    const cases: Array<[Partial<DayPhaseDay>, string]> = [
      [{ entryStatus: 'not_applied', internalDeadline: '2026-09-01' }, '締切前'],
      [{ entryStatus: 'not_applied', internalDeadline: '2026-08-01', attendCount: 1 }, '要申込'],
      [
        { entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'unpaid', hasConfirmedRoster: false },
        '抽選待ち',
      ],
      [
        { entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'unpaid', hasConfirmedRoster: true },
        '要振込',
      ],
      [{ entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }, '完了'],
    ]
    for (const [overrides, expectedLabel] of cases) {
      expect(dayPhase(baseDay(overrides), TODAY).label).toBe(expectedLabel)
    }
  })

  it('不変条件: AREAS の各要素の label は対応する短縮ラベルで終わる（機械的導出の保証）', () => {
    const shortLabels: Record<string, string> = {
      before_deadline: '締切前',
      action_required: '要申込',
      applied_waiting: '抽選待ち',
      payment_due: '要振込',
      done: '完了',
    }
    for (const area of AREAS) {
      expect(area.label.endsWith(shortLabels[area.id]!)).toBe(true)
    }
  })

  it("tone: 朱（action）は要申込・要振込だけ", () => {
    const actionCases: Array<Partial<DayPhaseDay>> = [
      { entryStatus: 'not_applied', internalDeadline: '2026-08-01', attendCount: 1 },
      { entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'unpaid', hasConfirmedRoster: true },
    ]
    for (const overrides of actionCases) {
      const phase = dayPhase(baseDay(overrides), TODAY)
      expect(['要申込', '要振込']).toContain(phase.label)
      expect(phase.tone).toBe('action')
    }

    // 忠実度チェックリスト: 朱は「要対応フェーズ」だけ。他の5語に action は出ない。
    const nonActionCases: Array<Partial<DayPhaseDay>> = [
      { entryStatus: 'not_applied', internalDeadline: '2026-09-01' },
      { entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'unpaid', hasConfirmedRoster: false },
      { entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' },
      { entryStatus: 'not_applying' },
      { status: 'cancelled' },
    ]
    for (const overrides of nonActionCases) {
      expect(dayPhase(baseDay(overrides), TODAY).tone).not.toBe('action')
    }
  })

  it("tone: 砂（na）は申込なし・中止だけ、藍（done）は完了だけ", () => {
    expect(dayPhase(baseDay({ entryStatus: 'not_applying' }), TODAY).tone).toBe('na')
    expect(dayPhase(baseDay({ status: 'cancelled' }), TODAY).tone).toBe('na')
    expect(
      dayPhase(baseDay({ entryStatus: 'applied', paymentType: 'advance', paymentStatus: 'paid' }), TODAY).tone,
    ).toBe('done')
    expect(dayPhase(baseDay({ entryStatus: 'not_applied', internalDeadline: '2026-09-01' }), TODAY).tone).toBe(
      'wait',
    )
  })
})
