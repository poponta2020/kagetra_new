import { describe, expect, it } from 'vitest'
import {
  RANKING_METRICS,
  buildRankingHref,
  formatMetricSub,
  formatMetricValue,
  metricDef,
  parseRankingParams,
} from './metrics'

describe('RANKING_METRICS', () => {
  it('design-spec §3.1 の並び（出場/勝利/勝率/対戦/優勝/入賞）', () => {
    expect(RANKING_METRICS.map((m) => m.key)).toEqual([
      'participations',
      'wins',
      'winRate',
      'matches',
      'championships',
      'nyusho',
    ])
  })
})

describe('buildRankingHref', () => {
  it('既定指標（出場）＋フィルタ無しは素の URL', () => {
    expect(buildRankingHref('participations', {})).toBe('/players/ranking')
  })

  it('非既定指標とフィルタを載せる（級は A→E 正規順で安定化）', () => {
    expect(
      buildRankingHref('wins', { yearFrom: 2015, yearTo: 2020, grades: ['C', 'A'] }),
    ).toBe('/players/ranking?metric=wins&yearFrom=2015&yearTo=2020&grades=A%2CC')
  })

  it('空の grades は載せない', () => {
    expect(buildRankingHref('winRate', { grades: [] })).toBe('/players/ranking?metric=winRate')
  })
})

describe('parseRankingParams', () => {
  it('未指定は既定（出場・フィルタ無し）', () => {
    expect(parseRankingParams({})).toEqual({ metric: 'participations', filter: {} })
  })

  it('妥当な指標・年・級を採用', () => {
    expect(
      parseRankingParams({ metric: 'nyusho', yearFrom: '2015', yearTo: '2020', grades: 'A,B' }),
    ).toEqual({ metric: 'nyusho', filter: { yearFrom: 2015, yearTo: 2020, grades: ['A', 'B'] } })
  })

  it('不正な指標・年・級は捨てる', () => {
    expect(
      parseRankingParams({ metric: 'bogus', yearFrom: 'x', grades: 'Z,foo' }),
    ).toEqual({ metric: 'participations', filter: {} })
  })

  it('yearFrom>yearTo は入れ替える', () => {
    expect(parseRankingParams({ yearFrom: '2020', yearTo: '2015' }).filter).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
    })
  })

  it('grades は正規順（A→E）に並べ替える', () => {
    expect(parseRankingParams({ grades: 'E,B,A' }).filter.grades).toEqual(['A', 'B', 'E'])
  })

  it('配列 searchParams（?grades=A&grades=B）でもクラッシュせず丸める', () => {
    // 繰り返し query
    expect(parseRankingParams({ grades: ['A', 'B'] }).filter.grades).toEqual(['A', 'B'])
    // 繰り返し＋カンマ混在
    expect(parseRankingParams({ grades: ['A,C', 'B'] }).filter.grades).toEqual(['A', 'B', 'C'])
    // metric/year が配列なら先頭を採用
    expect(parseRankingParams({ metric: ['winRate', 'wins'], yearFrom: ['2015'] })).toEqual({
      metric: 'winRate',
      filter: { yearFrom: 2015 },
    })
  })
})

describe('formatMetricValue / formatMetricSub', () => {
  it('勝率は小数第1位固定・他は整数', () => {
    expect(formatMetricValue('winRate', 60)).toBe('60.0')
    expect(formatMetricValue('winRate', 66.7)).toBe('66.7')
    expect(formatMetricValue('wins', 12)).toBe('12')
  })

  it('副次は勝率のみ母数（N戦）を返す', () => {
    expect(formatMetricSub('winRate', 25)).toBe('25戦')
    expect(formatMetricSub('winRate', null)).toBeNull()
    expect(formatMetricSub('wins', 12)).toBeNull()
  })

  it('metricDef は unit/heading を引く', () => {
    expect(metricDef('winRate').unit).toBe('%')
    expect(metricDef('championships').heading).toBe('優勝回数')
  })
})
