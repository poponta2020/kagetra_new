import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RankingMetricChips } from './RankingMetricChips'

describe('RankingMetricChips', () => {
  it('6 指標チップを描画し、現在の指標だけ選択状態', () => {
    render(<RankingMetricChips metric="wins" filter={{}} explicit={false} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(6)
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.textContent).toBe('勝利')
  })

  it('非明示（デフォルトビュー）は指標のみの素の URL（フィルタは載せない）', () => {
    render(
      <RankingMetricChips
        metric="participations"
        filter={{ grades: ['A'], yearFrom: 2021, yearTo: 2026 }}
        explicit={false}
      />,
    )
    expect(screen.getByRole('tab', { name: '出場' }).getAttribute('href')).toBe('/players/ranking')
    expect(screen.getByRole('tab', { name: '勝利' }).getAttribute('href')).toBe(
      '/players/ranking?metric=wins',
    )
  })

  it('明示モードは f=1＋フィルタを保ったまま metric を差し替える href', () => {
    render(<RankingMetricChips metric="participations" filter={{ grades: ['A'] }} explicit={true} />)
    expect(screen.getByRole('tab', { name: '出場' }).getAttribute('href')).toBe(
      '/players/ranking?f=1&grades=A',
    )
    expect(screen.getByRole('tab', { name: '勝利' }).getAttribute('href')).toBe(
      '/players/ranking?metric=wins&f=1&grades=A',
    )
    expect(screen.getByRole('tab', { name: '優勝' }).getAttribute('href')).toBe(
      '/players/ranking?metric=championships&f=1&grades=A',
    )
  })
})
