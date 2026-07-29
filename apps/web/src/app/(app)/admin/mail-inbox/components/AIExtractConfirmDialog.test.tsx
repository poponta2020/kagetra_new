import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  AIExtractConfirmDialog,
  type AIExtractAttachment,
} from './AIExtractConfirmDialog'
import { triggerExtractDraft } from '../actions'

// mail-ai-extract-refinements タスク8: 添付選択ダイアログ（要件 §3.2.4 / AC-26〜29）。
// Server Action は副作用なので mock。呼び出し引数（選択された添付 id 配列）で
// 検証する — 「選択を集めて渡す」だけがこのコンポーネントの責務。
vi.mock('../actions', () => ({ triggerExtractDraft: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const triggerExtractDraftMock = vi.mocked(triggerExtractDraft)

const pdfAttachment: AIExtractAttachment = {
  id: 1,
  filename: '要綱.pdf',
  contentType: 'application/pdf',
  sizeBytes: 200 * 1024, // 200KB
}
const wordAttachment: AIExtractAttachment = {
  id: 2,
  filename: '案内.docx',
  contentType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 50 * 1024, // 50KB
}
const oversizePdfAttachment: AIExtractAttachment = {
  id: 3,
  filename: '巨大要綱.pdf',
  contentType: 'application/pdf',
  sizeBytes: 9000 * 1024, // 9000KB > 8000KB 上限
}

function openDialog(props: Partial<React.ComponentProps<typeof AIExtractConfirmDialog>> = {}) {
  render(<AIExtractConfirmDialog mailId={10} {...props} />)
  fireEvent.click(screen.getByText(props.buttonLabel ?? '会で流す（AI 抽出）'))
}

describe('AIExtractConfirmDialog — 添付選択', () => {
  beforeEach(() => {
    triggerExtractDraftMock.mockReset()
    triggerExtractDraftMock.mockResolvedValue({ ok: true, draftId: 1, jobId: 1 })
  })

  // AC-26: 添付一覧（ファイル名・種別・サイズ）が出て既定で全て未チェック。
  it('添付一覧をファイル名・種別・サイズ付きで表示し、既定で全て未チェック', () => {
    openDialog({
      attachments: [pdfAttachment, wordAttachment],
      pdfSizeLimitKb: 8000,
    })

    const pdfCheckbox = screen.getByRole('checkbox', {
      name: pdfAttachment.filename,
    }) as HTMLInputElement
    const wordCheckbox = screen.getByRole('checkbox', {
      name: wordAttachment.filename,
    }) as HTMLInputElement

    expect(pdfCheckbox.checked).toBe(false)
    expect(wordCheckbox.checked).toBe(false)
    expect(screen.getByText('PDF ・ 200KB')).toBeTruthy()
    expect(screen.getByText('Word ・ 50KB')).toBeTruthy()
  })

  // AC-27: サイズ上限超過の添付はチェック不可＋理由表示。
  it('サイズ上限超過の添付はチェックできず、理由を表示する', () => {
    openDialog({
      attachments: [pdfAttachment, oversizePdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    const okCheckbox = screen.getByRole('checkbox', {
      name: pdfAttachment.filename,
    }) as HTMLInputElement
    const oversizeCheckbox = screen.getByRole('checkbox', {
      name: oversizePdfAttachment.filename,
    }) as HTMLInputElement

    expect(okCheckbox.disabled).toBe(false)
    expect(oversizeCheckbox.disabled).toBe(true)
    expect(screen.getByText('サイズ上限超過のため送信できません')).toBeTruthy()

    // 上限超過チェックボックスをクリックしても選択できない（disabled のまま）。
    fireEvent.click(oversizeCheckbox)
    expect(oversizeCheckbox.checked).toBe(false)
  })

  // AC-28: 添付が 1 つ以上あるのに全て未チェックのまま実行しようとすると確認が
  // 1 段入る。
  it('添付ありで全未チェックのまま実行すると「本文だけで実行しますか？」を挟む', async () => {
    openDialog({
      attachments: [pdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    fireEvent.click(screen.getByText('実行'))

    // 確認が挟まり、まだ Server Action は呼ばれない。
    expect(
      screen.getByText('本文だけで実行しますか？'),
    ).toBeTruthy()
    expect(triggerExtractDraftMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('はい'))

    await waitFor(() => {
      expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [])
    })
  })

  // AC-28 補足: 「いいえ」で選択画面に戻れる。
  it('確認で「いいえ」を押すと添付選択画面に戻る', () => {
    openDialog({
      attachments: [pdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    fireEvent.click(screen.getByText('実行'))
    expect(screen.getByText('本文だけで実行しますか？')).toBeTruthy()

    fireEvent.click(screen.getByText('いいえ'))

    expect(screen.queryByText('本文だけで実行しますか？')).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: pdfAttachment.filename }),
    ).toBeTruthy()
  })

  // 選択ありで実行すると確認を挟まず即座に Server Action が呼ばれる。
  it('添付を選択して実行すると確認なしで選択 id が渡る', async () => {
    openDialog({
      attachments: [pdfAttachment, wordAttachment],
      pdfSizeLimitKb: 8000,
    })

    fireEvent.click(
      screen.getByRole('checkbox', { name: wordAttachment.filename }),
    )
    fireEvent.click(screen.getByText('実行'))

    expect(screen.queryByText('本文だけで実行しますか？')).toBeNull()
    await waitFor(() => {
      expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [
        wordAttachment.id,
      ])
    })
  })

  // AC-29: 添付が0件のメールでは確認なしで実行できる（現行の1回確認のみ）。
  it('添付0件では確認を挟まず実行できる', async () => {
    openDialog({ attachments: [], pdfSizeLimitKb: 8000 })

    // 添付一覧は出ない。
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText(
        'このメールを大会案内として AI で抽出し、ドラフトを作ります。よろしいですか？（完了後に通知します）',
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByText('はい'))

    // 「本文だけで実行しますか？」の中間確認は出ない。
    expect(screen.queryByText('本文だけで実行しますか？')).toBeNull()
    await waitFor(() => {
      expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [])
    })
  })

  it('失敗時はエラーメッセージをインライン表示する', async () => {
    triggerExtractDraftMock.mockResolvedValue({
      ok: false,
      error: 'テストエラー',
    })
    openDialog({ attachments: [], pdfSizeLimitKb: 8000 })

    fireEvent.click(screen.getByText('はい'))

    await waitFor(() => {
      expect(screen.getByText('テストエラー')).toBeTruthy()
    })
  })
})
