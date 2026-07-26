import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlatTable } from './FlatTable'

describe('FlatTable', () => {
  it('rows が空なら null（table を描かない）', () => {
    const { container } = render(<FlatTable rows={[]} />)
    expect(container.querySelector('table')).toBeNull()
  })

  it('label / value を描く', () => {
    render(<FlatTable rows={[{ label: '参加費', value: '2,000円' }]} />)
    expect(screen.getByText('参加費')).toBeTruthy()
    expect(screen.getByText('2,000円')).toBeTruthy()
  })

  it("variant='date' で tabular-nums クラスが付く", () => {
    render(
      <FlatTable rows={[{ label: '支払締切', value: '8/20(木)', variant: 'date' }]} />,
    )
    const td = screen.getByText('8/20(木)')
    expect(td.className).toContain('tabular-nums')
  })

  it("variant='num' で右寄せ・Serif・tabular-nums クラスが付く", () => {
    render(<FlatTable rows={[{ label: '定員', value: '176', variant: 'num' }]} />)
    const td = screen.getByText('176')
    expect(td.className).toContain('text-right')
    expect(td.className).toContain('font-display')
    expect(td.className).toContain('tabular-nums')
  })

  it("variant='prewrap' で改行保持クラス(whitespace-pre-wrap)が付く", () => {
    render(
      <FlatTable
        rows={[
          {
            label: '振込先',
            value: 'ゆうちょ銀行 一二三支店\n普通 1234567',
            variant: 'prewrap',
          },
        ]}
      />,
    )
    const td = screen.getByText(/ゆうちょ銀行/)
    expect(td.className).toContain('whitespace-pre-wrap')
  })

  it('valueClassName が td に付く', () => {
    render(
      <FlatTable
        rows={[{ label: 'D級', value: '未送信', valueClassName: 'text-ink-meta' }]}
      />,
    )
    const td = screen.getByText('未送信')
    expect(td.tagName).toBe('TD')
    expect(td.className).toContain('text-ink-meta')
  })
})
