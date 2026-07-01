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

  it('本数が少なければ値ラベル（font-display）を各棒に出す', () => {
    const { container } = render(<BarChart data={data} ariaLabel="年推移" />)
    // 値ラベルは font-display の text（y 目盛は fill-ink-muted で別）。
    const valueLabels = [...container.querySelectorAll('text.font-display')].map(
      (t) => t.textContent,
    )
    expect(valueLabels).toEqual(['3', '5', '1'])
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

  it('valueFormat を値ラベルと y 目盛に適用（小数）', () => {
    render(
      <BarChart
        data={[{ label: 'A級', value: 1.5 }]}
        ariaLabel="平均"
        valueFormat={(n) => n.toFixed(1)}
      />,
    )
    expect(screen.getByText('1.5')).toBeTruthy()
  })
})
