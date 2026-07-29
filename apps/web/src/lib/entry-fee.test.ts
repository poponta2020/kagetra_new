import { describe, expect, it } from 'vitest'
import {
  entryFeeForGrade,
  formatGradesLabel,
  formatUnitPricesLabel,
  memberEntryFeeJpy,
  resolveEntryFee,
  summarizeFeeTally,
  type EntryFeeSource,
} from '@/lib/entry-fee'

/**
 * grade-entry-fee タスク1: 単価解決の純関数（AC-5 〜 AC-8）。
 * DB を触らないモジュールなので、ここでは実 DB を一切使わない。
 */

const official = (over: Partial<EntryFeeSource> = {}): EntryFeeSource => ({
  official: true,
  kind: 'individual',
  eligibleGrades: ['A', 'B', 'C'],
  feeJpy: null,
  ...over,
})

describe('resolveEntryFee', () => {
  it('AC-5: official な個人戦では fee_jpy に値があっても無視して級から導出する', () => {
    const r = resolveEntryFee(official({ feeJpy: 9999, eligibleGrades: ['A', 'C', 'E'] }))
    expect(r.unitPriceByGrade).toEqual({ A: 2500, C: 2000, E: 1500 })
    expect(r.perPersonPriced).toBe(true)
  })

  it('AC-6: official=false では導出せず fee_jpy をそのまま使う', () => {
    const r = resolveEntryFee(official({ official: false, feeJpy: 3000 }))
    expect(r.unitPriceByGrade).toEqual({ A: 3000, B: 3000, C: 3000 })
    expect(r.singleUnitJpy).toBe(3000)
    expect(r.unitPricesLabel).toBeNull()
    expect(r.perPersonPriced).toBe(false)
  })

  it("AC-6: kind='team' では導出せず fee_jpy をそのまま使う（級で導出すると大外しする）", () => {
    const r = resolveEntryFee(official({ kind: 'team', eligibleGrades: ['E'], feeJpy: 10_000 }))
    expect(r.unitPriceByGrade).toEqual({ E: 10_000 })
    expect(r.singleUnitJpy).toBe(10_000)
    expect(r.perPersonPriced).toBe(false)
  })

  it('AC-6: 非公認で fee_jpy が NULL なら単価を解決しない（0 で埋めない）', () => {
    const r = resolveEntryFee(official({ official: false, feeJpy: null }))
    expect(r.unitPriceByGrade).toEqual({})
    expect(r.groups).toEqual([])
    expect(r.singleUnitJpy).toBeNull()
    expect(r.unitPricesLabel).toBeNull()
  })

  it('AC-7: eligible_grades が NULL のとき全級 A〜E を対象にする', () => {
    const r = resolveEntryFee(official({ eligibleGrades: null }))
    expect(r.targetGrades).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(r.unitPriceByGrade).toEqual({ A: 2500, B: 2500, C: 2000, D: 2000, E: 1500 })
  })

  it('AC-7: eligible_grades が空配列のときも全級 A〜E を対象にする', () => {
    const r = resolveEntryFee(official({ eligibleGrades: [] }))
    expect(r.targetGrades).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('AC-7: eligible_grades の並びが逆でも対象級は A→E 順に正規化される', () => {
    const r = resolveEntryFee(official({ eligibleGrades: ['C', 'A'] }))
    expect(r.targetGrades).toEqual(['A', 'C'])
  })

  it('AC-8: 同一単価の級がまとまり、並びが A→E になる', () => {
    const r = resolveEntryFee(official({ eligibleGrades: ['C', 'B', 'A'] }))
    expect(r.groups).toEqual([
      { grades: ['A', 'B'], feeJpy: 2500 },
      { grades: ['C'], feeJpy: 2000 },
    ])
    expect(r.unitPricesLabel).toBe('A・B級 2,500円 / C級 2,000円')
    expect(r.singleUnitJpy).toBeNull()
  })

  it('AC-8: 全級のときは3グループになる', () => {
    const r = resolveEntryFee(official({ eligibleGrades: null }))
    expect(r.unitPricesLabel).toBe('A・B級 2,500円 / C・D級 2,000円 / E級 1,500円')
  })

  it('同一単価の級だけなら単一料金と判定され、級別表記は付かない', () => {
    const r = resolveEntryFee(official({ eligibleGrades: ['A', 'B'] }))
    expect(r.singleUnitJpy).toBe(2500)
    expect(r.unitPricesLabel).toBeNull()
    expect(r.groups).toEqual([{ grades: ['A', 'B'], feeJpy: 2500 }])
  })
})

describe('entryFeeForGrade', () => {
  it('対象級なら級別規定額を返す', () => {
    expect(entryFeeForGrade(official(), 'C')).toBe(2000)
  })

  it('級が null / undefined なら null（0 や既定額へ倒さない）', () => {
    expect(entryFeeForGrade(official(), null)).toBeNull()
    expect(entryFeeForGrade(official(), undefined)).toBeNull()
  })

  it('対象級外なら null', () => {
    expect(entryFeeForGrade(official({ eligibleGrades: ['A', 'B'] }), 'E')).toBeNull()
  })

  it('未知の級文字列でも null（officialEntryFeeJpy の契約を素通しする）', () => {
    const unknown = 'Z' as unknown as 'A'
    expect(entryFeeForGrade(official({ eligibleGrades: [unknown] }), unknown)).toBeNull()
  })
})

describe('memberEntryFeeJpy', () => {
  it("kind='team' では対象級でも null（1チーム単価を個人の額と誤読させない）", () => {
    const src = official({ kind: 'team', eligibleGrades: ['E'], feeJpy: 10_000 })
    expect(memberEntryFeeJpy(src, 'E')).toBeNull()
  })

  it('非公認の個人戦では fee_jpy をそのまま返す', () => {
    expect(memberEntryFeeJpy(official({ official: false, feeJpy: 3000 }), 'B')).toBe(3000)
  })

  it('official な個人戦では級別規定額を返す', () => {
    expect(memberEntryFeeJpy(official({ feeJpy: 9999 }), 'A')).toBe(2500)
  })
})

describe('formatGradesLabel / formatUnitPricesLabel', () => {
  it('級の並びを「A・B級」の形にする', () => {
    expect(formatGradesLabel(['A', 'B'])).toBe('A・B級')
    expect(formatGradesLabel(['E'])).toBe('E級')
    expect(formatGradesLabel([])).toBe('')
  })

  it('グループが空なら null', () => {
    expect(formatUnitPricesLabel([])).toBeNull()
  })
})

describe('summarizeFeeTally', () => {
  it('総額と内訳を組み立てる（要件の例と一致する）', () => {
    const r = summarizeFeeTally([
      { grade: 'A', count: 1, unitJpy: 2500 },
      { grade: 'B', count: 1, unitJpy: 2500 },
      { grade: 'C', count: 3, unitJpy: 2000 },
    ])
    expect(r.totalJpy).toBe(11_000)
    expect(r.breakdownLabel).toBe('A・B級 2名×2,500 / C級 3名×2,000')
  })

  it('同じ級が複数行（複数日）で来たら合算する', () => {
    const r = summarizeFeeTally([
      { grade: 'C', count: 2, unitJpy: 2000 },
      { grade: 'C', count: 3, unitJpy: 2000 },
    ])
    expect(r.totalJpy).toBe(10_000)
    expect(r.breakdownLabel).toBe('C級 5名×2,000')
  })

  it('人数 0 の級は内訳に出ない', () => {
    const r = summarizeFeeTally([
      { grade: 'A', count: 0, unitJpy: 2500 },
      { grade: 'C', count: 2, unitJpy: 2000 },
    ])
    expect(r.breakdownLabel).toBe('C級 2名×2,000')
    expect(r.totalJpy).toBe(4000)
  })

  it('入力の並びが逆でも内訳は A→E 順になる', () => {
    const r = summarizeFeeTally([
      { grade: 'E', count: 1, unitJpy: 1500 },
      { grade: 'A', count: 1, unitJpy: 2500 },
    ])
    expect(r.breakdownLabel).toBe('A級 1名×2,500 / E級 1名×1,500')
  })

  it('対象が居なければ総額 0・内訳 null（金額行を出さない側の入力になる）', () => {
    expect(summarizeFeeTally([])).toEqual({ totalJpy: 0, breakdownLabel: null })
  })
})
