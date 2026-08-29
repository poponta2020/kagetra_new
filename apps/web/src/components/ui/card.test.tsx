import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './card'

/**
 * lilac-palette タスク2: Card の高度（elevation 段1）の回帰テスト。
 *
 * 影は純粋な描画なので jsdom では「見え方」を検証できない。ここで守るのは
 * **トークンが外れていないこと**だけ — Tailwind v4 は未定義トークンを無言で
 * 握り潰すため（`text-ink-1` 事案）、クラス名が消えても build / typecheck /
 * lint はすべて green のまま通る。実際の見え方は実機確認に委ねる。
 */
describe('Card (lilac-palette)', () => {
  it('段1の影と surface / 淡い枠線を持つ', () => {
    render(<Card>中身</Card>)
    const el = screen.getByText('中身')

    expect(el.className).toContain('shadow-sm')
    expect(el.className).toContain('bg-surface')
    // 影と併用するため枠線は border-soft。全強度の `border` に戻すと
    // 「枠付きの箱に汚れが付いた」ように見える。
    expect(el.className).toContain('border-border-soft')
  })

  it('className で基底スタイルを上書きできる（tailwind-merge 経由）', () => {
    render(<Card className="border-warn-fg/30">中身</Card>)
    const el = screen.getByText('中身')

    expect(el.className).toContain('border-warn-fg/30')
    expect(el.className).not.toContain('border-border-soft')
  })
})
