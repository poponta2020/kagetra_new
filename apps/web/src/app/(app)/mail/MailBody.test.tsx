import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MailBody } from './MailBody'

describe('MailBody', () => {
  it('body_text 相当の文字列を <pre> に生テキスト表示する', () => {
    const { container } = render(<MailBody body="こんにちは<b>本文</b>です" />)
    // dangerouslySetInnerHTML を使っていない = タグ文字列がそのままテキストとして見える
    // （<b> が要素化されず、文字列としてノード内に残る）。
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.querySelector('b')).toBeNull()
    expect(pre!.textContent).toBe('こんにちは<b>本文</b>です')
  })

  it('短い本文ではトグルが出ない', () => {
    render(<MailBody body="短い本文です。" />)
    expect(screen.queryByText('全文を表示 ▾')).toBeNull()
  })

  it('「全文を表示」で max-h が切り替わり、折りたたむに変わる', () => {
    const longBody = 'あ'.repeat(250)
    const { container } = render(<MailBody body={longBody} />)

    const pre = container.querySelector('pre')!
    expect(pre.className).toContain('max-h-[190px]')

    const toggle = screen.getByText('全文を表示 ▾')
    fireEvent.click(toggle)

    expect(pre.className).toContain('max-h-[320px]')
    expect(pre.className).not.toContain('max-h-[190px]')
    expect(screen.getByText('折りたたむ ▴')).toBeTruthy()
  })
})
