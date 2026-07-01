import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ParticipantTrendChart } from './ParticipantTrendChart'

describe('ParticipantTrendChart', () => {
  it('記録ある年は棒・中止年は朱の破線で描く', () => {
    const { container } = render(
      <ParticipantTrendChart
        points={[
          { year: 2021, count: 0, cancelled: true },
          { year: 2022, count: 40, cancelled: false },
          { year: 2023, count: 55, cancelled: false },
        ]}
      />,
    )
    // 中止年の破線（stroke-accent + dasharray）が 1 本
    const dashed = container.querySelectorAll('line[stroke-dasharray="2 2"]')
    expect(dashed.length).toBe(1)
    expect(dashed[0]!.getAttribute('class')).toContain('stroke-accent')
    // 記録ある年（2022/2023）は棒（fill-brand）＝2 本
    const bars = container.querySelectorAll('rect.fill-brand')
    expect(bars.length).toBe(2)
    // 年ラベルが出る
    expect(container.textContent).toContain('2022')
    expect(container.textContent).toContain('2023')
  })

  it('aria-label を持つ（スクリーンリーダー用）', () => {
    const { container } = render(
      <ParticipantTrendChart points={[{ year: 2020, count: 10, cancelled: false }]} ariaLabel="推移X" />,
    )
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('推移X')
  })
})
