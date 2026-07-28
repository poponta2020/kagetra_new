import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DoneStep } from './DoneStep'

const baseProps = {
  toEmail: 'aomorikaruta@yahoo.co.jp',
  subject: '青森大会申込み（北海道大学かるた会）',
  attachmentFilename: '【北海道大学かるた会】第３回青森大会参加申込書.xlsx',
  memberCount: 15,
  createdAt: '7/27 21:04',
  createdByName: '土居',
  unassignedCount: 0,
  overflowCount: 0,
  downloadUrl: '/api/admin/entry-form/drafts/42',
}

describe('DoneStep — 完了画面（b-done.html）', () => {
  it('「この後の流れ」2ステップが出る', () => {
    const { container } = render(<DoneStep {...baseProps} />)
    // SectionRule は title 単体だと div/span の textContent が完全一致するため
    // (罫線用の空 span は textContent に寄与しない)、getByText の厳密一致だと
    // 複数要素ヒットしてエラーになる。container 全体で存在確認する。
    expect(container.textContent).toContain('この後の流れ')
    expect(
      screen.getByText('以前作成した下書きが残っている場合は Yahoo 側で削除してください'),
    ).toBeTruthy()
    expect(
      screen.getByText('参加者への LINE 通知は従来どおりそのタイミングで送られます'),
    ).toBeTruthy()
  })

  it('ダウンロードリンクが draftId から組み立てた URL を指す', () => {
    render(<DoneStep {...baseProps} />)
    const link = screen.getByText('生成した申込書をダウンロード') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/admin/entry-form/drafts/42')
  })

  it('unassignedCount/overflowCount が 0 のときは警告を出さない', () => {
    const { container } = render(<DoneStep {...baseProps} />)
    expect(container.textContent).not.toContain('どの記入シートにも対応しなかった会員')
    expect(container.textContent).not.toContain('テンプレの行数を超えて記入できなかった会員')
  })

  it('unassignedCount が 0 でないとき警告が出る', () => {
    const { container } = render(<DoneStep {...baseProps} unassignedCount={2} />)
    expect(container.textContent).toContain('どの記入シートにも対応しなかった会員が2名います')
  })

  it('overflowCount が 0 でないとき警告が出る', () => {
    const { container } = render(<DoneStep {...baseProps} overflowCount={3} />)
    expect(container.textContent).toContain('テンプレの行数を超えて記入できなかった会員が3名います')
  })
})
