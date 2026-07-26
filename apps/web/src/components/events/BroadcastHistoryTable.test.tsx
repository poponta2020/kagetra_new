import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  BroadcastHistoryTable,
  type BroadcastHistoryRow,
} from './BroadcastHistoryTable'

function row(over: Partial<BroadcastHistoryRow> = {}): BroadcastHistoryRow {
  return {
    id: 1,
    status: 'sent',
    isCorrection: false,
    mailMessageId: 100,
    subject: '広島CDE 大会要綱のご案内',
    receivedAt: new Date('2026-07-24T08:50:00+09:00'),
    sentAt: new Date('2026-07-24T09:15:00+09:00'),
    sentTextCount: 1,
    sentImageCount: 2,
    fallbackLinkCount: 0,
    errorMessage: null,
    ...over,
  }
}

describe('BroadcastHistoryTable', () => {
  it('0件のとき「配信履歴はまだありません。」を表示する', () => {
    render(<BroadcastHistoryTable rows={[]} eventId={1} />)
    expect(screen.getByText('配信履歴はまだありません。')).toBeTruthy()
  })

  it('ステータスをテキストで表示する（sent=配信済み）', () => {
    render(<BroadcastHistoryTable rows={[row({ status: 'sent' })]} eventId={1} />)
    const status = screen.getByText('配信済み')
    expect(status.className).toContain('text-ink-meta')
    expect(status.className).not.toContain('text-accent-fg')
  })

  it('partial/failed は朱色になる', () => {
    render(
      <BroadcastHistoryTable
        rows={[row({ id: 1, status: 'partial' }), row({ id: 2, status: 'failed' })]}
        eventId={1}
      />,
    )
    expect(screen.getByText('部分失敗').className).toContain('text-accent-fg')
    expect(screen.getByText('失敗').className).toContain('text-accent-fg')
  })

  it('メトリクスは「テキストN・画像M」書式（リンクがあれば追加）', () => {
    render(
      <BroadcastHistoryTable
        rows={[row({ sentTextCount: 1, sentImageCount: 2, fallbackLinkCount: 0 })]}
        eventId={1}
      />,
    )
    expect(screen.getByText('テキスト1・画像2')).toBeTruthy()
  })

  it('fallbackLinkCount > 0 のとき「・リンクN」が付く', () => {
    render(
      <BroadcastHistoryTable
        rows={[row({ sentTextCount: 1, sentImageCount: 1, fallbackLinkCount: 1 })]}
        eventId={1}
      />,
    )
    expect(screen.getByText('テキスト1・画像1・リンク1')).toBeTruthy()
  })

  it('受信・配信の日時が年なし短縮形式で表示される', () => {
    render(<BroadcastHistoryTable rows={[row()]} eventId={1} />)
    expect(screen.getByText('受信 7/24 08:50')).toBeTruthy()
    expect(screen.getByText('配信 7/24 09:15')).toBeTruthy()
  })

  it('isCorrection のとき件名の前に「訂正」の素テキストが付く（ピルではない）', () => {
    render(
      <BroadcastHistoryTable
        rows={[row({ isCorrection: true, subject: '会場変更のお知らせ' })]}
        eventId={1}
      />,
    )
    const subjectLine = screen.getByText(/会場変更のお知らせ/)
    expect(subjectLine.textContent).toContain('訂正')
    expect(subjectLine.textContent).toContain('会場変更のお知らせ')
  })

  it('failed/partial かつ manualBroadcastAction があるときだけ「再配信」が出る', () => {
    const { rerender } = render(
      <BroadcastHistoryTable
        rows={[row({ status: 'sent' })]}
        eventId={1}
        manualBroadcastAction={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '再配信' })).toBeNull()

    rerender(
      <BroadcastHistoryTable
        rows={[row({ status: 'failed' })]}
        eventId={1}
        manualBroadcastAction={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '再配信' })).toBeTruthy()
  })

  it('manualBroadcastAction が無いときは failed でも「再配信」が出ない', () => {
    render(<BroadcastHistoryTable rows={[row({ status: 'failed' })]} eventId={1} />)
    expect(screen.queryByRole('button', { name: '再配信' })).toBeNull()
  })

  it('「再配信」押下で manualBroadcastAction が eventId・mailMessageId 付きで呼ばれる', async () => {
    const manualBroadcastAction = vi.fn().mockResolvedValue(undefined)
    render(
      <BroadcastHistoryTable
        rows={[row({ status: 'partial', mailMessageId: 42 })]}
        eventId={7}
        manualBroadcastAction={manualBroadcastAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '再配信' }))

    await waitFor(() => {
      expect(manualBroadcastAction).toHaveBeenCalledWith(7, 42)
    })
  })
})
