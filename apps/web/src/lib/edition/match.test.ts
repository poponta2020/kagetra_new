import { describe, expect, it } from 'vitest'
import {
  normalizeForMatch,
  rankSeriesCandidates,
  scoreSeries,
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

/**
 * mail-ai-extract-refinements §3.2.10: 検索の照合対象に通称（short_name）を足す。
 * 「椿」だけは正準名にも別名にも現れないので、検索と自動解決の分離をそのまま検証できる。
 */
const shortNameSeries: SeriesRow[] = [
  {
    id: 11,
    name: '大阪大会',
    aliases: [],
    kind: 'individual',
    shortName: '大阪',
  },
  {
    id: 12,
    name: '初段認定大阪なにはえ会大会',
    aliases: [],
    kind: 'individual',
    shortName: 'なにはえ',
  },
  { id: 14, name: 'つばき大会', aliases: [], kind: 'individual', shortName: '椿' },
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

  it('通称の完全一致を候補の先頭に置く', () => {
    const result = searchSeriesCandidates('大阪', shortNameSeries, 'individual')
    expect(result[0]).toMatchObject({ series: { id: 11 }, score: 100 })
    // 正準名に「大阪」を含むだけの系列は後ろ（部分一致）。
    expect(result.map((candidate) => candidate.series.id)).toEqual([11, 12])
  })

  it('通称の部分一致でも候補に含める', () => {
    const result = searchSeriesCandidates('なには', shortNameSeries, 'individual')
    expect(result.map((candidate) => candidate.series.id)).toEqual([12])
    expect(result[0]?.score).toBe(50)
  })

  it('正準名にも別名にも無い通称で引ける', () => {
    const result = searchSeriesCandidates('椿', shortNameSeries, 'individual')
    expect(result.map((candidate) => candidate.series.id)).toEqual([14])
    expect(result[0]?.score).toBe(100)
  })

  it('通称は根拠表示（一致した別名）には出さない', () => {
    const result = searchSeriesCandidates('椿', shortNameSeries, 'individual')
    expect(result[0]?.matchedAlias).toBeNull()
  })

  it('自動解決（scoreSeries / rankSeriesCandidates）は通称を見ない', () => {
    // AC-60: 検索は一方向・自動解決は保守的、という PR #292 の分離を保つ。
    expect(scoreSeries('椿', shortNameSeries[2]!)).toBe(0)
    expect(rankSeriesCandidates('椿', shortNameSeries)).toEqual([])
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
