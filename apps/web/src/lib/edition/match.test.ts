import { describe, expect, it } from 'vitest'
import {
  normalizeForMatch,
  searchSeriesCandidates,
  type SeriesRow,
} from './match'

const series: SeriesRow[] = [
  {
    id: 1,
    name: 'シニア選手権',
    aliases: ['シニア選手権大会'],
    kind: 'individual',
  },
  {
    id: 2,
    name: 'こばえちゃ山形酒田大会',
    aliases: ['山形・酒田大会'],
    kind: 'individual',
  },
  { id: 3, name: '全国団体戦', aliases: [], kind: 'team' },
]

describe('edition match — client-safe series search', () => {
  it('全角半角・空白・装飾を同じ検索キーへ畳む', () => {
    expect(normalizeForMatch('★ 山形・酒田 大会 ')).toBe(
      normalizeForMatch('山形酒田大会'),
    )
  })

  it('正準名の部分一致で絞り込む', () => {
    const result = searchSeriesCandidates('シニア', series, 'individual')
    expect(result.map((candidate) => candidate.series.id)).toEqual([1])
  })

  it('別名の完全一致を根拠付きで返す', () => {
    const result = searchSeriesCandidates(
      'シニア選手権大会',
      series,
      'individual',
    )
    expect(result[0]).toMatchObject({
      series: { id: 1, name: 'シニア選手権' },
      score: 100,
      matchedAlias: 'シニア選手権大会',
    })
  })

  it('装飾差を吸収して別名を部分一致検索する', () => {
    const result = searchSeriesCandidates(
      '山形 酒田',
      series,
      'individual',
    )
    expect(result[0]?.series.id).toBe(2)
    expect(result[0]?.matchedAlias).toBe('山形・酒田大会')
  })

  it('検索語のほうが系列名より長い場合は候補に含めない', () => {
    expect(
      searchSeriesCandidates(
        'シニア選手権大会のご案内',
        series,
        'individual',
      ),
    ).toEqual([])
  })

  it('異なる大会種別の系列は候補に含めない', () => {
    expect(searchSeriesCandidates('全国', series, 'individual')).toEqual([])
    expect(
      searchSeriesCandidates('', series, 'team').map(
        (candidate) => candidate.series.id,
      ),
    ).toEqual([3])
  })
})
