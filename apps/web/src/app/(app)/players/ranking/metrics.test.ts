import { describe, expect, it } from 'vitest'
import {
  RANKING_METRICS,
  buildPlayerHrefFromRanking,
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

describe('buildPlayerHrefFromRanking — ④行→詳細（from=ranking 複写）', () => {
  it('非明示（デフォルト）は from=ranking のみ（指標が非既定なら metric も）', () => {
    expect(buildPlayerHrefFromRanking(12, 'participations', {}, false)).toBe(
      '/players/12?from=ranking',
    )
    expect(buildPlayerHrefFromRanking(12, 'wins', {}, false)).toBe(
      '/players/12?metric=wins&from=ranking',
    )
    // 非明示ではフィルタは複写しない（素の URL のまま戻れる）。
    expect(buildPlayerHrefFromRanking(12, 'wins', { grades: ['A'] }, false)).toBe(
      '/players/12?metric=wins&from=ranking',
    )
  })

  it('明示モードは f=1＋フィルタ（includeFormer 含む）を複写する', () => {
    expect(
      buildPlayerHrefFromRanking(
        7,
        'wins',
        { grades: ['A'], yearFrom: 2021, yearTo: 2026, includeFormerGrade: true },
        true,
      ),
    ).toBe('/players/7?metric=wins&f=1&yearFrom=2021&yearTo=2026&grades=A&includeFormer=1&from=ranking')
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

describe('④ minMatches（勝率の最低試合数・明示フラグと独立）', () => {
  it('buildRankingHref は既定20のとき省略・それ以外は付与（非明示でも保持）', () => {
    // 既定 20 は URL に出さない
    expect(buildRankingHref('winRate', { minMatches: 20 })).toBe('/players/ranking?metric=winRate')
    // 20 以外は非明示（デフォルトビュー）でも付く（独立パラメータ）
    expect(buildRankingHref('winRate', { minMatches: 50 })).toBe(
      '/players/ranking?metric=winRate&minMatches=50',
    )
    // 明示モードでも f=1 と併存して付く
    expect(buildRankingHref('winRate', { grades: ['A'], minMatches: 5 }, true)).toBe(
      '/players/ranking?metric=winRate&f=1&grades=A&minMatches=5',
    )
  })

  it('parseRankingParams は minMatches を明示フラグと独立に読む（不正は捨てる）', () => {
    // 非明示でもデフォルト（級A・直近5年）に加えて minMatches を読む
    expect(parseRankingParams({ metric: 'winRate', minMatches: '50' }, YEAR).filter).toEqual({
      grades: ['A'],
      yearFrom: 2021,
      yearTo: 2026,
      minMatches: 50,
    })
    // 明示モードでも読む
    expect(parseRankingParams({ f: '1', metric: 'winRate', minMatches: '5' }, YEAR).filter).toEqual({
      minMatches: 5,
    })
    // 不正値（文字列/負値）は捨てる＝既定20扱い（URL に出ない）
    expect(
      parseRankingParams({ metric: 'winRate', minMatches: 'x' }, YEAR).filter.minMatches,
    ).toBeUndefined()
    expect(parseRankingParams({ f: '1', minMatches: '-3' }, YEAR).filter.minMatches).toBeUndefined()
  })

  it('round-trip：指標を替えても minMatches は保たれる（他指標は無視するだけ）', () => {
    const { filter, explicit } = parseRankingParams({ metric: 'winRate', minMatches: '50' }, YEAR)
    // 勝率 → 対戦へ指標切替。minMatches は URL に残る。
    const href = buildRankingHref('matches', filter, explicit)
    expect(href).toContain('minMatches=50')
    expect(parseRankingParams(hrefParams(href), YEAR).filter.minMatches).toBe(50)
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
