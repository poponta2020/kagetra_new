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
const largePdfAttachment: AIExtractAttachment = {
  id: 3,
  filename: '巨大要綱.pdf',
  contentType: 'application/pdf',
  sizeBytes: 9000 * 1024, // 9000KB > 8000KB（注意の目安）
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

  // AC-27（改訂）: 目安サイズを超える添付も**選べる**。止めるのではなく、
  // 注意書きを出して実行前に確認を取る。
  it('サイズが大きめの添付もチェックでき、注意書きを表示する', () => {
    openDialog({
      attachments: [pdfAttachment, largePdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    const okCheckbox = screen.getByRole('checkbox', {
      name: pdfAttachment.filename,
    }) as HTMLInputElement
    const largeCheckbox = screen.getByRole('checkbox', {
      name: largePdfAttachment.filename,
    }) as HTMLInputElement

    expect(okCheckbox.disabled).toBe(false)
    expect(largeCheckbox.disabled).toBe(false)
    expect(
      screen.getByText('サイズが大きめです（送信できますが、確認が入ります）'),
    ).toBeTruthy()

    // 目安を超えていても選択できる。
    fireEvent.click(largeCheckbox)
    expect(largeCheckbox.checked).toBe(true)
  })

  // 大きめの PDF を含む選択は、実行前に確認を 1 段挟んでから送信する。
  it('サイズが大きめの添付を選んで実行すると確認を挟み、「はい」で送信する', async () => {
    openDialog({
      attachments: [pdfAttachment, largePdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    fireEvent.click(
      screen.getByRole('checkbox', { name: largePdfAttachment.filename }),
    )
    fireEvent.click(screen.getByText('実行'))

    expect(screen.getByText('サイズの大きい添付があります')).toBeTruthy()
    // 確認に出るのは大きい添付の名前だけ。
    expect(screen.getByText(largePdfAttachment.filename)).toBeTruthy()
    expect(triggerExtractDraftMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('はい'))

    await waitFor(() => {
      expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [
        largePdfAttachment.id,
      ])
    })
  })

  it('サイズ確認で「いいえ」を押すと添付選択画面に戻る', () => {
    openDialog({
      attachments: [pdfAttachment, largePdfAttachment],
      pdfSizeLimitKb: 8000,
    })

    fireEvent.click(
      screen.getByRole('checkbox', { name: largePdfAttachment.filename }),
    )
    fireEvent.click(screen.getByText('実行'))
    expect(screen.getByText('サイズの大きい添付があります')).toBeTruthy()

    fireEvent.click(screen.getByText('いいえ'))

    expect(screen.queryByText('サイズの大きい添付があります')).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: largePdfAttachment.filename }),
    ).toBeTruthy()
    expect(triggerExtractDraftMock).not.toHaveBeenCalled()
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
    // JSX の改行がテキストノード内で空白に潰れるため、部分一致で見る。
    expect(
      screen.getByText(/このメールを大会案内として AI で抽出し、ドラフトを作ります。/),
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

/**
 * Codex R1 blocker の回帰。
 * - 復元した選択が、サイズを理由に黙って外れてしまわないこと
 * - 1件ずつは小さくても、合計は Anthropic の 32MB を超え得る（要件 §6）
 */
describe('AIExtractConfirmDialog — 復元の正規化と合計サイズ', () => {
  beforeEach(() => {
    triggerExtractDraftMock.mockReset()
    triggerExtractDraftMock.mockResolvedValue({ ok: true, draftId: 1, jobId: 1 })
  })

  it('サイズが大きめの添付でも、前回の選択はそのまま復元される', () => {
    openDialog({
      attachments: [pdfAttachment, largePdfAttachment],
      pdfSizeLimitKb: 8000,
      // 前回、管理者が確認したうえで巨大要綱も選んでいた。
      initialSelectedAttachmentIds: [pdfAttachment.id, largePdfAttachment.id],
    })

    const okBox = screen.getByRole('checkbox', {
      name: pdfAttachment.filename,
    }) as HTMLInputElement
    const largeBox = screen.getByRole('checkbox', {
      name: largePdfAttachment.filename,
    }) as HTMLInputElement

    expect(okBox.checked).toBe(true)
    // サイズを理由に黙って外さない（外したければ自分でチェックを外せる）。
    expect(largeBox.checked).toBe(true)
    expect(screen.queryByText(/選択から外しました/)).toBeNull()

    // 大きい添付を含むので確認が 1 段入り、そのうえで両方が渡る。
    fireEvent.click(screen.getByText('実行'))
    expect(triggerExtractDraftMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('はい'))
    expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [
      pdfAttachment.id,
      largePdfAttachment.id,
    ])
  })

  it('削除された添付 id が復元に混ざっていても落とす', () => {
    openDialog({
      attachments: [pdfAttachment],
      pdfSizeLimitKb: 8000,
      initialSelectedAttachmentIds: [pdfAttachment.id, 999],
    })
    expect(
      (screen.getByRole('checkbox', { name: pdfAttachment.filename }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    fireEvent.click(screen.getByText('実行'))
    expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [pdfAttachment.id])
  })

  it('要件§6: 1件ずつは送れても合計超過なら実行できない', () => {
    // 各 8.5MB は単体なら「大きめ」の確認だけで送れる。3 件で 25.5MB となり
    // 合計予算（23.25MiB）を超えるので、こちらは確認では通せない。
    const big = 8.5 * 1024 * 1024
    const a: AIExtractAttachment = { id: 11, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: big }
    const b: AIExtractAttachment = { id: 12, filename: 'b.pdf', contentType: 'application/pdf', sizeBytes: big }
    const c: AIExtractAttachment = { id: 13, filename: 'c.pdf', contentType: 'application/pdf', sizeBytes: big }
    openDialog({ attachments: [a, b, c], pdfSizeLimitKb: 8000 })

    for (const att of [a, b, c]) {
      fireEvent.click(screen.getByRole('checkbox', { name: att.filename }))
    }

    expect(screen.getByText(/AI が一度に受け取れる上限/)).toBeTruthy()
    const exec = screen.getByText('実行').closest('button') as HTMLButtonElement
    expect(exec.disabled).toBe(true)

    fireEvent.click(screen.getByText('実行'))
    expect(triggerExtractDraftMock).not.toHaveBeenCalled()

    // 1 件外せば合計は収まる。あとは「大きめ」の確認を通せば送れる。
    fireEvent.click(screen.getByRole('checkbox', { name: c.filename }))
    expect(screen.queryByText(/AI が一度に受け取れる上限/)).toBeNull()
    fireEvent.click(screen.getByText('実行'))
    fireEvent.click(screen.getByText('はい'))
    expect(triggerExtractDraftMock).toHaveBeenCalledWith(10, [a.id, b.id])
  })
})
