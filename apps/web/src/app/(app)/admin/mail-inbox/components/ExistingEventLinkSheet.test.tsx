import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExistingEventLinkSheet, type LinkableEventOption } from './ExistingEventLinkSheet'
import { linkMailToEvent } from '../actions'

// Server Action と router は副作用なので mock。leadText が action に正しく
// 渡るかを呼び出し引数で検証する。
vi.mock('../actions', () => ({ linkMailToEvent: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const linkMailToEventMock = vi.mocked(linkMailToEvent)

const events: LinkableEventOption[] = [
  { id: 1, title: '春季大会', eventDate: '2030-05-01', status: 'published' },
]

function openSheet() {
  render(<ExistingEventLinkSheet mailId={10} events={events} />)
  // 開く前はトリガーボタンのみ「既存イベントに紐付ける」テキストを持つ。
  fireEvent.click(screen.getByText('既存イベントに紐付ける'))
}

describe('ExistingEventLinkSheet — 冒頭メッセージ', () => {
  beforeEach(() => {
    linkMailToEventMock.mockReset()
    linkMailToEventMock.mockResolvedValue({ ok: true })
  })

  it('プリセットチップをクリックすると textarea に文言が流し込まれる', () => {
    openSheet()
    fireEvent.click(screen.getByText('抽選結果が出ました！'))
    const textarea = screen.getByPlaceholderText(
      '例: 抽選結果が出ました！',
    ) as HTMLTextAreaElement
    expect(textarea.value).toBe('抽選結果が出ました！')
  })

  it('入力した leadText は trim されて linkMailToEvent に渡る', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText(/春季大会/))
    const textarea = screen.getByPlaceholderText('例: 抽選結果が出ました！')
    fireEvent.change(textarea, { target: { value: '  組合せが出ました！  ' } })
    fireEvent.click(screen.getByText('結びつける'))

    await waitFor(() => {
      expect(linkMailToEventMock).toHaveBeenCalledWith(10, 1, '組合せが出ました！')
    })
  })

  it('冒頭メッセージ空欄でも送信でき、leadText=null で渡る', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText(/春季大会/))
    fireEvent.click(screen.getByText('結びつける'))

    await waitFor(() => {
      expect(linkMailToEventMock).toHaveBeenCalledWith(10, 1, null)
    })
  })

  it('再オープン時に前回入力した leadText はリセットされる', () => {
    render(<ExistingEventLinkSheet mailId={10} events={events} />)
    fireEvent.click(screen.getByText('既存イベントに紐付ける'))
    fireEvent.click(screen.getByText('会場・アクセスのご案内'))
    expect(
      (screen.getByPlaceholderText('例: 抽選結果が出ました！') as HTMLTextAreaElement)
        .value,
    ).toBe('会場・アクセスのご案内')
    // キャンセルで閉じて再オープン → 空に戻る。
    fireEvent.click(screen.getByText('キャンセル'))
    fireEvent.click(screen.getByText('既存イベントに紐付ける'))
    expect(
      (screen.getByPlaceholderText('例: 抽選結果が出ました！') as HTMLTextAreaElement)
        .value,
    ).toBe('')
  })
})
