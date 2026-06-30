import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from './status-pill'

describe('StatusPill', () => {
  // draft 廃止: 通常状態 (published) はピルを出さない（何も描画しない）。
  it('status=published では何も描画しない（通常状態はピルなし）', () => {
    const { container } = render(<StatusPill status="published" />)
    expect(container.querySelector('span')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('status=cancelled で「中止」ラベルと danger トーンを表示する', () => {
    render(<StatusPill status="cancelled" />)
    const el = screen.getByText('中止')
    expect(el.className).toContain('bg-danger-bg')
  })

  it('status=done で「終了」ラベルと info トーンを表示する', () => {
    render(<StatusPill status="done" />)
    const el = screen.getByText('終了')
    expect(el.className).toContain('bg-info-bg')
  })

  it('未知の status (旧 draft 含む) では何も描画しない', () => {
    const { container } = render(<StatusPill status="draft" />)
    expect(container.querySelector('span')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('null / undefined でも何も描画しない', () => {
    const { container: c1 } = render(<StatusPill status={null} />)
    expect(c1.querySelector('span')).toBeNull()
    const { container: c2 } = render(<StatusPill status={undefined} />)
    expect(c2.querySelector('span')).toBeNull()
  })

  // Guardrail: Object.prototype-inherited keys like `toString` /
  // `hasOwnProperty` must not leak through any lookup — the helper must
  // treat them as unknown statuses and render nothing.
  it('Object.prototype 由来のキー (toString) でも何も描画しない', () => {
    const { container } = render(<StatusPill status="toString" />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('プロトタイプ由来のキー (hasOwnProperty) でも何も描画しない', () => {
    const { container } = render(<StatusPill status="hasOwnProperty" />)
    expect(container.querySelector('span')).toBeNull()
  })
})
