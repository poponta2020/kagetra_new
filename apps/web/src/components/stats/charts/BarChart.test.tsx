import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart } from './BarChart'

describe('BarChart', () => {
  const data = [
    { label: '2018', value: 3 },
    { label: '2019', value: 5 },
    { label: '2020', value: 1 },
  ]

  it('データ数だけ棒を描き aria-label を持つ', () => {
    const { container } = render(<BarChart data={data} ariaLabel="年推移" />)
    expect(screen.getByRole('img', { name: '年推移' })).toBeTruthy()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
  })

  it('棒の上に値ラベルを出さない（y 目盛で値を読む）', () => {
    const { container } = render(<BarChart data={data} ariaLabel="年推移" />)
    // 棒上の値ラベル（font-display の text）は廃止済み。棒数と一致する数値テキストは無い。
    expect(container.querySelectorAll('text.font-display')).toHaveLength(0)
  })

  it('指定色で棒を塗る（既定は藍・朱はデータ装飾に使わない）', () => {
    const { container } = render(
      <BarChart data={data} color="#123456" ariaLabel="年推移" />,
    )
    const rects = [...container.querySelectorAll('rect')]
    expect(rects.every((r) => r.getAttribute('fill') === '#123456')).toBe(true)
    // 朱（accent）を含まない
    expect(container.innerHTML).not.toContain('#b33c2d')
    expect(container.innerHTML).not.toContain('accent')
  })

  it('valueFormat を y 目盛ラベルに適用（小数軸）', () => {
    render(
      <BarChart
        data={[{ label: 'A級', value: 1.5 }]}
        ariaLabel="平均"
        valueFormat={(n) => n.toFixed(1)}
      />,
    )
    // 小数軸なので 0.5 刻み目盛（0.0/0.5/1.0/1.5）に valueFormat が効く。
    expect(screen.getByText('1.5')).toBeTruthy()
  })
})
