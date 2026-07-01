import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GradeLegend, StackedComposition } from './StackedComposition'
import type { GradeCompositionPoint } from '@/lib/stats/overview'

const data: GradeCompositionPoint[] = [
  { year: 2025, counts: { A: 2, B: 1, C: 0, D: 0, E: 0 } }, // 2 セグメント
  { year: 2026, counts: { A: 1, B: 0, C: 0, D: 0, E: 0 } }, // 1 セグメント
]

describe('StackedComposition', () => {
  it('総和>0 の級だけセグメントを描く（0 の級は省く）', () => {
    const { container } = render(
      <StackedComposition data={data} ariaLabel="級別構成" />,
    )
    expect(screen.getByRole('img', { name: '級別構成' })).toBeTruthy()
    // 2025: A,B の 2 本 ＋ 2026: A の 1 本 = 3 本
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    // 朱をデータ装飾に使わない
    expect(container.innerHTML).not.toContain('#b33c2d')
  })

  it('0/50/100% の目盛ラベルを持つ', () => {
    render(<StackedComposition data={data} ariaLabel="級別構成" />)
    for (const t of ['0', '50', '100']) {
      expect(screen.getByText(t)).toBeTruthy()
    }
  })
})

describe('GradeLegend', () => {
  it('A〜E の 5 凡例', () => {
    render(<GradeLegend />)
    for (const g of ['A級', 'B級', 'C級', 'D級', 'E級']) {
      expect(screen.getByText(g)).toBeTruthy()
    }
  })
})
