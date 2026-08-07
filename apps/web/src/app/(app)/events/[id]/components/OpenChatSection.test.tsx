import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OpenChatSection, type OpenChatLinkView } from './OpenChatSection'

function row(id: number, overrides: Partial<OpenChatLinkView> = {}): OpenChatLinkView {
  return {
    id,
    url: `https://line.me/ti/g2/token${id}`,
    grades: null,
    eventDate: null,
    label: null,
    password: null,
    ...overrides,
  }
}

describe('OpenChatSection', () => {
  it('AC-51: 0件のときは見出しごと何も描画しない', () => {
    const { container } = render(<OpenChatSection rows={[]} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('オープンチャット')).toBeNull()
  })

  it('AC-29: 開催日で絞られず、渡された全行が表示される（6/20対象・6/21対象が両方見える）', () => {
    render(
      <OpenChatSection
        rows={[
          row(1, { eventDate: '2026-06-20' }),
          row(2, { eventDate: '2026-06-21' }),
        ]}
      />,
    )

    expect(screen.getByText('6/20(土)')).toBeTruthy()
    expect(screen.getByText('6/21(日)')).toBeTruthy()
  })

  it('AC-52: ローカル再ソートせず、渡された順（sort_order 順）のままDOMに並ぶ', () => {
    const { container } = render(
      <OpenChatSection
        rows={[
          row(1, { label: 'D級' }),
          row(2, { label: 'A級' }),
          row(3, { label: 'C級' }),
        ]}
      />,
    )

    const labels = Array.from(container.querySelectorAll('li a > span > span:first-child')).map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['D級', 'A級', 'C級'])
  })

  it('ラベルは resolveOpenChatLabel の結果と一致する（自動生成: 級・日付から）', () => {
    render(<OpenChatSection rows={[row(1, { grades: ['C'], eventDate: '2026-06-20' })]} />)
    expect(screen.getByText('6/20(土) C級')).toBeTruthy()
  })

  it('ラベルは resolveOpenChatLabel の結果と一致する（自由ラベル優先）', () => {
    render(
      <OpenChatSection
        rows={[row(1, { grades: ['C'], eventDate: '2026-06-20', label: '1年の部' })]}
      />,
    )
    expect(screen.getByText('1年の部')).toBeTruthy()
    expect(screen.queryByText('6/20(土) C級')).toBeNull()
  })

  it('級・日付とも未指定の行は既定ラベル「オープンチャットに参加」になる', () => {
    render(<OpenChatSection rows={[row(1)]} />)
    expect(screen.getByText('オープンチャットに参加')).toBeTruthy()
  })

  it('パスワードのある行にはパスワードが表示され、無い行には表示されない', () => {
    render(
      <OpenChatSection
        rows={[
          row(1, { label: 'B級', password: 'azuma26' }),
          row(2, { label: 'C級' }),
        ]}
      />,
    )

    expect(screen.getByText('パスワード azuma26')).toBeTruthy()
    const cRow = screen.getByText('C級').closest('li')
    expect(cRow?.textContent).not.toContain('パスワード')
  })

  it('AC-43: 追加・編集・削除のコントロールが存在しない', () => {
    const { container } = render(
      <OpenChatSection rows={[row(1, { label: 'B級' }), row(2, { label: 'C級' })]} />,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByText('削除')).toBeNull()
    expect(screen.queryByText('編集')).toBeNull()
    expect(screen.queryByText('追加')).toBeNull()
  })

  it('タップで参加画面へ遷移できる（https の外部リンク）', () => {
    render(<OpenChatSection rows={[row(1, { label: 'B級', url: 'https://line.me/ti/g2/xyz' })]} />)
    const link = screen.getByText('B級').closest('a')
    expect(link?.getAttribute('href')).toBe('https://line.me/ti/g2/xyz')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('AC-42: 一般会員（role: member）が渡すデータでも表示される（このコンポーネントは role を判定しない）', () => {
    // OpenChatSection は role/isAdmin を受け取らない設計そのものが AC-42/AC-43 の
    // 契約（session.user.id の有無のみで境界を作る。role 判定を入れない）。
    render(<OpenChatSection rows={[row(1, { label: 'B級' })]} />)
    expect(screen.getByText('B級')).toBeTruthy()
  })
})
