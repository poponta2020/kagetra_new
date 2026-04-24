import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from './status-pill'

describe('StatusPill', () => {
  it('status=published で「公開」ラベルと success トーンを表示する', () => {
    render(<StatusPill status="published" />)
    const el = screen.getByText('公開')
    expect(el.className).toContain('bg-success-bg')
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

  it('未知の status は「下書き」(neutral) にフォールバックする', () => {
    render(<StatusPill status="draft" />)
    const el = screen.getByText('下書き')
    expect(el.className).toContain('bg-neutral-bg')
  })

  // Guardrail: Object.prototype-inherited keys like `toString` /
  // `hasOwnProperty` must not leak through any lookup — the helper must
  // treat them as unknown statuses and fall back to 下書き.
  it('Object.prototype 由来のキー (toString) でも 下書き にフォールバック', () => {
    render(<StatusPill status="toString" />)
    expect(screen.getByText('下書き')).toBeTruthy()
  })

  it('プロトタイプ由来のキー (hasOwnProperty) でも 下書き にフォールバック', () => {
    render(<StatusPill status="hasOwnProperty" />)
    expect(screen.getByText('下書き')).toBeTruthy()
  })
})
