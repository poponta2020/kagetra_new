import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SensekiTimeline, type TimelineYear } from './SensekiTimeline'

const years: TimelineYear[] = [
  {
    year: '2026',
    tournamentCount: 1,
    wins: 1,
    losses: 1,
    tournaments: [
      {
        participantId: 1,
        dateLabel: '5/3',
        title: '北海道選手権A',
        affiliation: '東京大学かるた会',
        rank: '優勝',
        rankEmphasis: true,
        matches: [
          {
            roundLabel: '決勝',
            opponentName: '渡辺大輔',
            opponentPlayerId: 99,
            opponentAffiliation: '東京暁星会',
            scoreText: '○7',
            scoreTone: 'win',
          },
          {
            roundLabel: '1回戦',
            opponentName: '外部花子',
            opponentPlayerId: null,
            opponentAffiliation: null,
            scoreText: '×3',
            scoreTone: 'lose',
          },
        ],
      },
    ],
  },
  {
    year: '2025',
    tournamentCount: 1,
    wins: 0,
    losses: 1,
    tournaments: [
      {
        participantId: 2,
        dateLabel: '9/1',
        title: '秋大会B',
        affiliation: null,
        rank: 'ベスト8',
        rankEmphasis: false,
        matches: [],
      },
    ],
  },
]

describe('SensekiTimeline', () => {
  it('初期は全年が畳まれている（年見出しのみ表示）', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    screen.getByText('2026年')
    screen.getByText('2025年')
    // 大会の中身はどの年も初期は出ない（全畳み）
    expect(screen.queryByText('北海道選手権A')).toBeNull()
    expect(screen.queryByText('秋大会B')).toBeNull()
  })

  it('年見出しタップで展開する', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2026年'))
    screen.getByText('北海道選手権A')
  })

  it('展開後、解決済みの相手は ?from 付き戦績リンク・未解決はリンク無し', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2026年'))
    const link = screen.getByRole('link', { name: '渡辺大輔' })
    expect(link.getAttribute('href')).toBe('/players/99?from=5')
    expect(screen.queryByRole('link', { name: '外部花子' })).toBeNull()
    screen.getByText('外部花子')
  })

  it('展開後、相手の所属会と ○×トークンを表示する', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2026年'))
    screen.getByText('（東京暁星会）')
    screen.getByText('○7')
    screen.getByText('×3')
  })

  it('展開後、各大会に選手自身のその大会での所属会を表示する', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2026年'))
    screen.getByText('東京大学かるた会')
  })

  it('所属会が null の大会は所属行を出さない', () => {
    render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2025年'))
    // 秋大会B（affiliation: null）は所属行なし。大会名は出るが所属は無い。
    screen.getByText('秋大会B')
    expect(screen.queryByText('東京大学かるた会')).toBeNull()
  })

  it('別選手データに差し替えると展開状態がリセットされる（同名年も畳む）', () => {
    const { rerender } = render(<SensekiTimeline years={years} playerId={5} />)
    fireEvent.click(screen.getByText('2026年'))
    screen.getByText('北海道選手権A')
    const other: TimelineYear[] = [
      {
        year: '2026',
        tournamentCount: 1,
        wins: 1,
        losses: 0,
        tournaments: [
          { participantId: 9, dateLabel: '3/3', title: '別大会X', affiliation: '別の会', rank: '優勝', rankEmphasis: true, matches: [] },
        ],
      },
      {
        year: '2024',
        tournamentCount: 1,
        wins: 0,
        losses: 1,
        tournaments: [
          { participantId: 8, dateLabel: '4/4', title: '旧大会Y', affiliation: null, rank: 'ベスト8', rankEmphasis: false, matches: [] },
        ],
      },
    ]
    rerender(<SensekiTimeline years={other} playerId={9} />)
    // リセットで全畳み。同名年(2026)が開いたままにならない＝別大会X は出ない。
    expect(screen.queryByText('別大会X')).toBeNull()
    expect(screen.queryByText('北海道選手権A')).toBeNull()
    screen.getByText('2026年')
  })
})
