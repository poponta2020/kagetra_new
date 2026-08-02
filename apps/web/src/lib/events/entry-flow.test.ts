import { describe, it, expect } from 'vitest'
import { buildEntryFlow, type EntryFlowInput, type EntryFlowStep } from './entry-flow'

/**
 * requirements.md §3.2.1 / §4 (AC-1〜9) の純関数テスト。
 * すべて `todayStr` を注入するので `Date.now()` は読まない。
 */

const baseInput: EntryFlowInput = {
  internalDeadline: '2026-07-01',
  entryDeadline: '2026-07-05',
  lotteryDate: '2026-07-10',
  paymentDeadline: '2026-07-15',
  eventDate: '2026-07-20',
  entryStatus: 'not_applied',
  paymentType: 'advance',
  paymentStatus: 'unpaid',
  hasConfirmedRoster: false,
  todayStr: '2026-06-01',
}

function keyOf(step: EntryFlowStep) {
  return step.key
}

describe('buildEntryFlow', () => {
  it('AC-1: 常に5ステップを internal→entry→lottery→payment→event の順で返す', () => {
    const steps = buildEntryFlow(baseInput)
    expect(steps.map(keyOf)).toEqual(['internal', 'entry', 'lottery', 'payment', 'event'])
  })

  it('AC-2: 対応する日付が NULL のステップは消えず日付欄が未定になる', () => {
    const steps = buildEntryFlow({
      ...baseInput,
      internalDeadline: null,
      lotteryDate: null,
    })
    const internal = steps.find((s) => s.key === 'internal')
    const lottery = steps.find((s) => s.key === 'lottery')
    expect(internal?.date).toEqual({ kind: 'text', value: '未定' })
    expect(lottery?.date).toEqual({ kind: 'text', value: '未定' })
  })

  describe('AC-3: 大会申込は entryStatus === applied のときだけ done になる', () => {
    it('not_applied のときは done にならない', () => {
      const steps = buildEntryFlow({ ...baseInput, entryStatus: 'not_applied' })
      const entry = steps.find((s) => s.key === 'entry')
      expect(entry?.done).toBe(false)
    })

    it('applied のときは done になる（entryDeadline 未超過でも）', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        entryStatus: 'applied',
        todayStr: '2026-06-01', // entryDeadline (2026-07-05) より前
      })
      const entry = steps.find((s) => s.key === 'entry')
      expect(entry?.done).toBe(true)
    })
  })

  describe('AC-4: 支払は paymentType===advance かつ paymentStatus===paid のときだけ done になる', () => {
    it('advance かつ unpaid は done にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      expect(steps.find((s) => s.key === 'payment')?.done).toBe(false)
    })

    it('advance かつ paid は done になる', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'advance',
        paymentStatus: 'paid',
      })
      expect(steps.find((s) => s.key === 'payment')?.done).toBe(true)
    })
  })

  describe('AC-5: 会内締切・抽選・開催は対応する日付が JST の今日より前のときだけ done になる（JST 境界）', () => {
    it('会内締切: 当日は未超過なので done にならない', () => {
      const steps = buildEntryFlow({ ...baseInput, internalDeadline: '2026-06-01', todayStr: '2026-06-01' })
      expect(steps.find((s) => s.key === 'internal')?.done).toBe(false)
    })

    it('会内締切: 翌日は超過なので done になる', () => {
      const steps = buildEntryFlow({ ...baseInput, internalDeadline: '2026-06-01', todayStr: '2026-06-02' })
      expect(steps.find((s) => s.key === 'internal')?.done).toBe(true)
    })

    it('抽選: 当日は未超過なので done にならない', () => {
      const steps = buildEntryFlow({ ...baseInput, lotteryDate: '2026-06-01', todayStr: '2026-06-01' })
      expect(steps.find((s) => s.key === 'lottery')?.done).toBe(false)
    })

    it('抽選: 翌日は超過なので done になる', () => {
      const steps = buildEntryFlow({ ...baseInput, lotteryDate: '2026-06-01', todayStr: '2026-06-02' })
      expect(steps.find((s) => s.key === 'lottery')?.done).toBe(true)
    })

    it('開催: 当日は未超過なので done にならない', () => {
      const steps = buildEntryFlow({ ...baseInput, eventDate: '2026-06-01', todayStr: '2026-06-01' })
      expect(steps.find((s) => s.key === 'event')?.done).toBe(false)
    })

    it('開催: 翌日は超過なので done になる（それでも isGoal は true のまま）', () => {
      const steps = buildEntryFlow({ ...baseInput, eventDate: '2026-06-01', todayStr: '2026-06-02' })
      const event = steps.find((s) => s.key === 'event')
      expect(event?.done).toBe(true)
      expect(event?.isGoal).toBe(true)
    })

    it('日付 NULL のステップ（会内締切・抽選）は超過判定できないので done にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        internalDeadline: null,
        lotteryDate: null,
        todayStr: '2099-01-01',
      })
      expect(steps.find((s) => s.key === 'internal')?.done).toBe(false)
      expect(steps.find((s) => s.key === 'lottery')?.done).toBe(false)
    })
  })

  describe('確定名簿連動: hasConfirmedRoster===true なら抽選日を待たず抽選が done になる', () => {
    it('抽選日が未来でも done になる', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        lotteryDate: '2026-07-10',
        hasConfirmedRoster: true,
        todayStr: '2026-06-01',
      })
      expect(steps.find((s) => s.key === 'lottery')?.done).toBe(true)
    })

    it('抽選日 NULL でも done になり、日付欄は未定のまま', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        lotteryDate: null,
        hasConfirmedRoster: true,
      })
      const lottery = steps.find((s) => s.key === 'lottery')
      expect(lottery?.done).toBe(true)
      expect(lottery?.date).toEqual({ kind: 'text', value: '未定' })
    })

    it('抽選が done になったぶん現在地が次の未完了ステップ（支払）へ進む', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        internalDeadline: '2026-01-01',
        entryStatus: 'applied',
        lotteryDate: null,
        hasConfirmedRoster: true,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        todayStr: '2026-06-01',
      })
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('payment')
    })

    it('not_applying なら hasConfirmedRoster===true でも抽選は中立のまま done にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        entryStatus: 'not_applying',
        hasConfirmedRoster: true,
      })
      const lottery = steps.find((s) => s.key === 'lottery')
      expect(lottery?.neutral).toBe(true)
      expect(lottery?.done).toBe(false)
    })
  })

  describe('AC-6: 警告は期限超過かつ未完了のときだけ。日付 NULL は warn にならない', () => {
    it('entryDeadline 超過かつ未申込は warn になる', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        entryStatus: 'not_applied',
        entryDeadline: '2026-06-01',
        todayStr: '2026-06-02',
      })
      expect(steps.find((s) => s.key === 'entry')?.isWarn).toBe(true)
    })

    it('entryDeadline 超過だが applied 済みなら warn にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        entryStatus: 'applied',
        entryDeadline: '2026-06-01',
        todayStr: '2026-06-02',
      })
      expect(steps.find((s) => s.key === 'entry')?.isWarn).toBe(false)
    })

    it('paymentDeadline 超過かつ未払い(advance)は warn になる', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: '2026-06-01',
        todayStr: '2026-06-02',
      })
      expect(steps.find((s) => s.key === 'payment')?.isWarn).toBe(true)
    })

    it('paymentDeadline 超過だが paid 済みなら warn にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'advance',
        paymentStatus: 'paid',
        paymentDeadline: '2026-06-01',
        todayStr: '2026-06-02',
      })
      expect(steps.find((s) => s.key === 'payment')?.isWarn).toBe(false)
    })

    it('entryDeadline が NULL なら（未申込のまま今日が遠い未来でも）warn にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        entryStatus: 'not_applied',
        entryDeadline: null,
        todayStr: '2099-01-01',
      })
      expect(steps.find((s) => s.key === 'entry')?.isWarn).toBe(false)
    })

    it('paymentDeadline が NULL なら（advance/unpaid のまま今日が遠い未来でも）warn にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadline: null,
        todayStr: '2099-01-01',
      })
      expect(steps.find((s) => s.key === 'payment')?.isWarn).toBe(false)
    })

    it('中立ステップ（onsite の支払）は期限超過でも warn にならない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        paymentType: 'onsite',
        paymentDeadline: '2026-06-01',
        todayStr: '2026-06-02',
      })
      expect(steps.find((s) => s.key === 'payment')?.isWarn).toBe(false)
    })
  })

  describe('AC-7: 現在地は完了でも中立でもない最先頭ステップの高々1つ。候補ゼロなら出さない', () => {
    it('全ステップ未着手のとき、現在地は先頭の会内締切になる', () => {
      const steps = buildEntryFlow({ ...baseInput, todayStr: '2026-06-01' })
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('internal')
    })

    it('会内締切が完了済みなら現在地は大会申込に進む', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        internalDeadline: '2026-05-01',
        todayStr: '2026-06-01',
      })
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('entry')
    })

    it('now は高々1つ（複数ステップが未完了でも先頭のみ）', () => {
      const steps = buildEntryFlow({ ...baseInput, todayStr: '2026-06-01' })
      expect(steps.filter((s) => s.isNow)).toHaveLength(1)
    })

    it('候補ゼロ（全ステップが done または neutral）のとき現在地を出さない', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        internalDeadline: '2026-01-01',
        entryStatus: 'applied',
        lotteryDate: '2026-01-01',
        paymentType: 'advance',
        paymentStatus: 'paid',
        eventDate: '2026-01-01',
        todayStr: '2099-01-01',
      })
      expect(steps.filter((s) => s.isNow)).toHaveLength(0)
    })

    it('開催も先行ステップが全て done/neutral なら現在地の候補になりうる', () => {
      const steps = buildEntryFlow({
        ...baseInput,
        internalDeadline: '2026-01-01',
        entryStatus: 'applied',
        lotteryDate: '2026-01-01',
        paymentType: 'advance',
        paymentStatus: 'paid',
        eventDate: '2099-01-01',
        todayStr: '2026-06-01',
      })
      const nowSteps = steps.filter((s) => s.isNow)
      expect(nowSteps).toHaveLength(1)
      expect(nowSteps[0]?.key).toBe('event')
    })
  })

  describe('中立の伝播: onsite/null の支払、not_applying の大会申込〜支払', () => {
    it('AC-8: paymentType===onsite は日付欄が現地払いで中立になる', () => {
      const steps = buildEntryFlow({ ...baseInput, paymentType: 'onsite' })
      const payment = steps.find((s) => s.key === 'payment')
      expect(payment?.date).toEqual({ kind: 'text', value: '現地払い' })
      expect(payment?.neutral).toBe(true)
      expect(payment?.done).toBe(false)
      expect(payment?.isWarn).toBe(false)
      expect(payment?.isNow).toBe(false)
    })

    it('AC-8: paymentType===null は日付欄が未定で中立になる', () => {
      const steps = buildEntryFlow({ ...baseInput, paymentType: null })
      const payment = steps.find((s) => s.key === 'payment')
      expect(payment?.date).toEqual({ kind: 'text', value: '未定' })
      expect(payment?.neutral).toBe(true)
      expect(payment?.done).toBe(false)
      expect(payment?.isWarn).toBe(false)
      expect(payment?.isNow).toBe(false)
    })

    it('AC-9: not_applying のとき大会申込・抽選・支払が中立になり、大会申込の日付欄は申込なしになる', () => {
      const steps = buildEntryFlow({ ...baseInput, entryStatus: 'not_applying' })
      const entry = steps.find((s) => s.key === 'entry')
      const lottery = steps.find((s) => s.key === 'lottery')
      const payment = steps.find((s) => s.key === 'payment')
      expect(entry?.date).toEqual({ kind: 'text', value: '申込なし' })
      expect(entry?.neutral).toBe(true)
      expect(lottery?.neutral).toBe(true)
      expect(payment?.neutral).toBe(true)
    })

    it('AC-9: not_applying でも会内締切・開催は neutral にならない', () => {
      const steps = buildEntryFlow({ ...baseInput, entryStatus: 'not_applying' })
      expect(steps.find((s) => s.key === 'internal')?.neutral).toBe(false)
      expect(steps.find((s) => s.key === 'event')?.neutral).toBe(false)
    })
  })

  it('AC-9: not_applying のときは現在地がどのステップにも出ない', () => {
    const steps = buildEntryFlow({
      ...baseInput,
      entryStatus: 'not_applying',
      internalDeadline: '2026-05-01', // 会内締切は完了済み → 唯一残る候補は開催のみ
      todayStr: '2026-06-01',
    })
    expect(steps.filter((s) => s.isNow)).toHaveLength(0)
  })

  it('warn は now と併存しうる（期限超過の未完了ステップが現在地でもある場合）', () => {
    const steps = buildEntryFlow({
      ...baseInput,
      entryStatus: 'not_applied',
      internalDeadline: '2026-01-01', // 会内締切は完了済み
      entryDeadline: '2026-06-01', // 超過
      todayStr: '2026-06-02',
    })
    const entry = steps.find((s) => s.key === 'entry')
    expect(entry?.isNow).toBe(true)
    expect(entry?.isWarn).toBe(true)
  })

  it('開催ステップは常に isGoal===true（未完了でも完了でも）', () => {
    const notYet = buildEntryFlow({ ...baseInput, eventDate: '2099-01-01', todayStr: '2026-06-01' })
    const already = buildEntryFlow({ ...baseInput, eventDate: '2026-01-01', todayStr: '2026-06-01' })
    expect(notYet.find((s) => s.key === 'event')?.isGoal).toBe(true)
    expect(already.find((s) => s.key === 'event')?.isGoal).toBe(true)
    // 非開催ステップは isGoal===false
    for (const step of [...notYet, ...already].filter((s) => s.key !== 'event')) {
      expect(step.isGoal).toBe(false)
    }
  })

  it('event ステップの date は eventDate をそのまま kind: date で返す（NOT NULL）', () => {
    const steps = buildEntryFlow(baseInput)
    expect(steps.find((s) => s.key === 'event')?.date).toEqual({ kind: 'date', value: '2026-07-20' })
  })

  it('label は仕様通りの5文字列になる', () => {
    const steps = buildEntryFlow(baseInput)
    expect(steps.map((s) => s.label)).toEqual(['会内締切', '大会申込', '抽選', '支払', '開催'])
  })
})
