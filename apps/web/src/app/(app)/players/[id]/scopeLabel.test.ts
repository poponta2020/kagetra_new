import { describe, expect, it } from 'vitest'
import type { StatsFilter } from '@/lib/stats/types'
import {
  buildClearScopeHref,
  formatRankingScopeLabel,
  metricBracketAtMost,
} from './scopeLabel'

describe('metricBracketAtMost', () => {
  it('優勝=1・入賞=8・他=undefined', () => {
    expect(metricBracketAtMost('championships')).toBe(1)
    expect(metricBracketAtMost('nyusho')).toBe(8)
    expect(metricBracketAtMost('participations')).toBeUndefined()
    expect(metricBracketAtMost('wins')).toBeUndefined()
    expect(metricBracketAtMost('winRate')).toBeUndefined()
    expect(metricBracketAtMost('matches')).toBeUndefined()
  })
})

describe('formatRankingScopeLabel', () => {
  it('①期間＋級：2021〜2026年・A級大会での成績', () => {
    const filter: StatsFilter = { yearFrom: 2021, yearTo: 2026, grades: ['A'] }
    expect(formatRankingScopeLabel('participations', filter)).toBe(
      '2021〜2026年・A級大会での成績',
    )
  })

  it('全期間（年なし）・A級', () => {
    expect(formatRankingScopeLabel('wins', { grades: ['A'] })).toBe(
      '全期間・A級大会での成績',
    )
  })

  it('期間あり・全級（grades なし）', () => {
    expect(formatRankingScopeLabel('matches', { yearFrom: 2021, yearTo: 2026 })).toBe(
      '2021〜2026年・全級での成績',
    )
  })

  it('単年（from===to）は「2023年」', () => {
    expect(formatRankingScopeLabel('participations', { yearFrom: 2023, yearTo: 2023 })).toBe(
      '2023年・全級での成績',
    )
  })

  it('複数級は A→E 正規順で「B・C級」（入力順が逆でも整列）', () => {
    expect(
      formatRankingScopeLabel('participations', {
        yearFrom: 2021,
        yearTo: 2026,
        grades: ['C', 'B'],
      }),
    ).toBe('2021〜2026年・B・C級大会での成績')
  })

  it('片側のみの期間（yearFrom のみ / yearTo のみ）', () => {
    expect(formatRankingScopeLabel('participations', { yearFrom: 2020 })).toBe(
      '2020年以降・全級での成績',
    )
    expect(formatRankingScopeLabel('participations', { yearTo: 2020 })).toBe(
      '2020年以前・全級での成績',
    )
  })

  it('全期間・全級（フィルタ空）', () => {
    expect(formatRankingScopeLabel('participations', {})).toBe('全期間・全級での成績')
  })

  it('②優勝は「（優勝した大会のみ表示）」を付す', () => {
    expect(
      formatRankingScopeLabel('championships', { yearFrom: 2021, yearTo: 2026, grades: ['A'] }),
    ).toBe('2021〜2026年・A級大会での成績（優勝した大会のみ表示）')
  })

  it('②入賞は「（入賞した大会のみ表示）」を付す', () => {
    expect(formatRankingScopeLabel('nyusho', { grades: ['B'] })).toBe(
      '全期間・B級大会での成績（入賞した大会のみ表示）',
    )
  })
})

describe('buildClearScopeHref', () => {
  it('現 params を維持したまま all=1 を立てる', () => {
    const href = buildClearScopeHref(42, {
      from: 'ranking',
      metric: 'championships',
      f: '1',
      yearFrom: '2021',
      yearTo: '2026',
      grades: 'A',
    })
    const [path, qs] = href.split('?')
    expect(path).toBe('/players/42')
    const params = new URLSearchParams(qs)
    expect(params.get('from')).toBe('ranking')
    expect(params.get('metric')).toBe('championships')
    expect(params.get('f')).toBe('1')
    expect(params.get('yearFrom')).toBe('2021')
    expect(params.get('yearTo')).toBe('2026')
    expect(params.get('grades')).toBe('A')
    expect(params.get('all')).toBe('1')
  })

  it('配列 param（grades 複数）を各値 append して維持する', () => {
    const href = buildClearScopeHref(7, { from: 'ranking', grades: ['B', 'C'] })
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.getAll('grades')).toEqual(['B', 'C'])
    expect(params.get('all')).toBe('1')
  })

  it('既存の all は複製せず 1 つだけ立てる（undefined 値は無視）', () => {
    const href = buildClearScopeHref(1, { from: 'ranking', all: '1', skip: undefined })
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.getAll('all')).toEqual(['1'])
    expect(params.has('skip')).toBe(false)
  })
})
