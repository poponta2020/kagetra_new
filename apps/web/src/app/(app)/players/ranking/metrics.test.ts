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

/** 当年を固定注入して当年依存を排除（デフォルト＝2021〜2026）。 */
const YEAR = 2026

/** href の query 部を parseRankingParams が読める sp オブジェクトに戻す（round-trip 用）。 */
function hrefParams(href: string): Record<string, string> {
  const qs = href.split('?')[1] ?? ''
  return Object.fromEntries(new URLSearchParams(qs))
}

describe('buildRankingHref', () => {
  it('非明示（デフォルトビュー）は指標のみ・フィルタは URL に出さない', () => {
    expect(buildRankingHref('participations', {})).toBe('/players/ranking')
    expect(buildRankingHref('wins', {})).toBe('/players/ranking?metric=wins')
    // 非明示ではフィルタを渡しても素の URL を保つ（page 側でデフォルト注入するため）。
    expect(buildRankingHref('wins', { grades: ['A'], yearFrom: 2021, yearTo: 2026 })).toBe(
      '/players/ranking?metric=wins',
    )
  })

  it('明示モードは f=1＋grades/years を載せる（級は A→E 正規順で安定化）', () => {
    expect(
      buildRankingHref('wins', { yearFrom: 2015, yearTo: 2020, grades: ['C', 'A'] }, true),
    ).toBe('/players/ranking?metric=wins&f=1&yearFrom=2015&yearTo=2020&grades=A%2CC')
  })

  it('明示モードで空フィルタは f=1 のみ（全級・全期間の明示表現）', () => {
    expect(buildRankingHref('participations', {}, true)).toBe('/players/ranking?f=1')
    expect(buildRankingHref('wins', {}, true)).toBe('/players/ranking?metric=wins&f=1')
  })

  it('⑤ includeFormerGrade は明示モードで includeFormer=1（true のみ載せる）', () => {
    expect(buildRankingHref('wins', { grades: ['A'], includeFormerGrade: true }, true)).toBe(
      '/players/ranking?metric=wins&f=1&grades=A&includeFormer=1',
    )
    expect(buildRankingHref('wins', { grades: ['A'], includeFormerGrade: false }, true)).toBe(
      '/players/ranking?metric=wins&f=1&grades=A',
    )
    // 非明示ではフィルタごと省略されるため includeFormer も出さない。
    expect(buildRankingHref('wins', { grades: ['A'], includeFormerGrade: true })).toBe(
      '/players/ranking?metric=wins',
    )
  })
})

describe('parseRankingParams — デフォルト注入 / 明示フラグ', () => {
  it('素の URL（フラグ無し）はデフォルト級A・直近5年、explicit=false', () => {
    expect(parseRankingParams({}, YEAR)).toEqual({
      metric: 'participations',
      explicit: false,
      filter: { grades: ['A'], yearFrom: 2021, yearTo: 2026 },
    })
  })

  it('非明示でも指標は URL から採る（指標切替でモード維持）', () => {
    expect(parseRankingParams({ metric: 'wins' }, YEAR)).toEqual({
      metric: 'wins',
      explicit: false,
      filter: { grades: ['A'], yearFrom: 2021, yearTo: 2026 },
    })
  })

  it('明示フラグ有りは URL の値そのまま（grades/years）', () => {
    expect(
      parseRankingParams(
        { f: '1', metric: 'nyusho', yearFrom: '2015', yearTo: '2020', grades: 'A,B' },
        YEAR,
      ),
    ).toEqual({
      metric: 'nyusho',
      explicit: true,
      filter: { yearFrom: 2015, yearTo: 2020, grades: ['A', 'B'] },
    })
  })

  it('明示フラグ有り＋フィルタ無しは全級・全期間（空 filter）', () => {
    expect(parseRankingParams({ f: '1' }, YEAR)).toEqual({
      metric: 'participations',
      explicit: true,
      filter: {},
    })
  })

  it('⑤ 明示モードで includeFormer=1 を読み取る', () => {
    expect(parseRankingParams({ f: '1', grades: 'A', includeFormer: '1' }, YEAR).filter).toEqual({
      grades: ['A'],
      includeFormerGrade: true,
    })
    // 未指定なら現級のみ（includeFormerGrade は付かない）。
    expect(parseRankingParams({ f: '1', grades: 'A' }, YEAR).filter).toEqual({ grades: ['A'] })
  })

  it('明示モードで不正な指標・年・級は捨てる', () => {
    expect(parseRankingParams({ f: '1', metric: 'bogus', yearFrom: 'x', grades: 'Z,foo' }, YEAR)).toEqual({
      metric: 'participations',
      explicit: true,
      filter: {},
    })
  })

  it('明示モードで yearFrom>yearTo は入れ替える', () => {
    expect(parseRankingParams({ f: '1', yearFrom: '2020', yearTo: '2015' }, YEAR).filter).toEqual({
      yearFrom: 2015,
      yearTo: 2020,
    })
  })

  it('明示モードで grades は正規順（A→E）に並べ替える', () => {
    expect(parseRankingParams({ f: '1', grades: 'E,B,A' }, YEAR).filter.grades).toEqual(['A', 'B', 'E'])
  })

  it('配列 searchParams（?grades=A&grades=B）でもクラッシュせず丸める（明示）', () => {
    expect(parseRankingParams({ f: '1', grades: ['A', 'B'] }, YEAR).filter.grades).toEqual(['A', 'B'])
    expect(parseRankingParams({ f: '1', grades: ['A,C', 'B'] }, YEAR).filter.grades).toEqual(['A', 'B', 'C'])
    expect(parseRankingParams({ f: '1', metric: ['winRate', 'wins'], yearFrom: ['2015'] }, YEAR)).toEqual({
      metric: 'winRate',
      explicit: true,
      filter: { yearFrom: 2015 },
    })
  })
})

describe('parseRankingParams / buildRankingHref — round-trip（モード維持）', () => {
  it('非明示は指標を替えても非明示のまま（デフォルト復元）', () => {
    const { filter, explicit } = parseRankingParams({ metric: 'wins' }, YEAR)
    const href = buildRankingHref('matches', filter, explicit)
    expect(href).toBe('/players/ranking?metric=matches')
    const back = parseRankingParams(hrefParams(href), YEAR)
    expect(back.explicit).toBe(false)
    expect(back.metric).toBe('matches')
    expect(back.filter).toEqual({ grades: ['A'], yearFrom: 2021, yearTo: 2026 })
  })

  it('明示は指標を替えても明示・フィルタを保つ', () => {
    const { filter, explicit } = parseRankingParams(
      { f: '1', grades: 'A', yearFrom: '2021', yearTo: '2026' },
      YEAR,
    )
    const href = buildRankingHref('wins', filter, explicit)
    expect(href).toBe('/players/ranking?metric=wins&f=1&yearFrom=2021&yearTo=2026&grades=A')
    expect(parseRankingParams(hrefParams(href), YEAR)).toEqual({
      metric: 'wins',
      explicit: true,
      filter: { grades: ['A'], yearFrom: 2021, yearTo: 2026 },
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
