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
    // x 目盛（枚数差）。y 目盛は割合(%)で末尾に % が付く＝x 目盛の数字と文字列衝突しない。
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent)
    for (const t of ['1', '5', '15', '20', '25']) {
      expect(texts).toContain(t)
    }
    // 縦軸は割合(%)＝目盛ラベルは % 付き。
    expect(texts.some((t) => t?.endsWith('%'))).toBe(true)
  })

  it('縦軸は合計に対する割合(%)で正規化する', () => {
    const bins = new Array<number>(25).fill(0)
    bins[0] = 1 // 唯一の試合 → 枚数差 1 が 100%
    const { container } = render(<Histogram bins={bins} average={1} ariaLabel="pct" />)
    // 右軸（累積%）にも 100% が常に出るため、左軸ラベル（text-anchor=end）に限定して確認する。
    const leftTexts = [...container.querySelectorAll('text[text-anchor="end"]')].map(
      (t) => t.textContent,
    )
    expect(leftTexts).toContain('100%')
  })

  it('累積%の折れ線（パレート）を描き、終点は右軸 100%（上端）に達する', () => {
    const { container } = render(
      <Histogram bins={bins25()} average={6} ariaLabel="パレート" />,
    )
    const line = container.querySelector('polyline')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('fill')).toBe('none')
    // 実線の中立インク（破線の平均線と区別・朱不使用）。
    expect(line!.getAttribute('class') ?? '').toContain('neutral')
    expect(line!.hasAttribute('stroke-dasharray')).toBe(false)
    // 25 点（枚数差 1〜25）で、累積 100% の終点はプロット上端 y=PT(14)。
    const points = (line!.getAttribute('points') ?? '').split(' ')
    expect(points).toHaveLength(25)
    expect(points[points.length - 1]!.endsWith(',14')).toBe(true)
  })

  it('右軸（累積%）の目盛 0/25/50/75/100% を出す', () => {
    const { container } = render(
      <Histogram bins={bins25()} average={6} ariaLabel="右軸" />,
    )
    const rightTexts = [...container.querySelectorAll('text[text-anchor="start"]')].map(
      (t) => t.textContent,
    )
    for (const t of ['0%', '25%', '50%', '75%', '100%']) {
      expect(rightTexts).toContain(t)
    }
  })

  it('合計 0 なら累積折れ線を出さない', () => {
    const { container } = render(
      <Histogram bins={new Array(25).fill(0)} average={0} ariaLabel="空パレート" />,
    )
    expect(container.querySelector('polyline')).toBeNull()
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
