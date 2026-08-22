import { describe, expect, it } from 'vitest'
import type { GradeHeadcount } from '@/lib/entry-fee'
import type { LineTextMessage, LineTextV2Message } from '@/lib/line-mention'
import {
  buildPaymentNoticeMessages,
  normalizeNoticeRows,
  rowsFromSavedCounts,
  savedCountsFromRows,
  totalOfNoticeRows,
} from './payment-notice'

const NO_TREASURER = { kind: 'users', userIds: [] } as const
const TWO_TREASURERS = { kind: 'users', userIds: ['Ua', 'Ub'] } as const

const ROWS: GradeHeadcount[] = [
  { grade: 'A', count: 3, unitJpy: 2500 },
  { grade: 'B', count: 2, unitJpy: 2500 },
]

describe('buildPaymentNoticeMessages', () => {
  it('1通目が §3.3.3 の書式で組み立てられる（AC-15）', () => {
    const preview = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: ROWS,
      paymentDeadlineIso: '2026-07-25',
      paymentInfo: null,
    })
    expect(preview).not.toBeNull()
    const first = preview!.messages[0] as LineTextMessage
    expect(first.text).toBe(
      [
        '@会計',
        '7/25(土)までに',
        'A級：2500*3 = 7500円、',
        'B級：2500*2 = 5000円',
        '',
        '計12500円',
        '',
        'を、以下の口座に振り込んでください',
      ].join('\n'),
    )
    expect(preview!.totalJpy).toBe(12500)
  })

  it('級は A→E 順に並び、人数0の級は行を出さない', () => {
    const preview = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: [
        { grade: 'C', count: 1, unitJpy: 2000 },
        { grade: 'B', count: 0, unitJpy: 2500 },
        { grade: 'A', count: 2, unitJpy: 2500 },
      ],
      paymentDeadlineIso: null,
    })
    const text = (preview!.messages[0] as LineTextMessage).text
    expect(text).toContain('A級：2500*2 = 5000円')
    expect(text).toContain('C級：2000*1 = 2000円')
    expect(text).not.toContain('B級')
    expect(text.indexOf('A級')).toBeLessThan(text.indexOf('C級'))
  })

  it('payment_deadline が NULL のとき日付行が省略される（AC-16）', () => {
    const preview = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: ROWS,
      paymentDeadlineIso: null,
    })
    const text = (preview!.messages[0] as LineTextMessage).text
    expect(text).not.toContain('までに')
    expect(text.split('\n')[1]).toBe('A級：2500*3 = 7500円、')
  })

  it('payment_info が空なら2通目を送らない（AC-17）', () => {
    for (const info of [null, undefined, '', '   ']) {
      const preview = buildPaymentNoticeMessages({
        mention: NO_TREASURER,
        rows: ROWS,
        paymentDeadlineIso: '2026-07-25',
        paymentInfo: info,
      })
      expect(preview!.messages).toHaveLength(1)
    }
  })

  it('payment_info があれば2通目をメンション無しの素テキストで送る（AC-8）', () => {
    const preview = buildPaymentNoticeMessages({
      mention: TWO_TREASURERS,
      rows: ROWS,
      paymentDeadlineIso: '2026-07-25',
      paymentInfo: '〇〇銀行 △△支店 普通 1234567 {カルタ会}',
    })
    expect(preview!.messages).toHaveLength(2)
    // 1通目はメンション付き textV2、2通目は自由記述の text。
    expect(preview!.messages[0]!.type).toBe('textV2')
    expect(preview!.messages[1]).toEqual({
      type: 'text',
      text: '〇〇銀行 △△支店 普通 1234567 {カルタ会}',
    })
  })

  it('会計が居れば1通目が textV2 になり、全員がメンションされる（AC-4/AC-8）', () => {
    const preview = buildPaymentNoticeMessages({
      mention: TWO_TREASURERS,
      rows: ROWS,
      paymentDeadlineIso: '2026-07-25',
    })
    const first = preview!.messages[0] as LineTextV2Message
    expect(first.type).toBe('textV2')
    expect(first.text.startsWith('{m0} {m1}\n')).toBe(true)
    expect(Object.keys(first.substitution)).toEqual(['m0', 'm1'])
  })

  it('会計0人なら @会計 が素テキストで出る（AC-5）', () => {
    const preview = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: ROWS,
      paymentDeadlineIso: '2026-07-25',
    })
    expect(preview!.messages[0]!.type).toBe('text')
    expect(preview!.messages[0]!.text.startsWith('@会計\n')).toBe(true)
  })

  it('人数が全級0なら null を返す（AC-18）', () => {
    expect(
      buildPaymentNoticeMessages({
        mention: NO_TREASURER,
        rows: [{ grade: 'A', count: 0, unitJpy: 2500 }],
        paymentDeadlineIso: '2026-07-25',
      }),
    ).toBeNull()
    expect(
      buildPaymentNoticeMessages({ mention: NO_TREASURER, rows: [] }),
    ).toBeNull()
  })
})

describe('保存人数からの再構築（AC-14）', () => {
  it('保存した人数で組み直すと同じ文面になる', () => {
    const unitPriceByGrade = { A: 2500, B: 2500 } as const
    const saved = savedCountsFromRows(ROWS)
    expect(saved).toEqual({ A: 3, B: 2 })

    const rebuilt = rowsFromSavedCounts(saved, unitPriceByGrade)
    const a = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: ROWS,
      paymentDeadlineIso: '2026-07-25',
    })
    const b = buildPaymentNoticeMessages({
      mention: NO_TREASURER,
      rows: rebuilt,
      paymentDeadlineIso: '2026-07-25',
    })
    expect(b!.messages).toEqual(a!.messages)
    expect(b!.totalJpy).toBe(a!.totalJpy)
  })

  it('単価が解決できない級は明細から除外する', () => {
    const rebuilt = rowsFromSavedCounts({ A: 2, D: 1 }, { A: 2500 })
    expect(rebuilt).toEqual([{ grade: 'A', count: 2, unitJpy: 2500 }])
  })

  it('人数0・負数の保存値は落とす', () => {
    expect(rowsFromSavedCounts({ A: 0, B: -1, C: 2 }, { A: 2500, B: 2500, C: 2000 })).toEqual([
      { grade: 'C', count: 2, unitJpy: 2000 },
    ])
  })
})

describe('ヘルパー', () => {
  it('normalizeNoticeRows は人数0を落として A→E 順にする', () => {
    expect(
      normalizeNoticeRows([
        { grade: 'E', count: 1, unitJpy: 1500 },
        { grade: 'A', count: 0, unitJpy: 2500 },
        { grade: 'C', count: 2, unitJpy: 2000 },
      ]),
    ).toEqual([
      { grade: 'C', count: 2, unitJpy: 2000 },
      { grade: 'E', count: 1, unitJpy: 1500 },
    ])
  })

  it('totalOfNoticeRows は Σ(人数 × 単価)', () => {
    expect(totalOfNoticeRows(ROWS)).toBe(12500)
  })
})
