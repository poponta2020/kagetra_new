import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionTabs } from './section-tabs'

const mockUsePathname = vi.fn<() => string | null>()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

/** Returns the <a> whose visible text matches, for active-state assertions. */
function tab(label: string): HTMLAnchorElement {
  const el = screen.getByText(label).closest('a')
  if (!el) throw new Error(`tab not found: ${label}`)
  return el as HTMLAnchorElement
}

describe('SectionTabs (ss-segA)', () => {
  beforeEach(() => {
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/players')
  })

  it('4 セクションのタブを設計仕様の順・href で描画する', () => {
    render(<SectionTabs />)
    expect(tab('選手検索').getAttribute('href')).toBe('/players')
    expect(tab('大会結果').getAttribute('href')).toBe('/tournaments')
    expect(tab('ランキング').getAttribute('href')).toBe('/players/ranking')
    expect(tab('大会統計').getAttribute('href')).toBe('/tournaments/stats')
  })

  it('/players で 選手検索 が active', () => {
    mockUsePathname.mockReturnValue('/players')
    render(<SectionTabs />)
    expect(tab('選手検索').getAttribute('aria-current')).toBe('page')
    expect(tab('ランキング').getAttribute('aria-current')).toBeNull()
  })

  it('/players/42 のような詳細パスでも 選手検索 が active', () => {
    mockUsePathname.mockReturnValue('/players/42')
    render(<SectionTabs />)
    expect(tab('選手検索').getAttribute('aria-current')).toBe('page')
  })

  // 最長プレフィックス一致: /players/ranking は /players と /players/ranking の
  // 両方に前方一致するが、より長い方（ランキング）が勝たなければならない。
  it('/players/ranking では ランキング が active（選手検索は非 active）', () => {
    mockUsePathname.mockReturnValue('/players/ranking')
    render(<SectionTabs />)
    expect(tab('ランキング').getAttribute('aria-current')).toBe('page')
    expect(tab('選手検索').getAttribute('aria-current')).toBeNull()
  })

  it('/tournaments で 大会結果 が active', () => {
    mockUsePathname.mockReturnValue('/tournaments')
    render(<SectionTabs />)
    expect(tab('大会結果').getAttribute('aria-current')).toBe('page')
  })

  it('/tournaments/series（大会別トグル）でも 大会結果 が active', () => {
    mockUsePathname.mockReturnValue('/tournaments/series')
    render(<SectionTabs />)
    expect(tab('大会結果').getAttribute('aria-current')).toBe('page')
    expect(tab('大会統計').getAttribute('aria-current')).toBeNull()
  })

  it('/tournaments/123 のような大会詳細でも 大会結果 が active', () => {
    mockUsePathname.mockReturnValue('/tournaments/123')
    render(<SectionTabs />)
    expect(tab('大会結果').getAttribute('aria-current')).toBe('page')
  })

  // 最長プレフィックス一致: /tournaments/stats は /tournaments より長い方が勝つ。
  it('/tournaments/stats では 大会統計 が active（大会結果は非 active）', () => {
    mockUsePathname.mockReturnValue('/tournaments/stats')
    render(<SectionTabs />)
    expect(tab('大会統計').getAttribute('aria-current')).toBe('page')
    expect(tab('大会結果').getAttribute('aria-current')).toBeNull()
  })

  it('/tournaments/stats/score（図詳細）でも 大会統計 が active', () => {
    mockUsePathname.mockReturnValue('/tournaments/stats/score')
    render(<SectionTabs />)
    expect(tab('大会統計').getAttribute('aria-current')).toBe('page')
  })

  // セグメント境界一致: /tournaments-archive のような別ルートで誤点灯しない。
  it('/players-archive では 選手検索 が active にならない', () => {
    mockUsePathname.mockReturnValue('/players-archive')
    render(<SectionTabs />)
    expect(tab('選手検索').getAttribute('aria-current')).toBeNull()
  })
})
