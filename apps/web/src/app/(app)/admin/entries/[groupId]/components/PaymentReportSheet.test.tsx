import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaymentReportSheet } from './PaymentReportSheet'

/**
 * payment-receipt-broadcast タスク8: 支払報告シート（AC-4 / AC-22 / §3.2.2-6）。
 *
 * サーバー側の判定（枚数・形式・サイズ・送信）は
 * `actions.payment-report.test.ts` が持つ。ここが持つのは**画面側の防御と表示**だけ。
 */

const MESSAGE_WITHOUT = '参加費の振り込みが完了しました。'
const MESSAGE_WITH =
  '参加費の振り込みが完了しました。\n\n景虎上の想定金額は 12,500円 です。\n添付の明細と金額が一致しているかご確認ください。'

/**
 * jsdom は canvas も `Image` のデコードも持たない。ここでは「読み込めた画像」と
 * 「読み込めない画像（HEIC 相当）」を切り替えられるスタブを置く。
 */
function stubImage(succeed: boolean) {
  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 100
    height = 50
    set src(_value: string) {
      queueMicrotask(() => (succeed ? this.onload?.() : this.onerror?.()))
    }
  }
  vi.stubGlobal('Image', StubImage)
}

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,AAAA',
  )
}

function renderSheet(overrides: Partial<Parameters<typeof PaymentReportSheet>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({
    ok: true as const,
    reportId: 1,
    status: 'sent' as const,
    excluded: [],
  })
  const onClose = vi.fn()
  render(
    <PaymentReportSheet
      dayCount={2}
      messageWithoutReceipts={MESSAGE_WITHOUT}
      messageWithReceipts={MESSAGE_WITH}
      isLineLinked
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit, onClose }
}

function pickFiles(count: number, name = 'meisai.png') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const files = Array.from(
    { length: count },
    (_, i) => new File(['x'], `${i}-${name}`, { type: 'image/png' }),
  )
  fireEvent.change(input, { target: { files } })
  return input
}

describe('PaymentReportSheet', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:stub'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    stubCanvas()
  })

  it('証憑0枚のプレビューは現行の固定文言（AC-22 / AC-2）', () => {
    renderSheet()
    expect(screen.getByTestId('payment-report-preview').textContent).toBe(MESSAGE_WITHOUT)
    expect(screen.queryByText(/＋ 明細の写真/)).toBeNull()
  })

  it('写真を選ぶとプレビューが証憑ありの本文へ切り替わり、枚数が出る（AC-22）', async () => {
    stubImage(true)
    renderSheet()
    pickFiles(1)

    await waitFor(() =>
      expect(screen.getByTestId('payment-report-preview').textContent).toBe(MESSAGE_WITH),
    )
    expect(screen.getByText('＋ 明細の写真 1枚')).toBeTruthy()
  })

  it('4枚目は選べない（3枚で追加ボタンが消える・AC-4 の画面側）', async () => {
    stubImage(true)
    renderSheet()
    pickFiles(4)

    await waitFor(() => expect(screen.getByText('証憑は3枚までです')).toBeTruthy())
    // 3枚ぶんのサムネだけが残り、追加ボタンは消える。
    expect(document.querySelectorAll('img')).toHaveLength(3)
    expect(screen.queryByText('写真を選ぶ')).toBeNull()
  })

  it('読み込めない画像（HEIC 相当）は日本語のエラーを出す（§3.2.2-6）', async () => {
    stubImage(false)
    renderSheet()
    pickFiles(1, 'meisai.heic')

    await waitFor(() =>
      expect(screen.getByText(/HEIC は非対応です/)).toBeTruthy(),
    )
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('サムネの × で選択を外せる', async () => {
    stubImage(true)
    renderSheet()
    pickFiles(1)
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(1))

    fireEvent.click(screen.getByLabelText('0-meisai.png を外す'))
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByTestId('payment-report-preview').textContent).toBe(MESSAGE_WITHOUT)
  })

  it('実行ボタンは写真0枚でも「支払報告」のまま（スキップ用の別ボタンを作らない）', () => {
    renderSheet()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toContain('支払報告')
    expect(buttons.some((t) => t?.includes('スキップ'))).toBe(false)
  })

  it('LINE 未連携のときは送信されない旨を出す（AC-15 の画面側）', () => {
    renderSheet({ isLineLinked: false })
    expect(screen.getByText(/LINE グループが紐付いていないため、送信は行われません/)).toBeTruthy()
  })

  it('実行すると選んだ証憑が Server Action へ渡る', async () => {
    stubImage(true)
    const { onSubmit, onClose } = renderSheet()
    pickFiles(1)
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '支払報告' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith([{ filename: '0-meisai.png', base64: 'AAAA' }])
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('除外された枚の理由はシートに残して閉じない（§3.2.2-7）', async () => {
    stubImage(true)
    const { onClose } = renderSheet({
      onSubmit: vi.fn().mockResolvedValue({
        ok: true as const,
        reportId: 1,
        status: 'sent' as const,
        excluded: ['meisai.pdf: 対応していない画像形式です。'],
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: '支払報告' }))

    await waitFor(() =>
      expect(screen.getByText('meisai.pdf: 対応していない画像形式です。')).toBeTruthy(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
