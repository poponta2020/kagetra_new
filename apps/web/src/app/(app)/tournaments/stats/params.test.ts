import { describe, expect, it } from 'vitest'
import {
  buildStatsHref,
  coerceDetailMetric,
  detailHref,
  detailMetricTitle,
  parsePeriodParams,
} from './params'

describe('parsePeriodParams', () => {
  it('yearFrom/yearTo を数値化（配列は先頭）', () => {
    expect(parsePeriodParams({ yearFrom: '2015', yearTo: '2020' })).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
    })
    expect(parsePeriodParams({ yearFrom: ['2018', '2019'] })).toEqual({ yearFrom: 2018 })
  })

  it('不正年は捨て・from>to は入替', () => {
    expect(parsePeriodParams({ yearFrom: 'x', yearTo: '2020' })).toEqual({ yearTo: 2020 })
    expect(parsePeriodParams({ yearFrom: '2020', yearTo: '2015' })).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
    })
    expect(parsePeriodParams({})).toEqual({})
  })
})

describe('buildStatsHref / detailHref', () => {
  it('期間を付ける（無指定は base のまま）', () => {
    expect(buildStatsHref('/tournaments/stats', {})).toBe('/tournaments/stats')
    expect(buildStatsHref('/tournaments/stats', { yearFrom: 2015 })).toBe(
      '/tournaments/stats?yearFrom=2015',
    )
    expect(buildStatsHref('/tournaments/stats', { yearFrom: 2015, yearTo: 2020 })).toBe(
      '/tournaments/stats?yearFrom=2015&yearTo=2020',
    )
  })

  it('detailHref は metric セグメント＋期間', () => {
    expect(detailHref('score', {})).toBe('/tournaments/stats/score')
    expect(detailHref('competitors', { yearFrom: 2015 })).toBe(
      '/tournaments/stats/competitors?yearFrom=2015',
    )
  })
})

describe('detailMetricTitle / coerceDetailMetric', () => {
  it('指標のタイトル', () => {
    expect(detailMetricTitle('score')).toBe('スコア統計')
    expect(detailMetricTitle('competitors')).toBe('年別 競技人口')
    expect(detailMetricTitle('participations')).toBe('年別 大会参加人数')
  })

  it('coerceDetailMetric を再エクスポートしている', () => {
    expect(coerceDetailMetric('participations')).toBe('participations')
    expect(coerceDetailMetric('bogus')).toBe('score')
  })
})
