import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DisclosureRow, DisclosureSection, DisclosureActions } from './DisclosureRow'

describe('DisclosureRow', () => {
  it('defaultOpen 未指定で <details> が open 属性を持たない（既定=閉の回帰ガード）', () => {
    const { container } = render(
      <DisclosureRow label="申込状態" value="申込済">
        本文
      </DisclosureRow>,
    )
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.hasAttribute('open')).toBe(false)
    expect(details.open).toBe(false)
  })

  it('defaultOpen=true で開く', () => {
    const { container } = render(
      <DisclosureRow label="申込状態" value="申込済" defaultOpen>
        本文
      </DisclosureRow>,
    )
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details.hasAttribute('open')).toBe(true)
  })

  it("valueTone='ok' で藍15px boldクラスが付く", () => {
    render(
      <DisclosureRow label="申込状態" value="申込済" valueTone="ok" />,
    )
    const value = screen.getByText('申込済')
    expect(value.className).toContain('text-brand-fg')
    expect(value.className).toContain('text-[15px]')
    expect(value.className).toContain('font-bold')
  })

  it("valueTone='ng' で朱15px boldクラスが付く", () => {
    render(<DisclosureRow label="支払状態" value="未払" valueTone="ng" />)
    const value = screen.getByText('未払')
    expect(value.className).toContain('text-accent-fg')
    expect(value.className).toContain('text-[15px]')
    expect(value.className).toContain('font-bold')
  })

  it("auxTone='warn' で朱クラスが付く", () => {
    render(
      <DisclosureRow
        label="級別グループ配信"
        value="1 / 3 送信済み"
        aux="E級 未紐付け"
        auxTone="warn"
      />,
    )
    const aux = screen.getByText('E級 未紐付け')
    expect(aux.className).toContain('text-accent-fg')
  })

  it('nested=true で左インデントクラス(pl-3)が付く（本文側）', () => {
    const { container } = render(
      <DisclosureRow label="連携状況" value="連携済み" nested defaultOpen>
        本文
      </DisclosureRow>,
    )
    const body = container.querySelector('details > div') as HTMLDivElement
    expect(body.className).toContain('pl-3')
  })

  it('nested 未指定(既定)では上下パディングクラスが付く', () => {
    const { container } = render(
      <DisclosureRow label="連携状況" value="連携済み" defaultOpen>
        本文
      </DisclosureRow>,
    )
    const body = container.querySelector('details > div') as HTMLDivElement
    expect(body.className).toContain('pt-[2px]')
    expect(body.className).toContain('pb-[13px]')
  })
})

describe('DisclosureSection', () => {
  it('defaultOpen 未指定で open 属性を持たない（既定=閉の回帰ガード）', () => {
    const { container } = render(
      <DisclosureSection title="LINE 配信" aux="配信中">
        本文
      </DisclosureSection>,
    )
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details.hasAttribute('open')).toBe(false)
  })

  it('defaultOpen=true で開く', () => {
    const { container } = render(
      <DisclosureSection title="LINE 配信" defaultOpen>
        本文
      </DisclosureSection>,
    )
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details.hasAttribute('open')).toBe(true)
  })

  it('title が h2 として出る', () => {
    render(<DisclosureSection title="名簿" />)
    const heading = screen.getByRole('heading', { level: 2, name: '名簿' })
    expect(heading).toBeTruthy()
  })
})

describe('DisclosureActions', () => {
  it('右寄せクラス(justify-end)を持つ', () => {
    const { container } = render(
      <DisclosureActions>
        <button type="button">未申込に戻す</button>
      </DisclosureActions>
    )
    const wrapper = container.firstElementChild as HTMLDivElement
    expect(wrapper.className).toContain('justify-end')
    expect(screen.getByText('未申込に戻す')).toBeTruthy()
  })
})
