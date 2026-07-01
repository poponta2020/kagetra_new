import { describe, expect, it } from 'vitest'
import { coerceRankingMetric, sanitizeStatsFilter } from './types'

describe('coerceRankingMetric', () => {
  it('妥当な指標はそのまま通す', () => {
    expect(coerceRankingMetric('winRate')).toBe('winRate')
    expect(coerceRankingMetric('championships')).toBe('championships')
  })

  it('未知/非文字列は既定（participations）へ丸める', () => {
    expect(coerceRankingMetric('bogus')).toBe('participations')
    expect(coerceRankingMetric('')).toBe('participations')
    expect(coerceRankingMetric(undefined)).toBe('participations')
    expect(coerceRankingMetric(null)).toBe('participations')
    expect(coerceRankingMetric(42)).toBe('participations')
    expect(coerceRankingMetric({ metric: 'wins' })).toBe('participations')
  })
})

describe('sanitizeStatsFilter', () => {
  it('妥当な年・級はそのまま', () => {
    expect(sanitizeStatsFilter({ yearFrom: 2015, yearTo: 2020, grades: ['A', 'C'] })).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
      grades: ['A', 'C'],
    })
  })

  it('null / undefined / 空は {}', () => {
    expect(sanitizeStatsFilter(undefined)).toEqual({})
    expect(sanitizeStatsFilter(null)).toEqual({})
    expect(sanitizeStatsFilter({})).toEqual({})
  })

  it('yearFrom>yearTo は入替', () => {
    expect(sanitizeStatsFilter({ yearFrom: 2020, yearTo: 2015 })).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
    })
  })

  it('NaN・非整数・範囲外の年は捨てる', () => {
    expect(sanitizeStatsFilter({ yearFrom: Number.NaN })).toEqual({})
    expect(sanitizeStatsFilter({ yearFrom: 2015.5 })).toEqual({})
    expect(sanitizeStatsFilter({ yearFrom: 1800, yearTo: 5000 })).toEqual({})
    // 片方だけ妥当なら妥当な方は残る
    expect(sanitizeStatsFilter({ yearFrom: 2015, yearTo: Number.NaN })).toEqual({ yearFrom: 2015 })
  })

  it('enum 外 grade は捨て A–E 正規順に整える', () => {
    expect(
      sanitizeStatsFilter({ grades: ['Z', 'B', 'A', 'foo'] as unknown as Array<'A'> }),
    ).toEqual({ grades: ['A', 'B'] })
  })

  it('grades が配列でない/空なら落とす', () => {
    expect(sanitizeStatsFilter({ grades: 'A' as unknown as Array<'A'> })).toEqual({})
    expect(sanitizeStatsFilter({ grades: [] })).toEqual({})
  })
})
