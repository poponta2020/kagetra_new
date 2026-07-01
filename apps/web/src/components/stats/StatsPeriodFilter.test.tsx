import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatsPeriodFilter } from './StatsPeriodFilter'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2015]

beforeEach(() => push.mockReset())

describe('StatsPeriodFilter', () => {
  it('フィルタ無しは「全期間」・シートは閉じている', () => {
    render(<StatsPeriodFilter basePath="/tournaments/stats" filter={{}} years={years} />)
    expect(screen.getByText('全期間')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('期間サマリーを反映', () => {
    render(
      <StatsPeriodFilter
        basePath="/tournaments/stats"
        filter={{ yearFrom: 2015, yearTo: 2020 }}
        years={years}
      />,
    )
    expect(screen.getByText('2015〜2020')).toBeTruthy()
  })

  it('絞り込み→適用で basePath へ期間付き遷移（級は付かない）', () => {
    render(<StatsPeriodFilter basePath="/tournaments/stats/score" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(screen.getByRole('dialog', { name: '期間で絞り込み' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('開始年'), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText('終了年'), { target: { value: '2026' } })
    fireEvent.click(screen.getByRole('button', { name: '適用' }))

    expect(push).toHaveBeenCalledWith('/tournaments/stats/score?yearFrom=2020&yearTo=2026')
  })

  it('クリアで basePath へ（期間なし）', () => {
    render(
      <StatsPeriodFilter
        basePath="/tournaments/stats"
        filter={{ yearFrom: 2015 }}
        years={years}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }))
    expect(push).toHaveBeenCalledWith('/tournaments/stats')
  })
})
