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
        rank: 'ベスト8',
        rankEmphasis: false,
        matches: [],
      },
    ],
  },
]

describe('SensekiTimeline', () => {
  it('最新年は初期展開し、古い年は折りたたまれている', () => {
    render(<SensekiTimeline years={years} />)
    // getByText は見つからなければ throw する＝存在アサーション
    screen.getByText('2026年')
    screen.getByText('2025年')
    screen.getByText('北海道選手権A')
    // 2025 は折りたたみ → 中身は描画されない
    expect(screen.queryByText('秋大会B')).toBeNull()
  })

  it('年見出しタップで展開する', () => {
    render(<SensekiTimeline years={years} />)
    fireEvent.click(screen.getByText('2025年'))
    expect(screen.queryByText('秋大会B')).not.toBeNull()
  })

  it('解決済みの相手は戦績リンク、未解決はリンクにしない（黒テキスト）', () => {
    render(<SensekiTimeline years={years} />)
    const link = screen.getByRole('link', { name: '渡辺大輔' })
    expect(link.getAttribute('href')).toBe('/players/99')
    expect(screen.queryByRole('link', { name: '外部花子' })).toBeNull()
    // 未解決の相手名はテキストとしては存在する
    screen.getByText('外部花子')
  })

  it('相手の所属会と ○×トークンを表示する', () => {
    render(<SensekiTimeline years={years} />)
    screen.getByText('（東京暁星会）')
    screen.getByText('○7')
    screen.getByText('×3')
  })
})
