import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { TournamentListRow } from '@/lib/stats/tournaments'
import { TournamentYearList, tournamentDisplayTitle } from './TournamentYearList'
import { loadMoreTournaments } from './actions'

vi.mock('./actions', () => ({ loadMoreTournaments: vi.fn() }))
const loadMoreMock = vi.mocked(loadMoreTournaments)

beforeEach(() => loadMoreMock.mockReset())

const row = (
  over: Partial<TournamentListRow> & { tournamentId: number },
): TournamentListRow => ({
  name: `大会${over.tournamentId}`,
  eventDate: '2025-04-01',
  venue: null,
  year: 2025,
  grades: ['D'],
  participantCount: 10,
  cancelled: false,
  shortName: null,
  ...over,
})

describe('TournamentYearList — 年セクション', () => {
  it('年ごとにセクション化し、行タップで大会詳細へ', () => {
    render(
      <TournamentYearList
        initialRows={[
          row({ tournamentId: 1, name: '2026大会', year: 2026, eventDate: '2026-05-03' }),
          row({ tournamentId: 2, name: '2025大会A', year: 2025 }),
          row({ tournamentId: 3, name: '2025大会B', year: 2025 }),
        ]}
        total={3}
        query=""
      />,
    )
    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.getByText('2025')).toBeTruthy()
    // 2025 セクションは 2 大会
    expect(screen.getByText('2大会')).toBeTruthy()
    // 開催日 YYYY/MM/DD 表記
    expect(screen.getByText(/2026\/05\/03/)).toBeTruthy()
    const link = screen.getByText('2026大会').closest('a')
    expect(link?.getAttribute('href')).toBe('/tournaments/1')
  })

  it('中止回は「中止」表示・参加者数は —', () => {
    render(
      <TournamentYearList
        initialRows={[row({ tournamentId: 1, name: '中止大会', cancelled: true })]}
        total={1}
        query=""
      />,
    )
    expect(screen.getByText('中止')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('10人')).toBeNull()
  })

  it('日付不明は末尾「日付不明」節', () => {
    render(
      <TournamentYearList
        initialRows={[
          row({ tournamentId: 1, name: '通常', year: 2025 }),
          row({ tournamentId: 2, name: '不明', year: null, eventDate: null }),
        ]}
        total={2}
        query=""
      />,
    )
    // 「日付不明」は年セクション見出し＋日付欄の両方に出る
    expect(screen.getAllByText('日付不明').length).toBeGreaterThanOrEqual(1)
  })
})

describe('tournamentDisplayTitle — ② 通称合成', () => {
  it('通称＋開催級を A→E 順で連結（大阪BC・多摩A）', () => {
    expect(tournamentDisplayTitle({ name: '大阪大会', shortName: '大阪', grades: ['B', 'C'] })).toBe(
      '大阪BC',
    )
    expect(tournamentDisplayTitle({ name: '多摩大会', shortName: '多摩', grades: ['A'] })).toBe('多摩A')
  })

  it('開催級が空なら通称のみ（名人戦・クイーン戦など A–E 外）', () => {
    expect(
      tournamentDisplayTitle({ name: '名人戦東日本予選', shortName: '名人戦東予選', grades: [] }),
    ).toBe('名人戦東予選')
  })

  it('short_name 未設定（null）は正式名称フォールバック', () => {
    expect(tournamentDisplayTitle({ name: '謎大会', shortName: null, grades: ['D'] })).toBe('謎大会')
  })
})

describe('TournamentYearList — ② 通称表示（一覧レンダリング）', () => {
  it('shortName があれば行タイトルは通称＋開催級（正式名称は出さない）', () => {
    render(
      <TournamentYearList
        initialRows={[
          row({ tournamentId: 1, name: '大阪大会', shortName: '大阪', grades: ['B', 'C'] }),
        ]}
        total={1}
        query=""
      />,
    )
    expect(screen.getByText('大阪BC')).toBeTruthy()
    expect(screen.queryByText('大阪大会')).toBeNull()
  })

  it('shortName が null なら正式名称のまま', () => {
    render(
      <TournamentYearList
        initialRows={[row({ tournamentId: 1, name: '正式名称大会', shortName: null })]}
        total={1}
        query=""
      />,
    )
    expect(screen.getByText('正式名称大会')).toBeTruthy()
  })
})

describe('TournamentYearList — 空 / もっと見る', () => {
  it('該当0件は空状態文言', () => {
    render(<TournamentYearList initialRows={[]} total={0} query="" />)
    expect(screen.getByText('該当する大会がありません。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull()
  })

  it('total>表示数 なら もっと見る、押すと offset=表示数・query 引き継ぎで追記', async () => {
    loadMoreMock.mockResolvedValue([row({ tournamentId: 9, name: '追加大会', year: 2025 })])
    render(
      <TournamentYearList
        initialRows={[row({ tournamentId: 1, year: 2025 })]}
        total={2}
        query="東京"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(loadMoreMock).toHaveBeenCalledWith('東京', 1)
    await waitFor(() => expect(screen.getByText('追加大会')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull()
  })

  it('追加取得が空配列なら もっと見る を終端して消す', async () => {
    loadMoreMock.mockResolvedValue([])
    render(
      <TournamentYearList initialRows={[row({ tournamentId: 1 })]} total={10} query="" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull())
    expect(loadMoreMock).toHaveBeenCalledTimes(1)
  })
})
