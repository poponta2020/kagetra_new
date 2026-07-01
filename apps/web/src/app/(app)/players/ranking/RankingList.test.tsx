import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RankingRow } from '@/lib/stats/ranking'
import { RankingList } from './RankingList'
import { loadMoreRanking } from './actions'

vi.mock('./actions', () => ({ loadMoreRanking: vi.fn() }))
const loadMoreMock = vi.mocked(loadMoreRanking)

beforeEach(() => loadMoreMock.mockReset())

const row = (over: Partial<RankingRow> & { rank: number; playerId: number }): RankingRow => ({
  displayName: `選手${over.playerId}`,
  affiliation: null,
  value: 1,
  sub: null,
  ...over,
})

describe('RankingList — 行描画', () => {
  it('順位・氏名・所属・指標値＋単位を出す（行タップ→戦績詳細）', () => {
    render(
      <RankingList
        initialRows={[
          row({ rank: 1, playerId: 10, displayName: '一位太郎', affiliation: '札幌', value: 12 }),
          row({ rank: 2, playerId: 20, displayName: '二位花子', value: 8 }),
        ]}
        total={2}
        metric="wins"
        filter={{}}
      />,
    )
    expect(screen.getByText('一位太郎')).toBeTruthy()
    expect(screen.getByText('札幌')).toBeTruthy()
    // 所属 null は「所属不明」
    expect(screen.getByText('所属不明')).toBeTruthy()
    // 値＋単位（勝利＝勝）
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getAllByText('勝').length).toBeGreaterThan(0)
    // 行は /players/{id} へのリンク
    const link = screen.getByText('一位太郎').closest('a')
    expect(link?.getAttribute('href')).toBe('/players/10')
  })

  it('勝率は小数第1位＋副次（N戦）を出す', () => {
    render(
      <RankingList
        initialRows={[row({ rank: 1, playerId: 1, value: 66.7, sub: 30 })]}
        total={1}
        metric="winRate"
        filter={{}}
      />,
    )
    expect(screen.getByText('66.7')).toBeTruthy()
    expect(screen.getByText('%')).toBeTruthy()
    expect(screen.getByText('30戦')).toBeTruthy()
  })

  it('長名は truncate（省略）クラスを持つ', () => {
    render(
      <RankingList
        initialRows={[row({ rank: 1, playerId: 1, displayName: 'とても長い選手名'.repeat(4) })]}
        total={1}
        metric="wins"
        filter={{}}
      />,
    )
    const nameEl = screen.getByText('とても長い選手名'.repeat(4))
    expect(nameEl.className).toContain('truncate')
  })
})

describe('RankingList — 空 / もっと見る', () => {
  it('該当0件は空状態文言（もっと見る無し）', () => {
    render(<RankingList initialRows={[]} total={0} metric="championships" filter={{}} />)
    expect(screen.getByText('該当する選手がいません。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull()
  })

  it('total>表示数 なら もっと見る、押すと offset=表示数 で追記', async () => {
    loadMoreMock.mockResolvedValue([row({ rank: 3, playerId: 30, displayName: '三位次郎', value: 5 })])
    render(
      <RankingList
        initialRows={[
          row({ rank: 1, playerId: 10, value: 12 }),
          row({ rank: 2, playerId: 20, value: 8 }),
        ]}
        total={3}
        metric="wins"
        filter={{ grades: ['A'] }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    // offset=既存行数(2)・metric/filter を引き継いで呼ぶ
    expect(loadMoreMock).toHaveBeenCalledWith('wins', { grades: ['A'] }, 2)

    await waitFor(() => expect(screen.getByText('三位次郎')).toBeTruthy())
    // 全件（3）表示に達したら もっと見る は消える
    expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull()
  })

  it('表示数が total 未満のままなら もっと見る が残る', async () => {
    loadMoreMock.mockResolvedValue([row({ rank: 3, playerId: 30, value: 5 })])
    render(
      <RankingList
        initialRows={[row({ rank: 1, playerId: 10, value: 12 }), row({ rank: 2, playerId: 20, value: 8 })]}
        total={10}
        metric="wins"
        filter={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    await waitFor(() => expect(screen.getByText('選手30')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeTruthy()
  })
})
