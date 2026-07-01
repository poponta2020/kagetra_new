import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RankingFilterBar } from './RankingFilterBar'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2015]

beforeEach(() => push.mockReset())

describe('RankingFilterBar — サマリー表示', () => {
  it('フィルタ無しは「全期間 / 全級」', () => {
    render(<RankingFilterBar metric="participations" filter={{}} years={years} />)
    expect(screen.getByText('全期間')).toBeTruthy()
    expect(screen.getByText('全級')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('期間・級を反映したサマリー', () => {
    render(
      <RankingFilterBar
        metric="wins"
        filter={{ yearFrom: 2015, yearTo: 2020, grades: ['A', 'B'] }}
        years={years}
      />,
    )
    expect(screen.getByText('2015〜2020')).toBeTruthy()
    expect(screen.getByText('A・B')).toBeTruthy()
  })
})

describe('RankingFilterBar — シート操作', () => {
  it('絞り込みでシートを開き、期間＋級を適用すると指標を保って遷移する', () => {
    render(<RankingFilterBar metric="wins" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(screen.getByRole('dialog', { name: '絞り込み' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('開始年'), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText('終了年'), { target: { value: '2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: '適用' }))

    // 適用は明示モード（f=1）で push する。
    expect(push).toHaveBeenCalledWith(
      '/players/ranking?metric=wins&f=1&yearFrom=2020&yearTo=2026&grades=C',
    )
    // 適用でシートは閉じる
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('クリアはフィルタを外した URL へ遷移（指標は保持）', () => {
    render(
      <RankingFilterBar metric="nyusho" filter={{ yearFrom: 2015, grades: ['A'] }} years={years} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }))
    expect(push).toHaveBeenCalledWith('/players/ranking?metric=nyusho')
  })

  it('× で閉じると遷移しない', () => {
    render(<RankingFilterBar metric="wins" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('RankingFilterBar — ⑤昇段済みトグル', () => {
  it('級未選択のときトグルは非表示', () => {
    render(<RankingFilterBar metric="wins" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(screen.queryByLabelText('昇段済みの選手を含む')).toBeNull()
  })

  it('級を選ぶとトグルが現れ、ON で適用すると includeFormer=1 が付く', () => {
    render(<RankingFilterBar metric="wins" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    const toggle = screen.getByLabelText('昇段済みの選手を含む')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(push).toHaveBeenCalledWith('/players/ranking?metric=wins&f=1&grades=A&includeFormer=1')
  })

  it('トグル OFF のままなら includeFormer は付かない', () => {
    render(<RankingFilterBar metric="wins" filter={{}} years={years} />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(push).toHaveBeenCalledWith('/players/ranking?metric=wins&f=1&grades=A')
  })

  it('既に級選択＋includeFormerGrade のフィルタで開くとトグルが ON で初期表示', () => {
    render(
      <RankingFilterBar
        metric="wins"
        filter={{ grades: ['A'], includeFormerGrade: true }}
        years={years}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    expect((screen.getByLabelText('昇段済みの選手を含む') as HTMLInputElement).checked).toBe(true)
  })
})
