import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ClassBlock } from '@/lib/stats/results'
import { TournamentDetailTabs } from './TournamentDetailTabs'

const dBlock: ClassBlock = {
  classId: 1,
  label: 'D',
  grade: 'D',
  className: 'D級',
  numPlayers: 4,
  winners: [
    { place: 1, label: '優勝', fromFinalRank: false, entries: [{ participantId: 1, playerId: 10, name: '甲', affiliation: '札幌' }] },
    { place: 2, label: '2位', fromFinalRank: false, entries: [{ participantId: 3, playerId: 30, name: '丙', affiliation: null }] },
  ],
  crosstab: {
    columns: [
      { round: 1, label: '1回戦' },
      { round: 2, label: '決勝' },
    ],
    rows: [
      {
        participantId: 1,
        playerId: 10,
        name: '甲',
        affiliation: '札幌',
        reachedRound: 2,
        cells: {
          1: { round: 1, result: 'win', opponentName: '乙', scoreDiff: 5, status: 'normal' },
          2: { round: 2, result: 'win', opponentName: '丙', scoreDiff: 3, status: 'normal' },
        },
      },
      {
        participantId: 2,
        playerId: 20,
        name: '乙',
        affiliation: null,
        reachedRound: 1,
        cells: {
          1: { round: 1, result: 'lose', opponentName: '甲', scoreDiff: 5, status: 'normal' },
        },
      },
    ],
  },
}

const bBlock: ClassBlock = {
  classId: 2,
  label: 'B',
  grade: 'B',
  className: 'B級',
  numPlayers: 2,
  winners: [],
  crosstab: { columns: [], rows: [] },
}

describe('TournamentDetailTabs — タブ', () => {
  it('入賞者＋級ブロックのタブを出し、既定は入賞者', () => {
    render(<TournamentDetailTabs blocks={[dBlock, bBlock]} />)
    expect(screen.getByRole('tab', { name: '入賞者' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'D' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'B' })).toBeTruthy()
    // 入賞者ビュー：順位＋氏名＋リンク
    expect(screen.getByText('優勝')).toBeTruthy()
    expect(screen.getByText('甲').closest('a')?.getAttribute('href')).toBe('/players/10')
    expect(screen.getByText('丙')).toBeTruthy()
  })

  it('級タブをタップするとクロス表に切り替わる', () => {
    render(<TournamentDetailTabs blocks={[dBlock, bBlock]} />)
    fireEvent.click(screen.getByRole('tab', { name: 'D' }))
    // 入賞者は消える
    expect(screen.queryByText('優勝')).toBeNull()
    // 回戦見出し
    expect(screen.getByText('1回戦')).toBeTruthy()
    expect(screen.getByText('決勝')).toBeTruthy()
    // ○（勝ち・藍）×（負け・中立）と相手・枚数
    expect(screen.getAllByText('○').length).toBeGreaterThan(0)
    expect(screen.getByText('×')).toBeTruthy()
    // 5枚差は 甲(vs乙)・乙(vs甲) の両視点で出る
    expect(screen.getAllByText('5枚').length).toBeGreaterThan(0)
    // 行の氏名は戦績詳細リンク（相手名の「甲」は非リンク span なので link ロールで特定）
    const table = screen.getByRole('table')
    expect(within(table).getByRole('link', { name: '甲' }).getAttribute('href')).toBe('/players/10')
  })

  it('入賞者が無い級はセクションを出さない（空文言）', () => {
    render(<TournamentDetailTabs blocks={[bBlock]} />)
    expect(screen.getByText('入賞者を表示できる級がありません。')).toBeTruthy()
  })

  it('対戦記録が無い級タブは空文言', () => {
    render(<TournamentDetailTabs blocks={[bBlock]} />)
    fireEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('この級の対戦記録がありません。')).toBeTruthy()
  })
})
