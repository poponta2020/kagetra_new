import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionRule } from './SectionRule'

describe('SectionRule', () => {
  it('title / count / countUnit / sub / aux が出る', () => {
    render(
      <SectionRule
        title="参加者"
        count={5}
        countUnit="名"
        aux="計 176名"
      >
        本文
      </SectionRule>,
    )

    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy()
    expect(screen.getByText('参加者')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('名')).toBeTruthy()
    expect(screen.getByText('計 176名')).toBeTruthy()
    expect(screen.getByText('本文')).toBeTruthy()
  })

  it('sub が見出し内に出る', () => {
    render(<SectionRule title="級別定員" sub="（抽選日：8/7）" />)
    expect(screen.getByText('（抽選日：8/7）')).toBeTruthy()
  })

  it('aux 未指定でスロットが出ない', () => {
    render(<SectionRule title="備考" />)
    // aux を渡していないので right-hand slot 用のテキストは存在しない
    expect(screen.queryByText('計 176名')).toBeNull()
  })

  it("auxTone='warn' で朱クラス(text-accent-fg)が付く", () => {
    render(<SectionRule title="級別配信" aux="1件失敗" auxTone="warn" />)
    const aux = screen.getByText('1件失敗')
    expect(aux.className).toContain('text-accent-fg')
  })

  it('auxTone 未指定(既定)では ink-meta クラスが付く', () => {
    render(<SectionRule title="級別配信" aux="計 176名" />)
    const aux = screen.getByText('計 176名')
    expect(aux.className).toContain('text-ink-meta')
  })

  it('背景・枠線クラスを持たない（脱カードの回帰ガード）', () => {
    const { container } = render(<SectionRule title="進行管理">本文</SectionRule>)
    const section = container.querySelector('section')
    expect(section).toBeTruthy()
    expect(section!.className).not.toMatch(/\bbg-/)
    expect(section!.className).not.toMatch(/\bborder\b/)
    expect(section!.className).not.toMatch(/\brounded/)
    expect(section!.className).not.toMatch(/\bshadow/)
  })
})
