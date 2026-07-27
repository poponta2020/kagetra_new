import { describe, it, expect } from 'vitest'
import { OFFICIAL_ENTRY_FEE_JPY, officialEntryFeeJpy } from '../src/index'
import type { Grade } from '../src/index'

describe('OFFICIAL_ENTRY_FEE_JPY (公認大会の級別参加料)', () => {
  // 全日協「公認大会の参加料・公認料の改正について」2021-07-01 施行。
  // 実額は A・B / C・D / E の3段階しかない。
  it('holds the association-mandated amount for each grade', () => {
    expect(OFFICIAL_ENTRY_FEE_JPY).toEqual({
      A: 2500,
      B: 2500,
      C: 2000,
      D: 2000,
      E: 1500,
    })
  })

  it('covers exactly the 5 grades — no more, no less', () => {
    // 型側は Record<Grade, number> が網羅性を強制する。ここは実行時の取りこぼし検出。
    expect(Object.keys(OFFICIAL_ENTRY_FEE_JPY).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('officialEntryFeeJpy', () => {
  it('returns the amount for each grade', () => {
    expect(officialEntryFeeJpy('A')).toBe(2500)
    expect(officialEntryFeeJpy('B')).toBe(2500)
    expect(officialEntryFeeJpy('C')).toBe(2000)
    expect(officialEntryFeeJpy('D')).toBe(2000)
    expect(officialEntryFeeJpy('E')).toBe(1500)
  })

  it('returns null for null / undefined (users.grade is nullable)', () => {
    expect(officialEntryFeeJpy(null)).toBeNull()
    expect(officialEntryFeeJpy(undefined)).toBeNull()
  })

  it('returns null for an unknown grade coming from the DB at runtime', () => {
    // 型は Grade だが、DB 由来の値をランタイムで信用しない。
    expect(officialEntryFeeJpy('F' as Grade)).toBeNull()
    expect(officialEntryFeeJpy('' as Grade)).toBeNull()
  })

  it('never falls back to 0 or to a default amount', () => {
    // 0 は「無料大会」の意味を持つため、引けなかったときに 0 を返してはならない。
    for (const input of [null, undefined, 'F' as Grade]) {
      expect(officialEntryFeeJpy(input)).not.toBe(0)
    }
  })

  it('does not resolve inherited Object properties as grades', () => {
    expect(officialEntryFeeJpy('toString' as Grade)).toBeNull()
    expect(officialEntryFeeJpy('constructor' as Grade)).toBeNull()
  })
})
