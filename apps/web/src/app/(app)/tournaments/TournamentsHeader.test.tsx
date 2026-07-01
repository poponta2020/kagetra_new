import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentsHeader } from './TournamentsHeader'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

beforeEach(() => push.mockReset())

describe('TournamentsHeader — トグル', () => {
  it('現ビューが選択状態、リンクは検索語を引き継ぐ', () => {
    render(<TournamentsHeader view="year" query="東京" />)
    const year = screen.getByRole('tab', { name: '年別' })
    const series = screen.getByRole('tab', { name: '大会別' })
    expect(year.getAttribute('aria-selected')).toBe('true')
    expect(series.getAttribute('aria-selected')).toBe('false')
    // 検索語を引き継ぐ
    expect(year.getAttribute('href')).toBe('/tournaments?q=%E6%9D%B1%E4%BA%AC')
    expect(series.getAttribute('href')).toBe('/tournaments/series?q=%E6%9D%B1%E4%BA%AC')
  })

  it('検索語なしは素の href', () => {
    render(<TournamentsHeader view="series" query="" />)
    expect(screen.getByRole('tab', { name: '年別' }).getAttribute('href')).toBe('/tournaments')
    expect(screen.getByRole('tab', { name: '大会別' }).getAttribute('href')).toBe(
      '/tournaments/series',
    )
    expect(screen.getByRole('tab', { name: '大会別' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('TournamentsHeader — 検索', () => {
  it('送信で現ビューへ ?q= 遷移する', () => {
    render(<TournamentsHeader view="year" query="" />)
    const input = screen.getByLabelText('大会名で検索')
    fireEvent.change(input, { target: { value: '選手権' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/tournaments?q=%E9%81%B8%E6%89%8B%E6%A8%A9')
  })

  it('空送信は素のパスへ（大会別ビュー）', () => {
    render(<TournamentsHeader view="series" query="旧語" />)
    const input = screen.getByLabelText('大会名で検索')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/tournaments/series')
  })
})
