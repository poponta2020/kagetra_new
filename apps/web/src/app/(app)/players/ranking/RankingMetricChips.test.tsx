import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RankingMetricChips } from './RankingMetricChips'

describe('RankingMetricChips', () => {
  it('6 指標チップを描画し、現在の指標だけ選択状態', () => {
    render(<RankingMetricChips metric="wins" filter={{}} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(6)
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.textContent).toBe('勝利')
  })

  it('各チップは現在のフィルタを保ったまま metric を差し替える href', () => {
    render(<RankingMetricChips metric="participations" filter={{ grades: ['A'] }} />)
    // 出場（既定）はフィルタのみ、勝利は metric を付ける。いずれも grades=A を保持。
    expect(screen.getByRole('tab', { name: '出場' }).getAttribute('href')).toBe(
      '/players/ranking?grades=A',
    )
    expect(screen.getByRole('tab', { name: '勝利' }).getAttribute('href')).toBe(
      '/players/ranking?metric=wins&grades=A',
    )
    expect(screen.getByRole('tab', { name: '優勝' }).getAttribute('href')).toBe(
      '/players/ranking?metric=championships&grades=A',
    )
  })
})
