import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Histogram } from './Histogram'

function bins25(): number[] {
  const b = new Array<number>(25).fill(0)
  b[4] = 10 // 5 枚差
  b[7] = 4 // 8 枚差
  return b
}

describe('Histogram', () => {
  it('25 本の棒と x 目盛（1・5・…・25）を描く', () => {
    const { container } = render(
      <Histogram bins={bins25()} average={6} ariaLabel="枚数差ヒスト" />,
    )
    expect(screen.getByRole('img', { name: '枚数差ヒスト' })).toBeTruthy()
    expect(container.querySelectorAll('rect')).toHaveLength(25)
    // y 目盛（0,2,4,6,8,10）と衝突しない x 目盛だけを検証する。
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent)
    for (const t of ['1', '5', '15', '20', '25']) {
      expect(texts).toContain(t)
    }
  })

  it('平均線は中立インクの破線（朱不使用）', () => {
    const { container } = render(
      <Histogram bins={bins25()} average={6} ariaLabel="枚数差ヒスト" />,
    )
    const dashed = container.querySelector('line[stroke-dasharray]')
    expect(dashed).not.toBeNull()
    expect(dashed!.getAttribute('class') ?? '').toContain('neutral')
    expect(container.innerHTML).not.toContain('#b33c2d')
    expect(container.innerHTML).not.toContain('accent')
  })

  it('showAverageLabel=true で平均ラベル（単一 text）を出す', () => {
    const { container } = render(<Histogram bins={bins25()} average={6.3} ariaLabel="h" />)
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent)
    expect(texts).toContain('平均 6.3')
  })

  it('showAverageLabel=false で平均ラベルを出さない', () => {
    const { container } = render(
      <Histogram bins={bins25()} average={6.3} ariaLabel="h2" showAverageLabel={false} />,
    )
    const hasAvg = [...container.querySelectorAll('text')].some((t) =>
      t.textContent?.includes('平均'),
    )
    expect(hasAvg).toBe(false)
  })

  it('average=0 なら平均線を出さない', () => {
    const { container } = render(
      <Histogram bins={new Array(25).fill(0)} average={0} ariaLabel="空" />,
    )
    expect(container.querySelector('line[stroke-dasharray]')).toBeNull()
  })
})
