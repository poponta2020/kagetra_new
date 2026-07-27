import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorStep } from './ErrorStep'

const baseProps = {
  message: 'imap.mail.yahoo.co.jp への接続がタイムアウトしました',
  draftId: 42,
  downloadUrl: '/api/admin/entry-form/drafts/42',
  unassignedCount: 0,
  overflowCount: 0,
  onRetry: vi.fn(),
  retrying: false,
}

describe('ErrorStep — IMAP 失敗（AC-18・b-error.html）', () => {
  it('エラー詳細・ダウンロードリンク・再試行が出る', () => {
    render(<ErrorStep {...baseProps} />)
    expect(screen.getByText(baseProps.message)).toBeTruthy()
    const link = screen.getByText('生成した申込書をダウンロード') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/admin/entry-form/drafts/42')
    expect(screen.getByRole('button', { name: 'もう一度下書きを作成する' })).toBeTruthy()
  })

  it('再試行ボタンで onRetry が呼ばれる', () => {
    const onRetry = vi.fn()
    render(<ErrorStep {...baseProps} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'もう一度下書きを作成する' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('draftId が無い(下書き自体が保存されなかった)場合はダウンロードリンクを出さない', () => {
    render(<ErrorStep {...baseProps} draftId={null} downloadUrl={null} />)
    expect(screen.queryByText('生成した申込書をダウンロード')).toBeNull()
  })

  it('unassignedCount/overflowCount が 0 でないとき警告が出る', () => {
    const { container } = render(<ErrorStep {...baseProps} unassignedCount={1} overflowCount={2} />)
    expect(container.textContent).toContain('どの記入シートにも対応しなかった会員が1名います')
    expect(container.textContent).toContain('テンプレの行数を超えて記入できなかった会員が2名います')
  })
})
