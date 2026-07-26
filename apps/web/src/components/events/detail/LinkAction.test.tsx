import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkAction, LinkActionLink, linkActionClass } from './LinkAction'

// ★jsdom では `::before` の計算スタイル（実測タップ領域）は検証できない。
// ここでは「当たり判定拡張クラスが付いていること」と「視覚サイズを決める
// クラスが変わっていないこと」というクラス契約のみを検証する。
// 実測・視覚確認は行っていない（未検証）。

describe('LinkAction', () => {
  it('当たり判定拡張クラス(before:系)が付いている', () => {
    render(<LinkAction>未申込に戻す</LinkAction>)
    const btn = screen.getByRole('button', { name: '未申込に戻す' })
    expect(btn.className).toContain('relative')
    expect(btn.className).toMatch(/before:absolute/)
    expect(btn.className).toMatch(/before:-inset-y-\[13px\]/)
  })

  it('視覚サイズを決めるクラス(text-xs)が変わっていない', () => {
    render(<LinkAction>編集</LinkAction>)
    const btn = screen.getByRole('button', { name: '編集' })
    expect(btn.className).toContain('text-xs')
  })

  it("tone 既定は brand(text-brand)", () => {
    render(<LinkAction>未申込に戻す</LinkAction>)
    const btn = screen.getByRole('button', { name: '未申込に戻す' })
    expect(btn.className).toContain('text-brand')
  })

  it("tone='danger' で朱(text-accent-fg)クラスが付く", () => {
    render(<LinkAction tone="danger">連携解除</LinkAction>)
    const btn = screen.getByRole('button', { name: '連携解除' })
    expect(btn.className).toContain('text-accent-fg')
  })

  it('type 既定は button', () => {
    render(<LinkAction>未申込に戻す</LinkAction>)
    const btn = screen.getByRole('button', { name: '未申込に戻す' }) as HTMLButtonElement
    expect(btn.type).toBe('button')
  })

  it('disabled / onClick が通る', () => {
    const onClick = vi.fn()
    render(
      <LinkAction disabled onClick={onClick}>
        連携解除
      </LinkAction>,
    )
    const btn = screen.getByRole('button', { name: '連携解除' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('onClick が呼ばれる（disabled でないとき）', () => {
    const onClick = vi.fn()
    render(<LinkAction onClick={onClick}>再配信</LinkAction>)
    fireEvent.click(screen.getByRole('button', { name: '再配信' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('LinkActionLink', () => {
  it('next/link として href を持ち、当たり判定拡張クラスと視覚クラスの両方を持つ', () => {
    render(<LinkActionLink href="/events/1/edit">編集</LinkActionLink>)
    const link = screen.getByRole('link', { name: '編集' })
    expect(link.getAttribute('href')).toBe('/events/1/edit')
    expect(link.className).toMatch(/before:absolute/)
    expect(link.className).toContain('text-xs')
    expect(link.className).toContain('text-brand')
  })
})

describe('linkActionClass', () => {
  it('呼び出し側の className をマージする（上書きしない）', () => {
    const cls = linkActionClass('brand', 'ml-2')
    expect(cls).toContain('ml-2')
    expect(cls).toContain('text-brand')
    expect(cls).toMatch(/before:absolute/)
  })
})
