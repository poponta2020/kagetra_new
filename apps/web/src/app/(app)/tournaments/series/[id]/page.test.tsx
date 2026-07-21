import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
}))

const { getSeriesDetail } = vi.hoisted(() => ({ getSeriesDetail: vi.fn() }))
vi.mock('@/lib/stats/series', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/stats/series')>()
  return { ...original, getSeriesDetail }
})

const { default: SeriesDetailPage } = await import('./page')

describe('series detail page', () => {
  it('既存の参加者推移と回次リンクを維持し、級別推移を追加する', async () => {
    await setAuthSession({ id: 'member-1', role: 'member' })
    getSeriesDetail.mockResolvedValue({
      seriesId: 7,
      name: '回帰確認大会',
      kind: 'individual',
      editionNumberFrom: 9,
      editionNumberTo: 10,
      yearFrom: 2029,
      yearTo: 2030,
      heldCount: 2,
      cancelledCount: 0,
      unconfirmedCount: 0,
      editions: [{
        editionId: 70,
        editionNumber: 10,
        year: 2030,
        status: 'held',
        tournamentId: 700,
        championName: '優勝者名',
        participantCount: 88,
      }],
      participantTrend: [{ year: 2030, count: 88, cancelled: false }],
      lotteryMetrics: { points: [] },
    })

    const ui = await SeriesDetailPage({ params: Promise.resolve({ id: '7' }) })
    render(ui)

    expect(screen.getByRole('img', { name: '回帰確認大会 参加者数の推移' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '級別の申込・抽選推移' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /第10回/ }).getAttribute('href')).toBe(
      '/tournaments/700?from=%2Ftournaments%2Fseries%2F7',
    )
  })
})
